import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// DB test setup follows the sync-merge.test.ts pattern: better-sqlite3
// in-memory database injected via a mocked database module.
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

// story-exporter imports downloadExport at module level; never called here.
vi.mock('#lib/db/data-portability.ts', () => ({ downloadExport: vi.fn() }));

import { createTestDatabase } from '../../helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';
import { createStory } from '#lib/db/stories.ts';
import { createAct } from '#lib/db/acts.ts';
import { createActLine, insertActLineEntries } from '#lib/db/act-lines.ts';
import { insertMessage, type Message } from '#lib/db/messages.ts';
import { upsertMessagePhases } from '#lib/db/message-phases.ts';
import { insertCharacterProfile } from '#lib/db/character-profiles.ts';
import { buildStoryExportData } from '#lib/features/story-export-load/story-exporter.ts';
import { CURRENT_ARCHIVE_VERSION } from '#lib/features/story-export-load/archive-schema.ts';

function messageRow(id: string, role: Message['role'], content: string): Message {
	return { id, role, content, createdAt: Date.now() };
}

describe('buildStoryExportData messagePhases', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
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

	it('exports archive version 5', async () => {
		const data = await buildStoryExportData('story-1');
		expect(CURRENT_ARCHIVE_VERSION).toBe(5);
		expect(data.version).toBe(5);
	});

	// WHY: traits must survive the export→import round-trip across devices.
	it('exports profile traits as an array', async () => {
		await insertCharacterProfile({
			id: 'cp-1',
			actLineId: 'line-1',
			sceneNumber: 1,
			canonicalName: 'alice',
			preferredName: 'Alice',
			aliases: [],
			logline: 'A determined hero.',
			traits: ['bold', 'cunning'],
			sceneDetails: '',
			importance: 2,
		});

		const data = await buildStoryExportData('story-1');
		expect(data.characterProfiles?.[0].traits).toEqual(['bold', 'cunning']);
	});

	// WHY (archive v5): tombstones are part of the portable history. Exporting
	// only active rows would resurrect erased characters on another device.
	it('exports removed and the complete profile history', async () => {
		await testDb.execute('UPDATE messages SET scene_number = 1 WHERE id = $1', ['m1']);
		await testDb.execute('UPDATE messages SET scene_number = 2 WHERE id = $1', ['m2']);
		await insertCharacterProfile({
			id: 'cp-old',
			actLineId: 'line-1',
			sceneNumber: 1,
			canonicalName: 'alice',
			preferredName: 'Alice',
			aliases: ['Alice'],
			logline: 'first version',
			sceneDetails: '',
			importance: 2,
			removed: false,
			createdAt: 10,
			updatedAt: 10,
		});
		await insertCharacterProfile({
			id: 'cp-new',
			actLineId: 'line-1',
			sceneNumber: 2,
			canonicalName: 'alice',
			preferredName: 'Alice',
			aliases: ['Alice'],
			logline: 'erased version',
			sceneDetails: '',
			importance: 2,
			removed: true,
			createdAt: 20,
			updatedAt: 20,
		});

		const data = await buildStoryExportData('story-1');

		expect(data.characterProfiles).toHaveLength(2);
		const byId = new Map(data.characterProfiles!.map((p) => [p.id, p]));
		expect(byId.get('cp-old')?.removed).toBe(false);
		expect(byId.get('cp-new')?.removed).toBe(true);
	});

	// WHY: the archive is the only carrier of phases across devices; wrong
	// shape/order here silently corrupts every downstream restore.
	it('includes phase rows ordered by sequence for exported messages', async () => {
		await upsertMessagePhases('m1', [
			{ phaseName: 'WRITER', content: 'draft', reasoning: 'thinking' },
			{ phaseName: 'EDITOR', content: 'final' },
		]);
		const data = await buildStoryExportData('story-1');
		expect(data.messagePhases).toEqual([
			{ messageId: 'm1', phaseName: 'WRITER', reasoning: 'thinking', content: 'draft', sequence: 0 },
			{ messageId: 'm1', phaseName: 'EDITOR', reasoning: null, content: 'final', sequence: 1 },
		]);
	});

	// WHY (handoff §4): export works on selected act lines only — phases must
	// ride the same collectMessageIds filter, never leak unreferenced rows.
	it('excludes phases of messages not referenced by any act line', async () => {
		await insertMessage(messageRow('orphan', 'assistant', 'orphaned'));
		await upsertMessagePhases('orphan', [{ phaseName: 'WRITER', content: 'ghost' }]);
		await upsertMessagePhases('m1', [{ phaseName: 'EDITOR', content: 'kept' }]);
		const data = await buildStoryExportData('story-1');
		expect(data.messagePhases?.map((p) => p.messageId)).toEqual(['m1']);
	});

	it('emits an empty array when no phases exist', async () => {
		const data = await buildStoryExportData('story-1');
		expect(data.messagePhases).toEqual([]);
	});
});
