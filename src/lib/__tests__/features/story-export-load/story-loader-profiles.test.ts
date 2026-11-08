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

// loadStoryOverwrite/loadStoryAsNew end with store refresh + selection.
vi.mock('#lib/stores/stories.svelte.ts', () => ({
	loadStories: vi.fn(async () => {}),
	selectStory: vi.fn(async () => {}),
}));

vi.mock('#lib/ai/chat/run-manager.ts', () => ({ cleanupActLine: vi.fn(async () => {}) }));

vi.mock('#lib/fs/story-folders.ts', () => ({ resolveStoryFolder: vi.fn(async () => 'new-story-folder') }));

import { createTestDatabase } from '../../helpers/test-database';
import { runMigrations } from '#lib/db/migrations.ts';
import { createStory } from '#lib/db/stories.ts';
import { createAct } from '#lib/db/acts.ts';
import { createActLine, insertActLineEntries } from '#lib/db/act-lines.ts';
import { insertMessage } from '#lib/db/messages.ts';
import { insertCharacterProfile } from '#lib/db/character-profiles.ts';
import { loadStoryOverwrite, loadStoryAsNew, toCharacterProfileInputs } from '#lib/features/story-export-load/story-loader.ts';
import { CURRENT_ARCHIVE_VERSION, type StoryExportData } from '#lib/features/story-export-load/archive-schema.ts';
import { setFileSystem } from '#lib/fs/file-system.ts';
import { InMemoryFileSystem } from '#lib/fs/file-system-in-memory.ts';

type ArchiveProfile = NonNullable<StoryExportData['characterProfiles']>[number];

function profile(overrides: Partial<ArchiveProfile> & Pick<ArchiveProfile, 'id' | 'canonicalName'>): ArchiveProfile {
	return {
		actLineId: 'line-1',
		sceneNumber: 1,
		preferredName: overrides.canonicalName,
		aliases: [`${overrides.canonicalName}-alias`],
		logline: 'logline',
		state: null,
		goal: null,
		relationships: null,
		voice: null,
		sceneDetails: '',
		importance: 2,
		createdAt: 1000,
		updatedAt: 1000,
		...overrides,
	};
}

