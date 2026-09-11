import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem, fs } from '$lib/fs/file-system';
import { readRequirementsBlock, writeRequirementsBlock, deleteRequirements } from '$lib/fs/requirements-files';

const DIR = '/story/act-1/main-line';

describe('requirements-files', () => {
	beforeEach(() => {
		setFileSystem(new InMemoryFileSystem());
	});

	it('reads back exactly what was written (round-trip)', async () => {
		await writeRequirementsBlock(DIR, '- **Must:** A');
		expect(await readRequirementsBlock(DIR)).toBe('- **Must:** A');
	});

	it('returns empty string when the sidecar does not exist', async () => {
		expect(await readRequirementsBlock(DIR)).toBe('');
	});

	it('creates the directory tree when writing (writeTextFileEnsuringDir)', async () => {
		await writeRequirementsBlock(DIR, 'body');
		expect(await fs.exists(`${DIR}/requirements.md`)).toBe(true);
	});

	it('delete removes the sidecar so a later read is empty', async () => {
		await writeRequirementsBlock(DIR, 'body');
		await deleteRequirements(DIR);
		expect(await readRequirementsBlock(DIR)).toBe('');
	});

	it('delete is a safe no-op when the file is absent', async () => {
		await expect(deleteRequirements(DIR)).resolves.toBeUndefined();
	});
});
