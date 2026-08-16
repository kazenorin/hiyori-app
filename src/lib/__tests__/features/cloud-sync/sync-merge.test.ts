import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DB test setup follows the db-layer.test.ts pattern: better-sqlite3 in-memory
// database injected via a mocked database module.
let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('$lib/db/database', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	// settings.svelte.ts (pulled in via story-loader's store imports) calls this
	// at module load time.
	setLogLevel: vi.fn(),
}));

import { createTestDatabase } from '../../helpers/test-database';
import { runMigrations } from '$lib/db/migrations';
import * as stories from '$lib/db/stories';
import * as acts from '$lib/db/acts';
import { createActLine, getMessagesForLine, insertActLineEntries } from '$lib/db/act-lines';
import { insertMessage, getMessagesByIds, type Message } from '$lib/db/messages';
import { compareLineages, mergeIncomingActLine } from '$lib/features/cloud-sync/sync-merge';

function messageRow(id: string, content: string): Message {
	return { id, role: 'assistant', content, createdAt: Date.now() };
}

async function seedLine(messageIds: string[]) {
	await createActLine('line-1', 'act-1', 'Main', true);
	for (const id of messageIds) await insertMessage(messageRow(id, `content ${id}`));
	// Production sequences are 1-based and dense (getNextSequence = MAX+1);
	// seeding 0-based here masked a fast-forward primary-key collision.
	await insertActLineEntries(
		messageIds.map((messageId, index) => ({ actLineId: 'line-1', messageId, sequence: index + 1 }))
	);
}

describe('compareLineages', () => {
	it('identical lineages produce no action', () => {
		expect(compareLineages(['1', '2', '3'], ['1', '2', '3'])).toEqual({
			decision: 'identical',
			commonPrefixLength: 3,
		});
	});

	// WHY (spec case 2): pulling a stale remote copy of a line that has since
	// progressed locally must be a silent no-op — forking here would spam
	// duplicate branches on every sync.
	it('remote as strict prefix of local (remote stale) is a no-op', () => {
		expect(compareLineages(['1', '2', '3', '6', '7'], ['1', '2', '3', '6'])).toEqual({
			decision: 'remote-stale',
			commonPrefixLength: 4,
		});
	});

	// WHY: the common case of continuing a story from another device.
	it('local as strict prefix of remote (local stale) fast-forwards', () => {
		expect(compareLineages(['1', '2', '3'], ['1', '2', '3', '6'])).toEqual({
			decision: 'local-stale',
			commonPrefixLength: 3,
		});
	});

	// WHY (spec case 1 & 3): divergent progress must NEVER discard either side —
	// local yields the act-line ID to incoming and survives as a fork.
	it('divergent lineages report the common prefix boundary', () => {
		expect(compareLineages(['1', '2', '3', '4', '5'], ['1', '2', '3', '6'])).toEqual({
			decision: 'divergent',
			commonPrefixLength: 3,
		});
	});

	it('empty incoming lineage is remote-stale', () => {
		expect(compareLineages(['1', '2'], []).decision).toBe('remote-stale');
	});

	it('empty local lineage is local-stale', () => {
		expect(compareLineages([], ['1', '2']).decision).toBe('local-stale');
	});
});

describe('mergeIncomingActLine (fork-and-yield)', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
	});

	afterEach(() => {
		testDb.close();
	});

	// Seed: line-1 with m1 -> m2 -> m3 -> m4 -> m5; incoming diverged at m3 to m6.
	it('divergent merge preserves local lineage as a new act line', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		// Local-branch event must survive the yield (regression: the truncation
		// cleanup used here cascaded and deleted the line's events and profiles).
		await testDb.execute(
			'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			['evt-1', 'line-1', 'm2', 2, 'phase', 'rising', Date.now()]
		);
		// Premises must carry over to the fork (branchFromLine copies them).
		await testDb.execute(
			'INSERT INTO act_line_premises (act_line_id, message_id, sequence) VALUES ($1, $2, $3)',
			['line-1', 'm1', 1]
		);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			incomingMessages: [messageRow('m6', 'incoming content')],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('forked');

		// The original act line now carries the incoming lineage.
		const originalIds = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(originalIds).toEqual(['m1', 'm2', 'm3', 'm6']);

		// The local progress survives as a new act line. Reusing branchFromLine
		// means the fork-point message (m5) is CLONED — same content, new id —
		// so metadata writes on either line can't pollute the other.
		const forkMessages = await getMessagesForLine(result.forkActLineId!);
		const forkIds = forkMessages.map((m) => m.id);
		expect(forkIds.slice(0, 4)).toEqual(['m1', 'm2', 'm3', 'm4']);
		expect(forkIds[4]).not.toBe('m5');
		expect(forkMessages[4].content).toBe('content m5');

		// The fork keeps the 1-based sequences of the yielded line.
		const forkRows = await testDb.select<{ sequence: number }[]>(
			'SELECT sequence FROM act_lines WHERE act_line_id = $1 ORDER BY sequence',
			[result.forkActLineId!]
		);
		expect(forkRows.map((r) => r.sequence)).toEqual([1, 2, 3, 4, 5]);

		// The event survives on the fork (branchFromLine copies it with a new id)
		// and no longer clings to the yielded line.
		const forkEvents = await testDb.select<{ event: string; value: string }[]>(
			'SELECT event, value FROM act_line_events WHERE act_line_id = $1',
			[result.forkActLineId!]
		);
		expect(forkEvents).toEqual([{ event: 'phase', value: 'rising' }]);
		const yieldedEvents = await testDb.select<{ id: string }[]>(
			'SELECT id FROM act_line_events WHERE act_line_id = $1',
			['line-1']
		);
		expect(yieldedEvents).toHaveLength(0);

		// Premises carry over to the fork.
		const forkPremises = await testDb.select<{ message_id: string }[]>(
			'SELECT message_id FROM act_line_premises WHERE act_line_id = $1',
			[result.forkActLineId!]
		);
		expect(forkPremises.map((r) => r.message_id)).toEqual(['m1']);

		// WHY: reference-count protection — no message row may be deleted by a merge.
		const allMessages = await getMessagesByIds(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
		expect(allMessages).toHaveLength(6);
	});

	it('remote-stale merge is a no-op', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [],
			forkNameSuffix: '(local branch)',
		});
		expect(result.action).toBe('no-op');
	});

	// Regression for the primary "continue from another device" case: with
	// 1-based sequences the boundary entry shares sequence === local length,
	// which sequence-math tail selection re-inserts (primary-key violation).
	it('local-stale merge fast-forwards by appending incoming messages', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			incomingMessages: [messageRow('m6', 'incoming content')],
			forkNameSuffix: '(local branch)',
		});
		expect(result.action).toBe('fast-forward');
		const ids = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(ids).toEqual(['m1', 'm2', 'm3', 'm6']);
	});

	// WHY (add-only message rule): a message ID that exists locally is never
	// overwritten — sync must not clobber locally associated data.
	it('never overwrites existing message rows', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [messageRow('m3', 'ATTEMPTED OVERWRITE')],
			forkNameSuffix: '(local branch)',
		});
		const m3 = (await getMessagesByIds(['m3']))[0];
		expect(m3.content).not.toBe('ATTEMPTED OVERWRITE');
		expect(result.action).toBe('no-op');
	});
});
