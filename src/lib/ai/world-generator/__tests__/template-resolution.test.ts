import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem, FileSystemError, type FileSystem } from '$lib/fs/file-system';

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/stores/settings.svelte', () => ({
	getMinorTaskAgentProviderConfig: vi.fn(() => undefined),
}));

vi.mock('$lib/features/world-builder/template-registry', () => ({
	WORLD_TEMPLATES: [
		{ id: 'high-fantasy', loader: { loadDefault: async () => 'HIGH_FANTASY_TEMPLATE' } },
		{ id: 'sci-fi', loader: { loadDefault: async () => 'SCI_FI_TEMPLATE' } },
	],
}));

import { readWorldTemplateId, resolveTemplateForUpdate, WORLD_TEMPLATE_ID_FILE } from '../template-resolution';

interface MakeFsResult {
	fsImpl: FileSystem;
	readSpy: ReturnType<typeof vi.spyOn>;
}

function makeFs(throwOnRead = false): MakeFsResult {
	const memfs = new InMemoryFileSystem();
	memfs.clear();
	const original = memfs.readTextFileIfExists.bind(memfs);
	const readSpy = vi.spyOn(memfs, 'readTextFileIfExists').mockImplementation(async (path: string) => {
		if (throwOnRead) throw new FileSystemError('unexpected FS error', 'permission_denied');
		return original(path);
	});
	return { fsImpl: memfs, readSpy };
}

describe('readWorldTemplateId — defensive error handling', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns null when the template-id file does not exist (no error)', async () => {
		const { fsImpl, readSpy } = makeFs(false);
		setFileSystem(fsImpl);

		const result = await readWorldTemplateId('story-folder');
		expect(result).toBeNull();
		expect(readSpy).toHaveBeenCalledWith(`story-folder/${WORLD_TEMPLATE_ID_FILE}`);
	});

	it('swallows FS errors and returns null instead of propagating them', async () => {
		const { fsImpl } = makeFs(true);
		setFileSystem(fsImpl);

		const result = await readWorldTemplateId('story-folder');
		expect(result).toBeNull();
	});

	it('returns a valid id when the file contains a known template id', async () => {
		const { fsImpl } = makeFs(false);
		await fsImpl.writeTextFile(`story-folder/${WORLD_TEMPLATE_ID_FILE}`, 'high-fantasy');
		setFileSystem(fsImpl);

		const result = await readWorldTemplateId('story-folder');
		expect(result).toBe('high-fantasy');
	});

	it('returns null for an unrecognized template id', async () => {
		const { fsImpl } = makeFs(false);
		await fsImpl.writeTextFile(`story-folder/${WORLD_TEMPLATE_ID_FILE}`, 'not-a-real-template');
		setFileSystem(fsImpl);

		const result = await readWorldTemplateId('story-folder');
		expect(result).toBeNull();
	});
});

describe('resolveTemplateForUpdate — fallback when readWorldTemplateId fails', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('falls back to high-fantasy when readWorldTemplateId throws, instead of propagating', async () => {
		const { fsImpl } = makeFs(true);
		setFileSystem(fsImpl);

		// readWorldTemplateId will throw permission_denied; resolveTemplateForUpdate
		// should swallow it, skip classification (no minor task agent configured),
		// and return the high-fantasy fallback.
		const result = await resolveTemplateForUpdate('story-folder', 'some world content');
		expect(result).toBe('HIGH_FANTASY_TEMPLATE');
	});
});