function makeArchiveData(profiles?: ArchiveProfile[], version = CURRENT_ARCHIVE_VERSION): StoryExportData {
	const data: StoryExportData = {
		version,
		story: { id: 'story-1', name: 'Test', locale: 'en', createdAt: 1000, updatedAt: 2000 },
		storyFolder: { storyId: 'story-1', folderName: 'test-story', createdAt: 1000 },
		acts: [
			{ id: 'act-1', storyId: 'story-1', name: 'Act 1', actNumber: 1, continuesFromActLineId: null, createdAt: 1000, updatedAt: 2000 },
		],
		actLineMeta: [{ id: 'line-1', actId: 'act-1', name: 'Main', isMainLine: true, createdAt: 1000, plotMode: 'guidance' }],
		actLineEvents: [],
		actLineEntries: [
			{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
			{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
		],
		actLinePremises: [],
		directorNotes: [],
		messages: [
			{
				id: 'm1',
				role: 'assistant',
				content: 'scene one',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 1,
				createdAt: 1000,
			},
			{
				id: 'm2',
				role: 'user',
				content: 'do this',
				reasoning: null,
				metadata: null,
				variables: null,
				actSummary: null,
				scenePlot: null,
				importantPhrases: null,
				sceneNumber: 2,
				createdAt: 2000,
			},
		],
	};
	if (profiles !== undefined) data.characterProfiles = profiles;
	return data;
}

function makeZip(data: StoryExportData): JSZip {
	const zip = new JSZip();
	zip.file('story-data.json', JSON.stringify(data, null, 2));
	return zip;
}

describe('story loader character profile history', () => {
	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();
		setFileSystem(new InMemoryFileSystem());
		await createStory('story-1', 'Test', 'en');
		await createAct('act-1', 'story-1', 'Act 1', 1);
		await createActLine('line-1', 'act-1', 'Main', true);
		await insertMessage({ id: 'm1', role: 'assistant', content: 'scene one', sceneNumber: 1, createdAt: 1000 });
		await insertMessage({ id: 'm2', role: 'user', content: 'do this', sceneNumber: 2, createdAt: 2000 });
		await insertActLineEntries([
			{ actLineId: 'line-1', messageId: 'm1', sequence: 1 },
			{ actLineId: 'line-1', messageId: 'm2', sequence: 2 },
		]);
	});

	afterEach(() => {
		testDb.close();
	});

	// WHY (overwrite): restore-same-install must not resurrect an erased
	// character; the archive's tombstone is authoritative.
	it('overwrite import preserves tombstones and active rows', async () => {
		await insertCharacterProfile({
			id: 'cp-erased',
			actLineId: 'line-1',
			sceneNumber: 2,
			canonicalName: 'alice',
			preferredName: 'Alice',
			aliases: ['Alice'],
			logline: 'older active copy',
			sceneDetails: '',
			importance: 2,
			createdAt: 500,
			updatedAt: 500,
		});
		const data = makeArchiveData([
			profile({ id: 'cp-erased', canonicalName: 'alice', sceneNumber: 2, removed: true, updatedAt: 1500 }),
			profile({ id: 'cp-active', canonicalName: 'bob', sceneNumber: 1, removed: false }),
		]);

		const result = await loadStoryOverwrite(data, ['line-1'], makeZip(data));

		expect(result.success).toBe(true);
		const rows = await testDb.select<{ id: string; removed: number }[]>('SELECT id, removed FROM character_profiles ORDER BY id');
		expect(rows).toEqual([
			{ id: 'cp-active', removed: 0 },
			{ id: 'cp-erased', removed: 1 },
		]);
	});

	// WHY (new story): the ID rewrite must keep the tombstone flag, otherwise a
	// duplicated story silently revives erased characters.
	it('new-story import remaps profile IDs and preserves removed', async () => {
		const data = makeArchiveData([
			profile({ id: 'cp-erased', canonicalName: 'alice', removed: true }),
			profile({ id: 'cp-active', canonicalName: 'bob', sceneNumber: 2, removed: false }),
		]);

		const result = await loadStoryAsNew(data, ['line-1'], makeZip(data));

		expect(result.success).toBe(true);
		expect(result.storyId).not.toBe('story-1');
		const rows = await testDb.select<{ id: string; act_line_id: string; canonical_name: string; removed: number }[]>(
			'SELECT id, act_line_id, canonical_name, removed FROM character_profiles ORDER BY canonical_name'
		);
		expect(rows).toHaveLength(2);
		expect(rows[0].canonical_name).toBe('alice');
		expect(rows[0].removed).toBe(1);
		expect(rows[1].canonical_name).toBe('bob');
		expect(rows[1].removed).toBe(0);
		for (const row of rows) {
			expect(row.id).not.toBe('cp-erased');
			expect(row.id).not.toBe('cp-active');
			expect(row.act_line_id).not.toBe('line-1');
		}
	});

	// WHY (archive v1–v4): those entries predate `removed`; absence means active.
	it('imports legacy entries without removed as active', async () => {
		const data = makeArchiveData([profile({ id: 'cp-legacy', canonicalName: 'alice' })], 4);

		const result = await loadStoryAsNew(data, ['line-1'], makeZip(data));

		expect(result.success).toBe(true);
		const rows = await testDb.select<{ removed: number }[]>('SELECT removed FROM character_profiles');
		expect(rows).toEqual([{ removed: 0 }]);
	});

	it('maps a missing removed field to false in profile inputs', () => {
		const inputs = toCharacterProfileInputs(
			makeArchiveData([profile({ id: 'cp-legacy', canonicalName: 'alice' })]).characterProfiles!,
			new Set(['line-1'])
		);
		expect(inputs[0].removed).toBe(false);
	});
});
