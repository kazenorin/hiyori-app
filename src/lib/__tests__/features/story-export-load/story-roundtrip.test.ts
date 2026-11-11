import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';

// DB test setup follows the sync-merge.test.ts pattern.
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
	setLogLevel: vi.fn(),
}));

vi.mock('#lib/db/data-portability.ts', () => ({ downloadExport: vi.fn() }));

// loadStoryOverwrite/loadStoryAsNew end with store refresh + selection;
// irrelevant to phase restoration.
vi.mock('#lib/stores/stories.svelte.ts', () => ({
	loadStories: vi.fn(async () => {}),
	selectStory: vi.fn(async () => {}),
}));

vi.mock('#lib/ai/chat/run-manager.ts', () => ({ cleanupActLine: vi.fn(async () => {}) }));

// loadStoryAsNew resolves a collision-free folder name via fs scanning;
// a fixed name keeps the test on phases.
vi.mock('#lib/fs/story-folders.ts', () => ({ resolveStoryFolder: vi.fn(async () => 'new-story-folder') }));

import { createTestDatabase } from '../../helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';
import { createStory } from '#lib/db/stories.ts';
import { createAct } from '#lib/db/acts.ts';
import { createActLine, insertActLineEntries } from '#lib/db/act-lines.ts';
import { insertMessage, type Message } from '#lib/db/messages.ts';
import { upsertMessagePhases, getPhasesForMessages, deletePhasesForMessages } from '#lib/db/message-phases.ts';
import { insertInventoryRows, getInventoryRowsForActLines } from '#lib/db/inventory.ts';
import { buildStoryExportData } from '#lib/features/story-export-load/story-exporter.ts';
import { loadStoryOverwrite, loadStoryAsNew } from '#lib/features/story-export-load/story-loader.ts';
import type { StoryExportData } from '#lib/features/story-export-load/archive-schema.ts';
import { setFileSystem } from '#lib/fs/file-system.ts';
import { InMemoryFileSystem } from '#lib/fs/file-system-in-memory.ts';

function messageRow(id: string, role: Message['role'], content: string): Message {
	return { id, role, content, createdAt: Date.now() };
}

function makeZip(data: StoryExportData): JSZip {
	const zip = new JSZip();
	zip.file('story-data.json', JSON.stringify(data, null, 2));
	return zip;
}

const M1_PHASES = [
	{ phaseName: 'WRITER' as const, content: 'draft', reasoning: 'why' },
	{ phaseName: 'EDITOR' as const, content: 'final' },
];

