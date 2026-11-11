import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DB test setup follows the db-layer.test.ts pattern: better-sqlite3 in-memory
// database injected via a mocked database module.
let testDb: ReturnType<typeof createTestDatabase>;

vi.mock('#lib/db/database.ts', () => ({
	initDatabase: vi.fn(async () => testDb),
	getDatabase: vi.fn(() => testDb),
}));

vi.mock('#lib/logging/logger.ts', () => ({
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
import { runMigrations } from '#lib/db/migrations.ts';
import * as stories from '#lib/db/stories.ts';
import * as acts from '#lib/db/acts.ts';
import { createActLine, getActLine, getMessagesForLine, insertActLineEntries } from '#lib/db/act-lines.ts';
import { insertMessage, getMessagesByIds, type Message } from '#lib/db/messages.ts';
import { upsertMessagePhases, getPhasesForMessages } from '#lib/db/message-phases.ts';
import {
	compareLineages,
	mergeIncomingActLine,
	mergeIncomingStory,
	profileHistoriesEqual,
	inventoryHistoriesEqual,
} from '#lib/features/cloud-sync/sync-merge.ts';
import { insertInventoryRows, type InventoryRow, type InsertInventoryRowInput } from '#lib/db/inventory.ts';
import type { StoryExportData } from '#lib/features/story-export-load/archive-schema.ts';
import { CURRENT_ARCHIVE_VERSION } from '#lib/features/story-export-load/archive-schema.ts';
import { insertCharacterProfile, type CharacterImportance } from '#lib/db/character-profiles.ts';
import JSZip from 'jszip';
import { setFileSystem, fs } from '#lib/fs/file-system.ts';
import { InMemoryFileSystem } from '#lib/fs/file-system-in-memory.ts';
import { buildLineDir, buildLineSubdirSuffix } from '#lib/ai/card-output-path.ts';

function messageRow(id: string, content: string): Message {
	return { id, role: 'assistant', content, createdAt: Date.now() };
}

async function seedLine(messageIds: string[]) {
	await createActLine('line-1', 'act-1', 'Main', true);
	for (const id of messageIds) await insertMessage(messageRow(id, `content ${id}`));
	// Production sequences are 1-based and dense (getNextSequence = MAX+1);
	// seeding 0-based here masked a fast-forward primary-key collision.
	await insertActLineEntries(messageIds.map((messageId, index) => ({ actLineId: 'line-1', messageId, sequence: index + 1 })));
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
		setFileSystem(new InMemoryFileSystem());
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
		await testDb.execute('INSERT INTO act_line_premises (act_line_id, message_id, sequence) VALUES ($1, $2, $3)', ['line-1', 'm1', 1]);
		// Line-local state follows the forkActLine() workflow: director notes,
		// character profiles and inventory are cloned to the fork before the
		// original line is deleted. Give m2 a scene number so the profile
		// clone (which is scene-bound) has a fork scene to reference.
		await testDb.execute('UPDATE messages SET scene_number = 1 WHERE id = $1', ['m2']);
		await testDb.execute(
			'INSERT INTO director_notes (id, act_line_id, text, is_active, effective_from_scene, effective_to_scene, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			['note-1', 'line-1', 'keep the tone', 1, null, null, Date.now()]
		);
		await testDb.execute(
			`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, scene_details, importance, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			['profile-1', 'line-1', 1, 'Alice', 'Alice', '[]', 'hero', 'ok', 'learn the truth', '', '', '', 4, Date.now(), Date.now()]
		);
		await testDb.execute(
			'INSERT INTO inventory (id, story_id, act_line_id, message_id, scene_number, character_canonical_name, item_name, event_type, category, equip_status, description, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)',
			['inv-1', 'story-1', 'line-1', 'm2', 1, 'Alice', 'Key', 'acquired', 'item', 'carried', null, '2024-01-01 00:00:00']
		);
		// The fork is a mirror copy: seed the on-disk story-folder mapping and a
		// source act-plot so the merge mirrors it to the fork (like forkActLine).
		await testDb.execute('INSERT INTO story_folders (story_id, folder_name, created_at) VALUES ($1, $2, $3)', [
			'story-1',
			'Test',
			Date.now(),
		]);
		await fs.writeTextFile('Test/act-1/main-line/act-plot.md', 'the plot');

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			storyFolder: 'Test',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
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

		// The original act line now carries the incoming lineage, with its
		// metadata recreated under the same ID (deleteActLine removed it).
		const originalIds = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(originalIds).toEqual(['m1', 'm2', 'm3', 'm6']);
		const yieldedMeta = await getActLine('line-1');
		expect(yieldedMeta?.name).toBe('Main');
		expect(yieldedMeta?.isMainLine).toBe(true);

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
		const yieldedEvents = await testDb.select<{ id: string }[]>('SELECT id FROM act_line_events WHERE act_line_id = $1', ['line-1']);
		expect(yieldedEvents).toHaveLength(0);

		// Premises carry over to the fork.
		const forkPremises = await testDb.select<{ message_id: string }[]>('SELECT message_id FROM act_line_premises WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkPremises.map((r) => r.message_id)).toEqual(['m1']);

		// Director notes, character profiles and inventory follow the fork —
		// the workflow of forkActLine(): cloned to the fork, and the delete of
		// the original line removes them from the yielded lineage entirely.
		const forkNotes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkNotes.map((r) => r.text)).toEqual(['keep the tone']);
		const yieldedNotes = await testDb.select('SELECT id FROM director_notes WHERE act_line_id = $1', ['line-1']);
		expect(yieldedNotes).toHaveLength(0);

		const forkProfiles = await testDb.select<{ canonical_name: string }[]>(
			'SELECT canonical_name FROM character_profiles WHERE act_line_id = $1',
			[result.forkActLineId!]
		);
		expect(forkProfiles.map((r) => r.canonical_name)).toEqual(['Alice']);
		const yieldedProfiles = await testDb.select('SELECT id FROM character_profiles WHERE act_line_id = $1', ['line-1']);
		expect(yieldedProfiles).toHaveLength(0);

		const forkInventory = await testDb.select<{ item_name: string }[]>('SELECT item_name FROM inventory WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkInventory.map((r) => r.item_name)).toEqual(['Key']);
		const yieldedInventory = await testDb.select('SELECT id FROM inventory WHERE act_line_id = $1', ['line-1']);
		expect(yieldedInventory).toHaveLength(0);

		// The act-plot file is mirrored onto the fork's directory (forked lines
		// are mirror copies; only interview forks intentionally diverge).
		const forkPlotDir = buildLineDir('Test', 1, false, result.forkActLineId!, buildLineSubdirSuffix('Main (local branch)'));
		expect(await fs.readTextFileIfExists(`${forkPlotDir}/act-plot.md`)).toBe('the plot');

		// WHY: reference-count protection — messages survive only while some
		// line or premises reference them. The fork references m1-m4 and a
		// clone of m5, so the original m5 is orphan-cleansed together with the
		// delete of the yielded line (its content survives in the clone).
		const allMessages = await getMessagesByIds(['m1', 'm2', 'm3', 'm4', 'm5', 'm6']);
		expect(allMessages).toHaveLength(5);
	});

	// WHY (save incoming): the yielded line is an import of the incoming act
	// line — its metadata and line-local state (events, premises, director
	// notes, character profiles) come from the incoming archive, mirroring
	// insertSelectedActLineData. Local state survives on the fork instead.
	it('divergent merge imports incoming meta and line-local state onto the yielded line', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: {
				id: 'line-1',
				actId: 'act-1',
				name: 'Main (remote)',
				isMainLine: true,
				createdAt: 500,
				plotMode: 'phaseEvent',
			},
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			incomingMessages: [messageRow('m6', 'incoming content')],
			incomingEvents: [
				{
					id: 'evt-remote-shared',
					actLineId: 'line-1',
					messageId: 'm3',
					messageSequence: 3,
					event: 'act-phase-transition',
					value: 'rising',
					createdAt: 1,
				},
				{
					id: 'evt-remote-tail',
					actLineId: 'line-1',
					messageId: 'm6',
					messageSequence: 4,
					event: 'plot-generated',
					value: '4',
					createdAt: 2,
				},
			],
			incomingPremises: [{ actLineId: 'line-1', messageId: 'm6', sequence: 4 }],
			incomingNotes: [
				{
					id: 'note-remote',
					actLineId: 'line-1',
					text: 'incoming note',
					isActive: true,
					effectiveFromScene: null,
					effectiveToScene: null,
					createdAt: 3,
				},
			],
			incomingProfiles: [
				{
					id: 'profile-remote',
					actLineId: 'line-1',
					sceneNumber: 1,
					canonicalName: 'Bob',
					preferredName: 'Bob',
					aliases: [],
					logline: 'side',
					state: null,
					goal: null,
					relationships: null,
					voice: null,
					sceneDetails: '',
					importance: 4,
					createdAt: 4,
					updatedAt: 4,
				},
			],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('forked');

		// Incoming metadata wins on the yielded line; the local name lives on the fork.
		const line1 = await getActLine('line-1');
		expect(line1?.name).toBe('Main (remote)');
		expect(line1?.plotMode).toBe('phaseEvent');
		expect(line1?.createdAt).toBe(500);
		const fork = await getActLine(result.forkActLineId!);
		expect(fork?.name).toBe('Main (local branch)');

		// Incoming events/premises/notes/profiles land on the yielded line — the
		// line was wiped by the yield, so nothing collides.
		const yieldedEvents = await testDb.select<{ id: string }[]>(
			'SELECT id FROM act_line_events WHERE act_line_id = $1 ORDER BY message_sequence',
			['line-1']
		);
		expect(yieldedEvents.map((e) => e.id)).toEqual(['evt-remote-shared', 'evt-remote-tail']);
		const yieldedPremises = await testDb.select<{ message_id: string }[]>(
			'SELECT message_id FROM act_line_premises WHERE act_line_id = $1',
			['line-1']
		);
		expect(yieldedPremises.map((r) => r.message_id)).toEqual(['m6']);
		const yieldedNotes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', ['line-1']);
		expect(yieldedNotes.map((r) => r.text)).toEqual(['incoming note']);
		const yieldedProfiles = await testDb.select<{ canonical_name: string }[]>(
			'SELECT canonical_name FROM character_profiles WHERE act_line_id = $1',
			['line-1']
		);
		expect(yieldedProfiles.map((r) => r.canonical_name)).toEqual(['Bob']);

		// None of the incoming line-local rows leak onto the fork.
		const forkEvents = await testDb.select<{ id: string }[]>('SELECT id FROM act_line_events WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkEvents).toHaveLength(0);
		const forkNotes = await testDb.select<{ id: string }[]>('SELECT id FROM director_notes WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkNotes).toHaveLength(0);
	});

	it('remote-stale merge is a no-op', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
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
	it('local-stale merge fast-forwards by replacing the line with the incoming copy', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main (remote)', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			// Real archives carry the full referenced message set: the delete
			// orphan-cleanses the shared-prefix rows, so they are re-created from
			// the archive (the add-only insert runs after the delete).
			incomingMessages: [
				messageRow('m1', 'content m1'),
				messageRow('m2', 'content m2'),
				messageRow('m3', 'content m3'),
				messageRow('m6', 'incoming content'),
			],
			forkNameSuffix: '(local branch)',
		});
		expect(result.action).toBe('fast-forward');
		const ids = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(ids).toEqual(['m1', 'm2', 'm3', 'm6']);
		// The shared-prefix rows survive with their archive content.
		const m3 = (await getMessagesByIds(['m3']))[0];
		expect(m3.content).toBe('content m3');
		// Incoming metadata wins on the line.
		const line1 = await getActLine('line-1');
		expect(line1?.name).toBe('Main (remote)');
	});

	// WHY (delete-and-import): after the state-subset check passes, the local
	// copy contains nothing the incoming archive lacks, so the line is replaced
	// wholesale by the incoming act line — including its line-local state.
	// Notes/profiles now propagate on fast-forward (the wipe removes the local
	// rows first, so importing the full set can't duplicate them).
	it('local-stale fast-forwards importing the full incoming line-local state', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		// Local shared-prefix state that the incoming copy also carries — the
		// subset check matches it by id, so no fork is needed.
		await testDb.execute(
			'INSERT INTO act_line_events (id, act_line_id, message_id, message_sequence, event, value, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			['evt-shared', 'line-1', 'm2', 2, 'act-phase-transition', 'rising', 10]
		);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			incomingMessages: [
				messageRow('m1', 'content m1'),
				messageRow('m2', 'content m2'),
				messageRow('m3', 'content m3'),
				messageRow('m6', 'incoming content'),
			],
			incomingEvents: [
				{
					id: 'evt-shared',
					actLineId: 'line-1',
					messageId: 'm2',
					messageSequence: 2,
					event: 'act-phase-transition',
					value: 'rising',
					createdAt: 10,
				},
				{
					id: 'evt-remote-tail',
					actLineId: 'line-1',
					messageId: 'm6',
					messageSequence: 4,
					event: 'plot-generated',
					value: '4',
					createdAt: 20,
				},
			],
			incomingPremises: [{ actLineId: 'line-1', messageId: 'm6', sequence: 4 }],
			incomingNotes: [
				{
					id: 'note-remote',
					actLineId: 'line-1',
					text: 'incoming note',
					isActive: true,
					effectiveFromScene: null,
					effectiveToScene: null,
					createdAt: 30,
				},
			],
			incomingProfiles: [
				{
					id: 'profile-remote',
					actLineId: 'line-1',
					sceneNumber: 1,
					canonicalName: 'Bob',
					preferredName: 'Bob',
					aliases: [],
					logline: 'side',
					state: null,
					goal: null,
					relationships: null,
					voice: null,
					sceneDetails: '',
					importance: 4,
					createdAt: 40,
					updatedAt: 40,
				},
			],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('fast-forward');

		// The whole incoming line-local state lands on the line: the shared
		// event (wiped with the delete, re-imported), the tail event, the tail
		// premise, the note and the profile.
		const events = await testDb.select<{ id: string }[]>('SELECT id FROM act_line_events WHERE act_line_id = $1 ORDER BY id', ['line-1']);
		expect(events.map((e) => e.id)).toEqual(['evt-remote-tail', 'evt-shared']);
		const premises = await testDb.select<{ message_id: string }[]>('SELECT message_id FROM act_line_premises WHERE act_line_id = $1', [
			'line-1',
		]);
		expect(premises.map((p) => p.message_id)).toEqual(['m6']);
		const notes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', ['line-1']);
		expect(notes.map((n) => n.text)).toEqual(['incoming note']);
		const profiles = await testDb.select<{ canonical_name: string }[]>(
			'SELECT canonical_name FROM character_profiles WHERE act_line_id = $1',
			['line-1']
		);
		expect(profiles.map((p) => p.canonical_name)).toEqual(['Bob']);
	});

	// WHY (state-subset upgrade rule): fast-forward erases the local copy, so it
	// must only run when the incoming archive supersedes the local state. A note
	// added locally after the last sync is invisible to compareLineages (it
	// compares message chains only) — but it IS a deviation, so the line is
	// escalated to fork-and-yield: the note survives on the fork and the main
	// line becomes the incoming import.
	it('local-stale lineage with local-extra line-local state escalates to fork-and-yield', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		await testDb.execute(
			'INSERT INTO director_notes (id, act_line_id, text, is_active, effective_from_scene, effective_to_scene, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			['note-local-extra', 'line-1', 'state the incoming lacks', 1, null, null, Date.now()]
		);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main (remote)', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			// Real archives carry the full referenced message set. The fork-point
			// message m3 is replaced by a clone on the fork, so its original row is
			// orphan-cleansed and must be re-created from the archive.
			incomingMessages: [
				messageRow('m1', 'content m1'),
				messageRow('m2', 'content m2'),
				messageRow('m3', 'content m3'),
				messageRow('m6', 'incoming content'),
			],
			incomingNotes: [
				{
					id: 'note-remote',
					actLineId: 'line-1',
					text: 'incoming note',
					isActive: true,
					effectiveFromScene: null,
					effectiveToScene: null,
					createdAt: 50,
				},
			],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('forked');
		const forkNotes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', [
			result.forkActLineId!,
		]);
		expect(forkNotes.map((n) => n.text)).toEqual(['state the incoming lacks']);
		const lineNotes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', ['line-1']);
		expect(lineNotes.map((n) => n.text)).toEqual(['incoming note']);

		// The main line carries the full incoming lineage.
		const ids = (await getMessagesForLine('line-1')).map((m) => m.id);
		expect(ids).toEqual(['m1', 'm2', 'm3', 'm6']);
	});

	// WHY (identical-lineage overlay): equal message chains mean neither side
	// supersedes the other, so line-local state is unioned rather than
	// replaced. The incoming-only note is imported; the existing local note is
	// kept (not re-inserted, not overwritten); messages stay add-only.
	it('identical lineage overlays incoming-only line-local state', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		await testDb.execute(
			'INSERT INTO director_notes (id, act_line_id, text, is_active, effective_from_scene, effective_to_scene, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
			['note-local', 'line-1', 'local note', 1, null, null, Date.now()]
		);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [],
			incomingNotes: [
				{
					id: 'note-local',
					actLineId: 'line-1',
					text: 'local note',
					isActive: true,
					effectiveFromScene: null,
					effectiveToScene: null,
					createdAt: 10,
				},
				{
					id: 'note-remote',
					actLineId: 'line-1',
					text: 'remote note',
					isActive: true,
					effectiveFromScene: null,
					effectiveToScene: null,
					createdAt: 20,
				},
			],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('merged');
		const notes = await testDb.select<{ text: string }[]>('SELECT text FROM director_notes WHERE act_line_id = $1', ['line-1']);
		expect(notes.map((n) => n.text).sort()).toEqual(['local note', 'remote note']);
		// Messages untouched.
		const m3 = (await getMessagesByIds(['m3']))[0];
		expect(m3.content).toBe('content m3');
	});

	// WHY (add-only message rule): a message ID that exists locally is never
	// overwritten — sync must not clobber locally associated data.
	it('never overwrites existing message rows', async () => {
		await seedLine(['m1', 'm2', 'm3']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta: { id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' },
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

describe('mergeIncomingActLine phase portability', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	function phaseRows(messageId: string, suffix = ''): NonNullable<StoryExportData['messagePhases']> {
		return [
			{ messageId, phaseName: 'WRITER', reasoning: null, content: `draft ${messageId}${suffix}`, sequence: 0 },
			{ messageId, phaseName: 'EDITOR', reasoning: 'r', content: `final ${messageId}${suffix}`, sequence: 1 },
		];
	}

	const incomingMeta = {
		id: 'line-1',
		actId: 'act-1',
		name: 'Main',
		isMainLine: true,
		createdAt: Date.now(),
		plotMode: 'guidance' as const,
	};

	// WHY: fast-forward is the common cross-device case — the incoming tail's
	// phases must land so the restored scenes show strips immediately. The
	// delete-and-reimport path also deletes solely-referenced prefix messages,
	// so those are "new locally" too and take the archive's rows.
	it('fast-forward imports phases for the messages it (re-)inserts', async () => {
		await seedLine(['m1', 'm2']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2'), messageRow('m3', 'c3')],
			incomingPhases: [...phaseRows('m1'), ...phaseRows('m3')],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('fast-forward');
		const phases = await getPhasesForMessages(['m1', 'm3']);
		expect(phases.get('m3')?.map((p) => p.content)).toEqual(['draft m3', 'final m3']);
		expect(phases.get('m1')?.map((p) => p.content)).toEqual(['draft m1', 'final m1']);
	});

	// WHY (acceptance): a message kept alive by another local line survives the
	// merge delete — it "exists on both sides", so its local phase rows must win
	// (add-only mirror of the message rule).
	it('skips incoming phases for messages that survive via another line', async () => {
		await seedLine(['m1', 'm2']);
		await createActLine('line-2', 'act-1', 'Sibling', false);
		await insertActLineEntries([{ actLineId: 'line-2', messageId: 'm1', sequence: 1 }]);
		await upsertMessagePhases('m1', [{ phaseName: 'WRITER', content: 'local draft' }]);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2'), messageRow('m3', 'c3')],
			incomingPhases: phaseRows('m1', '-remote'),
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('fast-forward');
		const phases = await getPhasesForMessages(['m1']);
		expect(phases.get('m1')).toEqual([{ phaseName: 'WRITER', content: 'local draft' }]);
	});

	// WHY (acceptance): a v2 remote (no messagePhases) must not wipe local
	// phases on the shared prefix — the delete-and-reimport path captures and
	// restores them.
	it('merge without incoming phases preserves local phases', async () => {
		await seedLine(['m1', 'm2']);
		await upsertMessagePhases('m1', [{ phaseName: 'WRITER', content: 'local draft' }]);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2'), messageRow('m3', 'c3')],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('fast-forward');
		const phases = await getPhasesForMessages(['m1']);
		expect(phases.get('m1')).toEqual([{ phaseName: 'WRITER', content: 'local draft' }]);
	});

	// WHY (handoff §3.5): on a fork merge, the imported tail becomes the main
	// line — its phases must come with it.
	it('forked merge carries phases on the imported tail', async () => {
		await seedLine(['m1', 'm2', 'm3', 'm4', 'm5']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
				{ actLineId: 'line-1', messageId: 'm3', sequence: 3 },
				{ actLineId: 'line-1', messageId: 'm6', sequence: 4 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2'), messageRow('m3', 'c3'), messageRow('m6', 'c6')],
			incomingPhases: phaseRows('m6'),
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('forked');
		const phases = await getPhasesForMessages(['m6']);
		expect(phases.get('m6')?.map((p) => p.content)).toEqual(['draft m6', 'final m6']);
	});

	// WHY: identical lineages never insert messages, so phases must not be
	// touched either — local rows win on shared messages.
	it('identical-lineage overlay leaves local phases untouched', async () => {
		await seedLine(['m1', 'm2']);
		await upsertMessagePhases('m1', [{ phaseName: 'WRITER', content: 'local draft' }]);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2')],
			incomingPhases: phaseRows('m1', '-remote'),
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('no-op');
		const phases = await getPhasesForMessages(['m1']);
		expect(phases.get('m1')).toEqual([{ phaseName: 'WRITER', content: 'local draft' }]);
	});

	// WHY: a device that synced messages before phase persistence existed keeps
	// an identical lineage forever; without backfill it never gains strips.
	it('identical-lineage pull backfills phases for messages with none locally', async () => {
		await seedLine(['m1', 'm2']);
		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2')],
			incomingPhases: phaseRows('m1'),
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('merged');
		expect((await getPhasesForMessages(['m1'])).get('m1')?.map((p) => p.content)).toEqual(['draft m1', 'final m1']);
	});

	// WHY: never merge partial phase sets — a message that already has any local
	// phases keeps them verbatim; fully-unphased messages still get backfilled.
	it('identical-lineage backfill skips messages that have any local phases', async () => {
		await seedLine(['m1', 'm2']);
		await upsertMessagePhases('m1', [{ phaseName: 'WRITER', content: 'local draft' }]);

		const result = await mergeIncomingActLine({
			actLineId: 'line-1',
			storyId: 'story-1',
			incomingMeta,
			incomingEntries: [
				{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
				{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
			],
			incomingMessages: [messageRow('m1', 'c1'), messageRow('m2', 'c2')],
			incomingPhases: [...phaseRows('m1', '-remote'), ...phaseRows('m2')],
			forkNameSuffix: '(local branch)',
		});

		expect(result.action).toBe('merged');
		const phases = await getPhasesForMessages(['m1', 'm2']);
		expect(phases.get('m1')).toEqual([{ phaseName: 'WRITER', content: 'local draft' }]);
		expect(phases.get('m2')).toHaveLength(2);
	});
});

describe('mergeIncomingStory phase portability', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	// WHY: a line created on another device is imported whole — its messages
	// are new locally, so their phases must land in the same pass.
	it('imports phases for a line created on the other device', async () => {
		const data: StoryExportData = {
			version: 3,
			story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
			storyFolder: { storyId: 'story-1', folderName: 'test-folder', createdAt: 1000 },
			acts: [
				{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			],
			actLineMeta: [{ id: 'line-9', actId: 'act-1', name: 'Remote Fork', isMainLine: false, createdAt: 2000, plotMode: 'guidance' }],
			actLineEvents: [],
			actLineEntries: [{ actLineId: 'line-9', messageId: 'r1', sequence: 1 }],
			actLinePremises: [],
			directorNotes: [],
			messages: [
				{
					id: 'r1',
					role: 'assistant',
					content: 'remote scene',
					reasoning: null,
					metadata: null,
					variables: null,
					actSummary: null,
					scenePlot: null,
					importantPhrases: null,
					sceneNumber: 1,
					createdAt: 2000,
				},
			],
			messagePhases: [
				{ messageId: 'r1', phaseName: 'WRITER', reasoning: null, content: 'remote draft', sequence: 0 },
				{ messageId: 'r1', phaseName: 'EDITOR', reasoning: null, content: 'remote final', sequence: 1 },
			],
		};
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));
		const zipBytes = await zip.generateAsync({ type: 'uint8array' });

		const result = await mergeIncomingStory(zipBytes);

		expect(result).toBe('merged');
		const phases = await getPhasesForMessages(['r1']);
		expect(phases.get('r1')?.map((p) => p.content)).toEqual(['remote draft', 'remote final']);
	});

	// WHY: mixed-version state — the local copy synced before phase persistence
	// and holds the same lineage with no phase rows. The archive's phases are the
	// only source, so the pull must report a change (not 'up-to-date') and
	// backfill them; otherwise the device never gains strips.
	it('identical-lineage pull backfills phases for a locally phase-less message', async () => {
		await seedLine(['m1']);
		const data: StoryExportData = {
			version: 3,
			story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
			storyFolder: { storyId: 'story-1', folderName: 'test-folder', createdAt: 1000 },
			acts: [
				{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			],
			actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
			actLineEvents: [],
			actLineEntries: [{ actLineId: 'line-1', messageId: 'm1', sequence: 1 }],
			actLinePremises: [],
			directorNotes: [],
			messages: [
				{
					id: 'm1',
					role: 'assistant',
					content: 'content m1',
					reasoning: null,
					metadata: null,
					variables: null,
					actSummary: null,
					scenePlot: null,
					importantPhrases: null,
					sceneNumber: 1,
					createdAt: 2000,
				},
			],
			messagePhases: [
				{ messageId: 'm1', phaseName: 'WRITER', reasoning: null, content: 'remote draft', sequence: 0 },
				{ messageId: 'm1', phaseName: 'EDITOR', reasoning: null, content: 'remote final', sequence: 1 },
			],
		};
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));
		const zipBytes = await zip.generateAsync({ type: 'uint8array' });

		const result = await mergeIncomingStory(zipBytes);

		expect(result).toBe('merged');
		const phases = await getPhasesForMessages(['m1']);
		expect(phases.get('m1')?.map((p) => p.content)).toEqual(['remote draft', 'remote final']);
	});
});

describe('mergeIncomingStory character profile traits', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	function makeArchiveData(profile: NonNullable<StoryExportData['characterProfiles']>[number]): StoryExportData {
		return {
			version: CURRENT_ARCHIVE_VERSION,
			story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
			storyFolder: { storyId: 'story-1', folderName: 'test-folder', createdAt: 1000 },
			acts: [
				{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			],
			actLineMeta: [{ id: 'line-9', actId: 'act-1', name: 'Remote Fork', isMainLine: false, createdAt: 2000, plotMode: 'guidance' }],
			actLineEvents: [],
			actLineEntries: [{ actLineId: 'line-9', messageId: 'r1', sequence: 1 }],
			actLinePremises: [],
			directorNotes: [],
			messages: [
				{
					id: 'r1',
					role: 'assistant',
					content: 'remote scene',
					reasoning: null,
					metadata: null,
					variables: null,
					actSummary: null,
					scenePlot: null,
					importantPhrases: null,
					sceneNumber: 1,
					createdAt: 2000,
				},
			],
			characterProfiles: [profile],
		};
	}

	const baseProfile = {
		id: 'cp-1',
		actLineId: 'line-9',
		sceneNumber: 1,
		canonicalName: 'alice',
		preferredName: 'Alice',
		aliases: [] as string[],
		logline: 'A determined hero.',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		sceneDetails: '',
		importance: 2,
		createdAt: 1,
		updatedAt: 1,
	};

	// WHY: traits travel with the archive; a remote device's trait updates must
	// land in the local DB instead of being dropped by the import mapping.
	it('imports traits from a remote archive profile', async () => {
		const data = makeArchiveData({ ...baseProfile, traits: ['bold', 'cunning'] });
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));

		const result = await mergeIncomingStory(await zip.generateAsync({ type: 'uint8array' }));

		expect(result).toBe('merged');
		const rows = await testDb.select<{ traits: string | null }[]>('SELECT traits FROM character_profiles WHERE id = $1', ['cp-1']);
		expect(rows[0].traits).toBe('bold, cunning');
	});

	it('imports legacy profiles without traits as null', async () => {
		const data = makeArchiveData({ ...baseProfile });
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));

		const result = await mergeIncomingStory(await zip.generateAsync({ type: 'uint8array' }));

		expect(result).toBe('merged');
		const rows = await testDb.select<{ traits: string | null }[]>('SELECT traits FROM character_profiles WHERE id = $1', ['cp-1']);
		expect(rows[0].traits).toBeNull();
	});
});

describe('mergeIncomingStory character profile history preservation', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	type ArchiveProfile = NonNullable<StoryExportData['characterProfiles']>[number];
	type ArchiveMessage = StoryExportData['messages'][number];

	function archiveProfile(overrides: Partial<ArchiveProfile> & Pick<ArchiveProfile, 'id' | 'canonicalName'>): ArchiveProfile {
		return {
			actLineId: 'line-1',
			sceneNumber: 1,
			preferredName: overrides.canonicalName,
			aliases: [overrides.canonicalName],
			logline: 'logline',
			state: null,
			goal: null,
			relationships: null,
			voice: null,
			sceneDetails: '',
			importance: 2,
			removed: false,
			createdAt: 100,
			updatedAt: 100,
			...overrides,
		};
	}

	function archiveMessage(id: string, sceneNumber: number): ArchiveMessage {
		return {
			id,
			role: 'assistant',
			content: `content ${id}`,
			reasoning: null,
			metadata: null,
			variables: null,
			actSummary: null,
			scenePlot: null,
			importantPhrases: null,
			sceneNumber,
			createdAt: 1000,
		};
	}

	function makeArchive(opts: {
		entries?: string[];
		messages?: ArchiveMessage[];
		profiles?: ArchiveProfile[];
		version?: number;
	}): StoryExportData {
		const entries = opts.entries ?? ['m1', 'm2'];
		const data: StoryExportData = {
			version: opts.version ?? CURRENT_ARCHIVE_VERSION,
			story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
			storyFolder: { storyId: 'story-1', folderName: 'Test', createdAt: 1000 },
			acts: [
				{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			],
			actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
			actLineEvents: [],
			actLineEntries: entries.map((messageId, index) => ({ actLineId: 'line-1', messageId, sequence: index + 1 })),
			actLinePremises: [],
			directorNotes: [],
			messages: opts.messages ?? entries.map((id, index) => archiveMessage(id, index + 1)),
		};
		if (opts.profiles !== undefined) data.characterProfiles = opts.profiles;
		return data;
	}

	async function merge(data: StoryExportData): Promise<string> {
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));
		return mergeIncomingStory(await zip.generateAsync({ type: 'uint8array' }));
	}

	async function seedScenes(ids: string[]): Promise<void> {
		await seedLine(ids);
		for (const [index, id] of ids.entries()) {
			await testDb.execute('UPDATE messages SET scene_number = $1 WHERE id = $2', [index + 1, id]);
		}
	}

	async function seedProfile(overrides: Partial<ArchiveProfile> & Pick<ArchiveProfile, 'id' | 'canonicalName'>): Promise<void> {
		const p = archiveProfile(overrides);
		await insertCharacterProfile({
			id: p.id,
			actLineId: p.actLineId,
			sceneNumber: p.sceneNumber,
			canonicalName: p.canonicalName,
			preferredName: p.preferredName,
			aliases: p.aliases,
			logline: p.logline,
			state: p.state,
			goal: p.goal,
			relationships: p.relationships,
			voice: p.voice,
			traits: p.traits,
			sceneDetails: p.sceneDetails,
			importance: p.importance as CharacterImportance,
			removed: p.removed,
			createdAt: p.createdAt,
			updatedAt: p.updatedAt,
		});
	}

	async function readProfiles(lineId: string) {
		return testDb.select<{ id: string; canonical_name: string; removed: number; logline: string }[]>(
			'SELECT id, canonical_name, removed, logline FROM character_profiles WHERE act_line_id = $1 ORDER BY canonical_name',
			[lineId]
		);
	}

	async function forkLineId(): Promise<string> {
		const rows = await testDb.select<{ id: string }[]>('SELECT id FROM act_line_meta WHERE id <> $1', ['line-1']);
		expect(rows).toHaveLength(1);
		return rows[0].id;
	}

	// WHY: identical message chains cannot distinguish a remote in-place edit
	// from a local one. The local version survives on a preservation fork and
	// the main line receives the exact incoming snapshot.
	it('same-ID profile edit forks and applies the incoming snapshot', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'local edit', updatedAt: 200 });

		const result = await merge(
			makeArchive({
				profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'remote edit', updatedAt: 300 })],
			})
		);

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => p.logline)).toEqual(['local edit']);
		expect((await readProfiles('line-1')).map((p) => p.logline)).toEqual(['remote edit']);

		// Idempotent: the applied snapshot compares equal on the next pull.
		expect(
			await merge(
				makeArchive({
					profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'remote edit', updatedAt: 300 })],
				})
			)
		).toBe('up-to-date');
		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 2 }]);
	});

	// WHY: a tombstone flip is an edit of the profile row, not an absent row;
	// the add-only overlay would keep the local active row forever.
	it('tombstone update forks and transports removed=true', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, updatedAt: 200 });

		const result = await merge(
			makeArchive({ profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, removed: true, updatedAt: 300 })] })
		);

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => p.removed)).toEqual([0]);
		expect((await readProfiles('line-1')).map((p) => p.removed)).toEqual([1]);

		expect(
			await merge(
				makeArchive({ profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, removed: true, updatedAt: 300 })] })
			)
		).toBe('up-to-date');
	});

	// WHY: a row physically deleted remotely is indistinguishable from a local
	// addition without a common baseline, so the fork preserves local state and
	// the main line mirrors the explicit incoming collection.
	it('physical profile deletion forks and keeps local rows on the fork', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 1, updatedAt: 100 });
		await seedProfile({ id: 'cp-2', canonicalName: 'bob', sceneNumber: 2, updatedAt: 100 });

		const result = await merge(makeArchive({ profiles: [archiveProfile({ id: 'cp-2', canonicalName: 'bob', sceneNumber: 2 })] }));

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => p.canonical_name)).toEqual(['alice', 'bob']);
		expect((await readProfiles('line-1')).map((p) => p.canonical_name)).toEqual(['bob']);

		expect(await merge(makeArchive({ profiles: [archiveProfile({ id: 'cp-2', canonicalName: 'bob', sceneNumber: 2 })] }))).toBe(
			'up-to-date'
		);
	});

	// WHY (legacy omission): v1 archives carry no profile collection at all.
	// Absence is not an empty snapshot, so it must neither fork nor delete.
	it('legacy omission neither forks nor loses local profiles', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, updatedAt: 200 });

		expect(await merge(makeArchive({ version: 1 }))).toBe('up-to-date');

		const lines = await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta');
		expect(lines).toEqual([{ c: 1 }]);
		expect((await readProfiles('line-1')).map((p) => p.id)).toEqual(['cp-1']);
	});

	// WHY: equal normalized histories need no fork; the add-only overlay is a
	// no-op, keeping repeated pulls idempotent.
	it('equal normalized profile histories remain a no-op overlay', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'same', updatedAt: 200 });

		expect(
			await merge(
				makeArchive({ profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'same', updatedAt: 200 })] })
			)
		).toBe('up-to-date');
		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 1 }]);
	});

	// WHY: undefined (legacy) and [] (explicit snapshot) are different answers.
	// An explicit empty collection with no local profiles is equal, not a fork.
	it('explicit empty snapshot with no local profiles is a no-op', async () => {
		await seedScenes(['m1', 'm2']);
		expect(await merge(makeArchive({ profiles: [] }))).toBe('up-to-date');
		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 1 }]);
	});

	// WHY: the reverse direction of legacy omission — an explicit empty snapshot
	// is a real remote deletion of every row. A truthiness guard on the incoming
	// collection would treat it as omission and silently keep local history.
	it('explicit empty snapshot forks over local profiles and applies zero rows', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, updatedAt: 200 });

		const result = await merge(makeArchive({ profiles: [] }));

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		// cloneCharacterProfiles re-keys rows, so identity is asserted by content.
		expect((await readProfiles(forkId)).map((p) => [p.canonical_name, p.logline])).toEqual([['alice', 'logline']]);
		expect(await readProfiles('line-1')).toHaveLength(0);

		// Idempotent: both sides now hold the empty snapshot.
		expect(await merge(makeArchive({ profiles: [] }))).toBe('up-to-date');
	});

	// WHY: a tip fork (no scene number anywhere in the prefix) still has a
	// complete profile history. Skipping the clone there dropped it from both
	// copies, because the yielded line's rows are deleted right after the fork.
	it('fork keeps local tombstones when the prefix has no scene number', async () => {
		await seedLine(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: null, removed: true, updatedAt: 200 });

		const result = await merge(makeArchive({ profiles: [] }));

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => [p.canonical_name, p.removed])).toEqual([['alice', 1]]);
		expect(await readProfiles('line-1')).toHaveLength(0);
	});

	// WHY: remote-stale keeps the local narrative; profiles must not fork it.
	it('remote-stale lineage ignores differing remote profiles', async () => {
		await seedScenes(['m1', 'm2', 'm3']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'local', updatedAt: 200 });

		const result = await merge(
			makeArchive({
				entries: ['m1', 'm2'],
				profiles: [archiveProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, logline: 'remote', updatedAt: 300 })],
			})
		);

		expect(result).toBe('up-to-date');
		expect((await getMessagesForLine('line-1')).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
		expect((await readProfiles('line-1')).map((p) => p.logline)).toEqual(['local']);
	});

	// WHY: divergent local-stale-style replacement paths must carry local
	// tombstones onto the fork; the main line mirrors the incoming snapshot.
	it('divergent lineage preserves local tombstones on the fork', async () => {
		await seedScenes(['m1', 'm2', 'm3']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, removed: true, updatedAt: 200 });

		const result = await merge(
			makeArchive({
				entries: ['m1', 'm2', 'm4'],
				messages: [archiveMessage('m1', 1), archiveMessage('m2', 2), archiveMessage('m4', 3)],
				profiles: [archiveProfile({ id: 'cp-2', canonicalName: 'bob', sceneNumber: 2 })],
			})
		);

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => [p.canonical_name, p.removed])).toEqual([['alice', 1]]);
		expect((await readProfiles('line-1')).map((p) => [p.canonical_name, p.removed])).toEqual([['bob', 0]]);
	});

	// WHY: local-stale + local-only profile state escalates to a fork; the
	// tombstone survives there and the imported line is the exact snapshot.
	it('local-stale replacement preserves local tombstones on the fork', async () => {
		await seedScenes(['m1', 'm2']);
		await seedProfile({ id: 'cp-1', canonicalName: 'alice', sceneNumber: 2, removed: true, updatedAt: 200 });

		const result = await merge(
			makeArchive({
				entries: ['m1', 'm2', 'm3'],
				messages: [archiveMessage('m1', 1), archiveMessage('m2', 2), archiveMessage('m3', 3)],
				profiles: [],
			})
		);

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readProfiles(forkId)).map((p) => p.removed)).toEqual([1]);
		expect(await readProfiles('line-1')).toHaveLength(0);
	});

	// WHY (v1–v4): missing `removed` imports as active, never as a tombstone.
	it('legacy entries without removed import as active', async () => {
		await seedScenes(['m1', 'm2']);

		const result = await merge(
			makeArchive({
				version: 4,
				profiles: [
					{
						id: 'cp-legacy',
						actLineId: 'line-1',
						sceneNumber: 2,
						canonicalName: 'alice',
						preferredName: 'Alice',
						aliases: ['Alice'],
						logline: 'legacy',
						state: null,
						goal: null,
						relationships: null,
						voice: null,
						sceneDetails: '',
						importance: 2,
						createdAt: 100,
						updatedAt: 100,
					},
				],
			})
		);

		expect(result).toBe('merged');
		expect((await readProfiles('line-1')).map((p) => p.removed)).toEqual([0]);
	});

	// WHY (cloud trust boundary): a malformed tombstone must reject the whole
	// archive instead of being coerced into an active or erased row.
	it('rejects malformed removed values on the cloud import boundary', async () => {
		const data = makeArchive({
			profiles: [{ ...archiveProfile({ id: 'cp-1', canonicalName: 'alice' }), removed: 'yes' } as unknown as ArchiveProfile],
		});
		await expect(merge(data)).rejects.toThrow(/Invalid cloud archive/);
	});
});

describe('profileHistoriesEqual', () => {
	type Profile = {
		id: string;
		sceneNumber: number | null;
		canonicalName: string;
		preferredName: string;
		aliases: string[];
		logline: string;
		state: string | null;
		traits?: string[];
		sceneDetails: string;
		importance: number;
		removed?: boolean;
		createdAt: number;
		updatedAt: number;
	};

	function p(overrides: Partial<Profile> = {}): Profile {
		return {
			id: 'cp-1',
			sceneNumber: 1,
			canonicalName: 'alice',
			preferredName: 'Alice',
			aliases: ['Alice', 'Al'],
			logline: 'hero',
			state: null,
			sceneDetails: '',
			importance: 2,
			createdAt: 10,
			updatedAt: 20,
			...overrides,
		};
	}

	// WHY: ID/timestamp equality is insufficient — these are the fields the
	// overlay used to ignore, losing edits and resurrecting deletions. Every
	// fingerprint field is pinned so dropping one cannot pass silently.
	it('compares all fields, not only ids and timestamps', () => {
		expect(profileHistoriesEqual([p()], [p()])).toBe(true);
		expect(profileHistoriesEqual([p()], [p({ removed: true })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ logline: 'villain' })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ aliases: ['Al', 'Alice'] })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ traits: ['bold'] })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ sceneDetails: '- 2: x' })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ state: 'tired' })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ importance: 3 })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ createdAt: 11 })])).toBe(false);
		expect(profileHistoriesEqual([p()], [p({ updatedAt: 21 })])).toBe(false);
	});

	// WHY: the query has no ORDER BY contract; identity-keyed comparison must not
	// read a reordered snapshot as an edit and fork needlessly.
	it('ignores row order', () => {
		const alice = p();
		const bob = p({ id: 'cp-2', canonicalName: 'bob', preferredName: 'Bob' });
		expect(profileHistoriesEqual([alice, bob], [bob, alice])).toBe(true);
	});

	it('treats an absent removed field as active', () => {
		expect(profileHistoriesEqual([p()], [p({ removed: false })])).toBe(true);
	});
});

describe('mergeIncomingStory inventory history preservation', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		await stories.createStory('story-1', 'Test', 'en');
		await acts.createAct('act-1', 'story-1', 'Act 1', 1);
		setFileSystem(new InMemoryFileSystem());
	});

	afterEach(() => {
		testDb.close();
	});

	type ArchiveInventoryRow = NonNullable<StoryExportData['inventory']>[number];
	type ArchiveMessage = StoryExportData['messages'][number];

	function archiveInventory(overrides: Partial<ArchiveInventoryRow> & Pick<ArchiveInventoryRow, 'id'>): ArchiveInventoryRow {
		return {
			storyId: 'story-1',
			actLineId: 'line-1',
			messageId: 'm1',
			sceneNumber: 1,
			characterCanonicalName: 'alice',
			itemName: 'Sword',
			eventType: 'acquired',
			category: 'equipment',
			equipStatus: 'carried',
			description: null,
			createdAt: '2026-01-01 00:00:00',
			...overrides,
		};
	}

	function archiveMessage(id: string, sceneNumber: number): ArchiveMessage {
		return {
			id,
			role: 'assistant',
			content: `content ${id}`,
			reasoning: null,
			metadata: null,
			variables: null,
			actSummary: null,
			scenePlot: null,
			importantPhrases: null,
			sceneNumber,
			createdAt: 1000,
		};
	}

	function makeArchive(opts: { entries?: string[]; inventory?: ArchiveInventoryRow[]; version?: number }): StoryExportData {
		const entries = opts.entries ?? ['m1', 'm2'];
		const data: StoryExportData = {
			version: opts.version ?? CURRENT_ARCHIVE_VERSION,
			story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
			storyFolder: { storyId: 'story-1', folderName: 'Test', createdAt: 1000 },
			acts: [
				{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
			],
			actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
			actLineEvents: [],
			actLineEntries: entries.map((messageId, index) => ({ actLineId: 'line-1', messageId, sequence: index + 1 })),
			actLinePremises: [],
			directorNotes: [],
			messages: entries.map((id, index) => archiveMessage(id, index + 1)),
		};
		if (opts.inventory !== undefined) data.inventory = opts.inventory;
		return data;
	}

	async function merge(data: StoryExportData): Promise<string> {
		const zip = new JSZip();
		zip.file('story-data.json', JSON.stringify(data));
		return mergeIncomingStory(await zip.generateAsync({ type: 'uint8array' }));
	}

	async function seedScenes(ids: string[]): Promise<void> {
		await seedLine(ids);
		for (const [index, id] of ids.entries()) {
			await testDb.execute('UPDATE messages SET scene_number = $1 WHERE id = $2', [index + 1, id]);
		}
	}

	async function readInventory(lineId: string) {
		return testDb.select<{ id: string; item_name: string; equip_status: string }[]>(
			'SELECT id, item_name, equip_status FROM inventory WHERE act_line_id = $1 ORDER BY id',
			[lineId]
		);
	}

	async function forkLineId(): Promise<string> {
		const rows = await testDb.select<{ id: string }[]>('SELECT id FROM act_line_meta WHERE id <> $1', ['line-1']);
		expect(rows).toHaveLength(1);
		return rows[0].id;
	}

	// WHY (review-1): identical message chains cannot distinguish a remote
	// in-place entry edit from a local one. The local version survives on a
	// preservation fork and the main line receives the exact incoming snapshot.
	it('same-ID inventory edit forks and applies the incoming snapshot', async () => {
		await seedScenes(['m1', 'm2']);
		await insertInventoryRows([archiveInventory({ id: 'inv-1' })]);

		const result = await merge(
			makeArchive({ inventory: [archiveInventory({ id: 'inv-1', eventType: 'equipped', equipStatus: 'equipped' })] })
		);

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		expect((await readInventory(forkId)).map((r) => r.equip_status)).toEqual(['carried']);
		expect(await readInventory('line-1')).toEqual([{ id: 'inv-1', item_name: 'Sword', equip_status: 'equipped' }]);

		// Idempotent: the applied snapshot compares equal on the next pull.
		expect(
			await merge(makeArchive({ inventory: [archiveInventory({ id: 'inv-1', eventType: 'equipped', equipStatus: 'equipped' })] }))
		).toBe('up-to-date');
		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 2 }]);
	});

	// WHY: the common continue-on-another-device case — the delete-and-import
	// path wiped local inventory before this fix and restored nothing.
	it('local-stale replacement imports incoming inventory rows', async () => {
		await seedScenes(['m1']);

		const result = await merge(
			makeArchive({ entries: ['m1', 'm2'], inventory: [archiveInventory({ id: 'inv-1', messageId: 'm2', sceneNumber: 2 })] })
		);

		expect(result).toBe('merged');
		expect(await readInventory('line-1')).toEqual([{ id: 'inv-1', item_name: 'Sword', equip_status: 'carried' }]);
		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 1 }]);
	});

	// WHY (legacy omission): pre-v6 archives carry no inventory collection at
	// all. Absence is not an empty snapshot, so it must neither fork nor delete.
	it('legacy omission neither forks nor loses local inventory', async () => {
		await seedScenes(['m1', 'm2']);
		await insertInventoryRows([archiveInventory({ id: 'inv-1' })]);

		expect(await merge(makeArchive({ version: 5 }))).toBe('up-to-date');

		expect(await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM act_line_meta')).toEqual([{ c: 1 }]);
		expect((await readInventory('line-1')).map((r) => r.id)).toEqual(['inv-1']);
	});

	// WHY: an explicit empty snapshot is a real "all rows deleted remotely"
	// state; the local rows survive on the fork and the main line mirrors it.
	it('explicit empty snapshot forks over local inventory and applies zero rows', async () => {
		await seedScenes(['m1', 'm2']);
		await insertInventoryRows([archiveInventory({ id: 'inv-1' })]);

		const result = await merge(makeArchive({ inventory: [] }));

		expect(result).toBe('merged');
		const forkId = await forkLineId();
		// cloneInventory re-keys rows with fresh ids; identity is the item history.
		expect((await readInventory(forkId)).map((r) => r.item_name)).toEqual(['Sword']);
		expect(await readInventory('line-1')).toEqual([]);
	});

	// WHY: a line created on the other device imports whole — its inventory
	// rows must ride along or the new line silently loses item tracking.
	it('imports inventory for a line created on the other device', async () => {
		await seedScenes(['m1', 'm2']);

		const data = makeArchive({ inventory: [] });
		data.actLineMeta.push({ id: 'line-2', actId: 'act-1', name: 'Branch', isMainLine: false, createdAt: 1000, plotMode: 'guidance' });
		data.actLineEntries.push({ actLineId: 'line-2', messageId: 'm3', sequence: 1 });
		data.messages.push(archiveMessage('m3', 1));
		data.inventory = [archiveInventory({ id: 'inv-9', actLineId: 'line-2', messageId: 'm3' })];

		expect(await merge(data)).toBe('merged');
		expect(await readInventory('line-2')).toEqual([{ id: 'inv-9', item_name: 'Sword', equip_status: 'carried' }]);
	});
});

describe('inventoryHistoriesEqual', () => {
	function localRow(overrides: Partial<InventoryRow> = {}): InventoryRow {
		return {
			id: 'inv-1',
			story_id: 'story-1',
			act_line_id: 'line-1',
			message_id: 'm1',
			scene_number: 1,
			character_canonical_name: 'alice',
			item_name: 'Sword',
			event_type: 'acquired',
			category: 'equipment',
			equip_status: 'carried',
			description: null,
			created_at: '2026-01-01 00:00:00',
			...overrides,
		};
	}

	function incomingRow(overrides: Partial<InsertInventoryRowInput> = {}): InsertInventoryRowInput {
		return {
			id: 'inv-1',
			storyId: 'story-1',
			actLineId: 'line-1',
			messageId: 'm1',
			sceneNumber: 1,
			characterCanonicalName: 'alice',
			itemName: 'Sword',
			eventType: 'acquired',
			category: 'equipment',
			equipStatus: 'carried',
			description: null,
			createdAt: '2026-01-01 00:00:00',
			...overrides,
		};
	}

	// WHY: ID equality is insufficient — entries are mutable through the context
	// UI, so every user-visible field is pinned; dropping one cannot pass silently.
	it('compares all mutable fields, not only ids', () => {
		expect(inventoryHistoriesEqual([localRow()], [incomingRow()])).toBe(true);
		expect(inventoryHistoriesEqual([localRow()], [incomingRow({ eventType: 'used' })])).toBe(false);
		expect(inventoryHistoriesEqual([localRow()], [incomingRow({ category: null })])).toBe(false);
		expect(inventoryHistoriesEqual([localRow()], [incomingRow({ equipStatus: 'lost' })])).toBe(false);
		expect(inventoryHistoriesEqual([localRow()], [incomingRow({ description: 'chipped' })])).toBe(false);
		expect(inventoryHistoriesEqual([localRow()], [incomingRow({ id: 'inv-2' })])).toBe(false);
	});

	// WHY: the query has no ORDER BY contract; identity-keyed comparison must not
	// read a reordered snapshot as an edit and fork needlessly.
	it('ignores row order and detects length differences', () => {
		const a = localRow();
		const b = localRow({ id: 'inv-2', item_name: 'Shield' });
		expect(inventoryHistoriesEqual([a, b], [incomingRow({ id: 'inv-2', itemName: 'Shield' }), incomingRow()])).toBe(true);
		expect(inventoryHistoriesEqual([a, b], [incomingRow()])).toBe(false);
	});
});
