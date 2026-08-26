import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';
import { createTestDatabase } from './helpers/test-database';
import { runMigrations } from '$lib/db/migrations';

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
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/definitions/common-labels', () => ({
	mainLineNameLabel: () => 'Main Line',
	actWithNumberLabel: (n: number | string) => `Act ${n}`,
}));

vi.mock('$lib/localization', () => ({
	loadLocaleStrings: vi.fn(async () => {}),
}));

vi.mock('$lib/fs/prompt-loader', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/fs/prompt-loader')>();
	return {
		...actual,
		setActiveLocale: vi.fn(),
	};
});

vi.mock('$lib/stores/settings.svelte', () => ({
	settings: { locale: 'en' },
	getDefaultPlotMode: () => 'guidance',
	getMemoryProviderConfig: () => undefined,
	isMemoryAvailable: () => false,
}));

vi.mock('$lib/ai/world-generator', () => ({
	ensureWorldFile: vi.fn(async () => ''),
}));

vi.mock('$lib/ai/world-generator/template-resolution', () => ({
	writeWorldTemplateId: vi.fn(async () => {}),
}));

vi.mock('$lib/fs/story-folders', () => ({
	resolveStoryFolder: vi.fn(async () => 'Story'),
	renameStoryFolder: vi.fn(async () => 'Story'),
	deriveStoryName: vi.fn((name: string) => name),
}));

vi.mock('$lib/features/world-builder/world-builder.svelte', () => ({
	moveWorldBuilderLog: vi.fn(async () => {}),
	getLogFilePath: vi.fn(async () => ''),
	enterActPlotInterviewMode: vi.fn(async () => {}),
}));

vi.mock('$lib/logging/chat-logger', () => ({
	moveWorldBuilderLog: vi.fn(async () => {}),
}));

vi.mock('$lib/features/memory', () => ({
	Memory: class {
		constructor() {}
	},
}));

import * as dbStories from '$lib/db/stories';
import * as dbActs from '$lib/db/acts';
import * as dbActLines from '$lib/db/act-lines';
import { createActLineContinuation, createActLine } from '$lib/stores/stories.svelte';
import { getLineDir, buildLineSubdirSuffix } from '$lib/ai/card-output-path';

describe('createActLineContinuation — always creates a fresh act', () => {
	let story: dbStories.Story;
	let act1: dbActs.Act;
	let fromLine: dbActLines.ActLineMeta;

	beforeEach(async () => {
		testDb = createTestDatabase();
		await runMigrations();

		setFileSystem(new InMemoryFileSystem());

		story = await dbStories.createStory(crypto.randomUUID(), 'Story', 'en');
		act1 = await dbActs.createAct(crypto.randomUUID(), story.id, 'Act 1', 1, null);
		fromLine = await createActLine(act1.id, 'Main Line', 'guidance', true);
	});

	afterEach(() => {
		testDb.close();
	});

	it('creates a fresh act bound to the source act line', async () => {
		const { act, actLine } = await createActLineContinuation(act1, fromLine, story);

		expect(act.id).not.toBe(act1.id);
		expect(act.actNumber).toBe(2);
		expect(act.name).toBe('Act 2');
		expect(act.continuesFromActLineId).toBe(fromLine.id);
		expect(actLine.actId).toBe(act.id);
		expect(actLine.isMainLine).toBe(true);
		expect(actLine.name).toBe('Main Line');
	});

	it('never reuses an existing act at the same act number', async () => {
		const trunkAct2 = await dbActs.createAct(crypto.randomUUID(), story.id, 'Act 2', 2, fromLine.id);
		await createActLine(trunkAct2.id, 'Main Line', 'guidance', true);

		const { act, actLine } = await createActLineContinuation(act1, fromLine, story);

		expect(act.id).not.toBe(trunkAct2.id);
		expect(act.continuesFromActLineId).toBe(fromLine.id);
		// The main-line folder ('act-2/main-line') already belongs to the trunk act's line
		expect(actLine.isMainLine).toBe(false);
		expect(actLine.name).toBe('Main Line (2)');
	});

	it('continuing from a fork creates a separate act pointing at the fork', async () => {
		const trunkAct2 = await dbActs.createAct(crypto.randomUUID(), story.id, 'Act 2', 2, fromLine.id);
		await createActLine(trunkAct2.id, 'Main Line', 'guidance', true);
		const forkLine = await createActLine(act1.id, 'Main Line (2)', 'guidance', false);

		const { act } = await createActLineContinuation(act1, forkLine, story);

		expect(act.id).not.toBe(trunkAct2.id);
		expect(act.continuesFromActLineId).toBe(forkLine.id);
	});

	it('repeated continuations from the same line produce distinct acts', async () => {
		const first = await createActLineContinuation(act1, fromLine, story);
		const second = await createActLineContinuation(act1, fromLine, story);

		expect(second.act.id).not.toBe(first.act.id);
		expect(second.act.continuesFromActLineId).toBe(fromLine.id);
		expect(second.actLine.isMainLine).toBe(false);
		expect(second.actLine.name).toBe('Main Line (2)');
	});

	it('produces divergent on-disk folders for the first main line vs a later continuation', async () => {
		const { actLine: first } = await createActLineContinuation(act1, fromLine, story);
		const { actLine: second } = await createActLineContinuation(act1, fromLine, story);

		const storyFolder = 'Story';
		const firstDir = await getLineDir(storyFolder, 2, first.isMainLine, first.id);
		const secondDir = await getLineDir(storyFolder, 2, second.isMainLine, second.id);

		expect(firstDir).toBe(`${storyFolder}/act-2/main-line`);
		expect(firstDir).not.toBe(secondDir);
		// Forked-line convention: {idLast8}-{kebabCaseName}, not the shared 'main-line' folder
		const expectedSuffix = buildLineSubdirSuffix(second.name);
		expect(secondDir).toBe(`${storyFolder}/act-2/${second.id.slice(-8)}-${expectedSuffix}`);
	});

	it('inherits the plot mode from the source act line', async () => {
		const eventsLine = await createActLine(act1.id, 'Events Line', 'phaseEvent', false);

		const { actLine } = await createActLineContinuation(act1, eventsLine, story);

		expect(actLine.plotMode).toBe('phaseEvent');
	});
});