describe('story load round-trips messagePhases', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		setFileSystem(new InMemoryFileSystem());
		await createStory('story-1', 'Test', 'en');
		await createAct('act-1', 'story-1', 'Act 1', 1);
		await createActLine('line-1', 'act-1', 'Main', true);
		await insertMessage(messageRow('m1', 'assistant', 'scene one'));
		await insertMessage(messageRow('m2', 'user', 'do this'));
		await insertActLineEntries([
			{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
			{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
		]);
	});

	afterEach(() => {
		testDb.close();
	});

	// WHY: overwrite is the restore-same-install path; sequence and reasoning
	// must survive exactly or the dialog renders phases in the wrong order.
	it('overwrite round-trip preserves phase fields and sequence', async () => {
		await upsertMessagePhases('m1', M1_PHASES);
		const data = await buildStoryExportData('story-1');
		const zip = makeZip(data);

		await deletePhasesForMessages(['m1']); // simulate a fresh install
		const result = await loadStoryOverwrite(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		expect((await getPhasesForMessages(['m1'])).get('m1')).toEqual([
			{ phaseName: 'WRITER', content: 'draft', reasoning: 'why' },
			{ phaseName: 'EDITOR', content: 'final' },
		]);
		const rows = await testDb.select<{ phase_name: string; sequence: number }[]>(
			'SELECT phase_name, sequence FROM message_phases WHERE message_id = $1 ORDER BY sequence',
			['m1']
		);
		expect(rows).toEqual([
			{ phase_name: 'WRITER', sequence: 0 },
			{ phase_name: 'EDITOR', sequence: 1 },
		]);
	});

	// WHY (acceptance): repeated loads must not duplicate rows — the
	// (message_id, phase_name) upsert is the guard.
	it('overwrite twice produces no duplicate phase rows', async () => {
		await upsertMessagePhases('m1', M1_PHASES);
		const data = await buildStoryExportData('story-1');
		const zip = makeZip(data);
		await loadStoryOverwrite(data, ['line-1'], zip);
		await loadStoryOverwrite(data, ['line-1'], zip);
		const rows = await testDb.select<{ c: number }[]>('SELECT COUNT(*) AS c FROM message_phases');
		expect(rows[0].c).toBe(2);
	});

	// WHY (handoff §4): v1/v2 archives carry no messagePhases; load must
	// behave exactly as before — messages restored, zero phase rows, no error.
	it('archive without messagePhases loads messages and no phases', async () => {
		const data = await buildStoryExportData('story-1');
		delete data.messagePhases;
		const zip = makeZip(data);

		const result = await loadStoryOverwrite(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		expect((await getPhasesForMessages(['m1', 'm2'])).size).toBe(0);
	});

	// WHY: Overwrite treats the archive as authoritative — local phases for
	// re-imported messages are dropped when the archive predates phase
	// persistence; Load-as-new never touches the source story.
	it('overwrite of a phase-less archive drops local phases for re-imported messages', async () => {
		await upsertMessagePhases('m1', M1_PHASES);
		const data = await buildStoryExportData('story-1');
		delete data.messagePhases; // simulate a pre-v3 archive
		const zip = makeZip(data);

		const result = await loadStoryOverwrite(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		expect((await getPhasesForMessages(['m1'])).size).toBe(0);
	});

	// WHY: as-new must not leak original ids anywhere; phases belong to the
	// remapped messages and only those.
	it('as-new round-trip attaches phases to remapped message ids', async () => {
		await upsertMessagePhases('m1', M1_PHASES);
		const data = await buildStoryExportData('story-1');
		const zip = makeZip(data);
		await deletePhasesForMessages(['m1']); // isolate: only the new story's rows remain to assert on

		const result = await loadStoryAsNew(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		expect(result.storyId).not.toBe('story-1');
		const rows = await testDb.select<{ message_id: string; phase_name: string; content: string; sequence: number }[]>(
			'SELECT message_id, phase_name, content, sequence FROM message_phases ORDER BY sequence'
		);
		expect(rows).toHaveLength(2);
		for (const row of rows) expect(row.message_id).not.toBe('m1');
		const orphans = await testDb.select<{ c: number }[]>(
			'SELECT COUNT(*) AS c FROM message_phases mp LEFT JOIN messages m ON m.id = mp.message_id WHERE m.id IS NULL'
		);
		expect(orphans[0].c).toBe(0);
	});

	const INVENTORY_ROW = {
		id: 'inv-1',
		storyId: 'story-1',
		actLineId: 'line-1',
		messageId: 'm1',
		sceneNumber: null,
		characterCanonicalName: 'alice',
		itemName: 'Sword',
		eventType: 'acquired',
		category: 'equipment',
		equipStatus: 'carried',
		description: 'a blade',
		createdAt: '2026-01-01 00:00:00',
	};

	// WHY (review-1): export→delete→import must restore inventory rows — the
	// delete wipes the table for the story's lines, so the archive is the only
	// carrier.
	it('overwrite round-trip preserves inventory rows', async () => {
		await insertInventoryRows([INVENTORY_ROW]);
		const data = await buildStoryExportData('story-1');
		const zip = makeZip(data);

		const result = await loadStoryOverwrite(data, ['line-1'], zip); // deleteActLine wipes the rows

		expect(result.success).toBe(true);
		const rows = await getInventoryRowsForActLines(['line-1']);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			id: 'inv-1',
			story_id: 'story-1',
			act_line_id: 'line-1',
			message_id: 'm1',
			character_canonical_name: 'alice',
			item_name: 'Sword',
			event_type: 'acquired',
			category: 'equipment',
			equip_status: 'carried',
			description: 'a blade',
			created_at: '2026-01-01 00:00:00',
		});
	});

	// WHY: as-new must not leak original ids — rows belong to the new story's
	// remapped line and message ids, and the source story's rows stay untouched.
	it('as-new round-trip remaps inventory rows into the new story', async () => {
		await insertInventoryRows([INVENTORY_ROW]);
		const data = await buildStoryExportData('story-1');
		const zip = makeZip(data);

		const result = await loadStoryAsNew(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		const rows = await getInventoryRowsForActLines(['line-1']);
		expect(rows).toHaveLength(1); // source story untouched
		const copies = await testDb.select<{ id: string; story_id: string; act_line_id: string; message_id: string; item_name: string }[]>(
			'SELECT id, story_id, act_line_id, message_id, item_name FROM inventory WHERE story_id = $1',
			[result.storyId]
		);
		expect(copies).toHaveLength(1);
		expect(copies[0].id).not.toBe('inv-1');
		expect(copies[0].act_line_id).not.toBe('line-1');
		expect(copies[0].message_id).not.toBe('m1');
		expect(copies[0].item_name).toBe('Sword');
	});

	// WHY (legacy compatibility): pre-v6 archives carry no inventory collection;
	// load must behave exactly as before — no error, zero rows.
	it('archive without inventory loads with zero inventory rows', async () => {
		await insertInventoryRows([INVENTORY_ROW]);
		const data = await buildStoryExportData('story-1');
		delete data.inventory; // simulate a pre-v6 archive
		const zip = makeZip(data);
		await testDb.execute('DELETE FROM inventory');

		const result = await loadStoryOverwrite(data, ['line-1'], zip);

		expect(result.success).toBe(true);
		expect(await getInventoryRowsForActLines(['line-1'])).toHaveLength(0);
	});
});
