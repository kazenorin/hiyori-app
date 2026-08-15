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
	await insertActLineEntries(
		messageIds.map((messageId, sequence) => ({ actLineId: 'line-1', messageId, sequence }))
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

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 0 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 3 },
			],
			incomingMessages: [messageRow('m6', 'incoming content')],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('forked');

		// The original act line now carries the incoming lineage.
		const originalIds = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(originalIds).toEqual(['m1', 'm2', 'm3', 'm6']);

		// The local progress survives as a new act line — full lineage, shared message rows.
		const forkIds = (await getMessagesForLine(result.forkActLineId!)).map((m) => m.id);
		expect(forkIds).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);

		// WHY: reference-count protection — no message row may be deleted by a merge.
		const allMessages = await getMessagesByIds(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
		expect(allMessages).toHaveLength(6);
	});

	it('remote-stale merge is a no-op', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 0 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 2 },
			],
			incomingMessages: [],
			forkNameSuffix: '(local branch)',
		});
		expect(result.action).toBe('no-op');
	});

	it('local-stale merge fast-forwards by appending incoming messages', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 0 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 3 },
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
				{ actLineId: 'line-1', messageId: 'm1', sequence: 0 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 2 },
			],
			incomingMessages: [messageRow('m3', 'ATTEMPTED OVERWRITE')],
			forkNameSuffix: '(local branch)',
		});
		const m3 = (await getMessagesByIds(['m3']))[0];
		expect(m3.content).not.toBe('ATTEMPTED OVERWRITE');
		expect(result.action).toBe('no-op');
	});
});
