import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';

vi.mock('$lib/logging/logger', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

import { hashContent, isContentUserEdited, type ConfigAssetEntry, type ContentHashes } from '$lib/fs/config-manifest';

async function sha256(text: string): Promise<string> {
	const data = new TextEncoder().encode(text);
	const hashBuffer = await crypto.subtle.digest('SHA-256', data);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

function entry(overrides: Partial<ConfigAssetEntry> = {}): ConfigAssetEntry {
	return {
		configPath: 'test/file.md',
		hash: null,
		oldHashes: [],
		updatedAt: '',
		...overrides,
	};
}

describe('hashContent', () => {
	it('trims surrounding whitespace before computing the trimmed variant', async () => {
		const { trimmed, untrimmed } = await hashContent('  hello  \n');
		expect(trimmed).toBe(await sha256('hello'));
		expect(untrimmed).toBe(await sha256('  hello  \n'));
		expect(trimmed).not.toBe(untrimmed);
	});

	it('normalizes CRLF to LF before hashing in both variants', async () => {
		const { trimmed, untrimmed } = await hashContent('line1\r\nline2\r\n');
		expect(trimmed).toBe(await sha256('line1\nline2'));
		expect(untrimmed).toBe(await sha256('line1\nline2\n'));
	});

	it('returns identical trimmed and untrimmed hashes when content has no surrounding whitespace', async () => {
		// Short-circuit: no leading/trailing whitespace means trimmed and
		// untrimmed hash the same bytes — hash once, return twice.
		const { trimmed, untrimmed } = await hashContent('hello');
		expect(trimmed).toBe(untrimmed);
		expect(trimmed).toBe(await sha256('hello'));
	});

	it('is deterministic for identical input', async () => {
		const a = await hashContent('same content');
		const b = await hashContent('same content');
		expect(a).toEqual(b);
	});

	it('hashes empty string identically in both variants', async () => {
		const { trimmed, untrimmed } = await hashContent('');
		expect(trimmed).toBe(untrimmed);
		expect(trimmed).toBe(await sha256(''));
	});
});

describe('isContentUserEdited', () => {
	it('returns false when the trimmed disk hash matches entry.hash', async () => {
		const hashes: ContentHashes = { trimmed: 'AAA', untrimmed: 'BBB' };
		expect(isContentUserEdited(hashes, entry({ hash: 'AAA' }))).toBe(false);
	});

	it('returns false when the untrimmed disk hash matches entry.hash', async () => {
		// The bug: editors sometimes append a trailing newline. The trimmed form
		// differs from the on-disk bytes, but the untrimmed form still matches
		// the recorded hash and the file must NOT be treated as user-edited.
		const hashes: ContentHashes = { trimmed: 'AAA', untrimmed: 'BBB' };
		expect(isContentUserEdited(hashes, entry({ hash: 'BBB' }))).toBe(false);
	});

	it('returns false when the trimmed disk hash matches an oldHashes entry', async () => {
		// Self-heal: a stale v1 file on disk must be recognized as not user-edited
		// so syncConfigAssets overwrites it with the v2 bundled content.
		const hashes: ContentHashes = { trimmed: 'OLD_T', untrimmed: 'OLD_U' };
		expect(isContentUserEdited(hashes, entry({ hash: 'NEW', oldHashes: ['OLD_T'] }))).toBe(false);
	});

	it('returns false when the untrimmed disk hash matches an oldHashes entry', async () => {
		const hashes: ContentHashes = { trimmed: 'AAA', untrimmed: 'OLD_U' };
		expect(isContentUserEdited(hashes, entry({ hash: 'NEW', oldHashes: ['OLD_U'] }))).toBe(false);
	});

	it('returns true when neither variant matches current or old hashes', async () => {
		const hashes: ContentHashes = { trimmed: 'TOTALLY', untrimmed: 'DIFFERENT' };
		expect(isContentUserEdited(hashes, entry({ hash: 'NEW', oldHashes: ['OLD_T', 'OLD_U'] }))).toBe(true);
	});

	it('treats null entry.hash as not matching any disk hash', async () => {
		// Obsolete (removed-from-bundle) files: entry.hash is null and only
		// oldHashes carry the known good hashes. A disk file matching an oldHash
		// is not user-edited (so syncConfigAssets will remove it as obsolete).
		const hashes: ContentHashes = { trimmed: 'AAA', untrimmed: 'OLD_U' };
		expect(isContentUserEdited(hashes, entry({ hash: null, oldHashes: ['OLD_U'] }))).toBe(false);
	});
});

// Integration tests using the real manifest plus the bundled content that
// $lib/fs/prompts and $lib/fs/view-templates register at import time. The
// manifest is regenerated from those same source files, so for any registered
// configPath, hashContent(bundled).trimmed === entry.hash.
const testConfigPath = 'en/prompt-templates/act/act-card-template.md';

async function importRealBundle() {
	await import('$lib/fs/prompts');
	await import('$lib/fs/view-templates');
	const { getBundledContent } = await import('$lib/fs/config-manifest');
	const bundled = getBundledContent(testConfigPath);
	if (bundled === undefined) throw new Error('expected bundled content to be registered');
	return bundled;
}

describe('syncConfigAssets — line-ending / trimming tolerance (integration)', () => {
	let memfs: InMemoryFileSystem;
	let writeSpy: ReturnType<typeof vi.spyOn>;
	let removeSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		memfs = new InMemoryFileSystem();
		memfs.clear();
		setFileSystem(memfs);
		writeSpy = vi.spyOn(memfs, 'writeTextFileEnsuringDir');
		removeSpy = vi.spyOn(memfs, 'remove');
	});

	it('does not overwrite when disk content is exactly the bundled content', async () => {
		const bundled = await importRealBundle();
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled);
		const { syncConfigAssets } = await import('$lib/fs/config-manifest');

		await syncConfigAssets();

		expect(writeSpy).not.toHaveBeenCalled();
	});

	it('does not overwrite when the editor appended a trailing newline (the bug)', async () => {
		const bundled = await importRealBundle();
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled + '\n');
		const { syncConfigAssets } = await import('$lib/fs/config-manifest');

		await syncConfigAssets();

		// Trimmed disk hash still equals entry.hash → not user-edited, and no
		// write needed since the trimmed content already matches.
		for (const call of writeSpy.mock.calls) {
			expect(call[0]).not.toBe(`config/${testConfigPath}`);
		}
	});

	it('does not overwrite when content differs only by CRLF vs LF (regression guard for normalization)', async () => {
		const bundled = await importRealBundle();
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled.replaceAll('\n', '\r\n'));
		const { syncConfigAssets } = await import('$lib/fs/config-manifest');

		await syncConfigAssets();

		for (const call of writeSpy.mock.calls) {
			expect(call[0]).not.toBe(`config/${testConfigPath}`);
		}
	});

	it('skips the file (does not overwrite) when the user genuinely edited it', async () => {
		await importRealBundle();
		await memfs.writeTextFile(`config/${testConfigPath}`, 'completely different user content');
		const { syncConfigAssets } = await import('$lib/fs/config-manifest');

		await syncConfigAssets();

		expect(writeSpy).not.toHaveBeenCalled();
	});

	it('does nothing and does not throw when the file is missing on disk', async () => {
		await importRealBundle();
		const { syncConfigAssets } = await import('$lib/fs/config-manifest');

		await expect(syncConfigAssets()).resolves.toBeUndefined();

		expect(writeSpy).not.toHaveBeenCalled();
		expect(removeSpy).not.toHaveBeenCalled();
	});
});

describe('isConfigUserModified — freshness check (file-tree.ts)', () => {
	// Intent (per owner): this function reports whether the file is NOT up to
	// date with the current manifest hash. It deliberately does NOT consult
	// oldHashes, because a stale file matching an old hash is still "out of date"
	// and should be flagged for update. This is intentionally stricter than
	// isContentUserEdited, which exists to prevent overwriting user-edited files.
	let memfs: InMemoryFileSystem;

	beforeEach(() => {
		memfs = new InMemoryFileSystem();
		memfs.clear();
		setFileSystem(memfs);
	});

	it('returns false when disk content equals the bundled content', async () => {
		const bundled = await importRealBundle();
		const { isConfigUserModified } = await import('$lib/fs/file-tree');
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled);

		expect(await isConfigUserModified(`config/${testConfigPath}`)).toBe(false);
	});

	it('returns false when the editor appended a trailing newline (the bug)', async () => {
		const bundled = await importRealBundle();
		const { isConfigUserModified } = await import('$lib/fs/file-tree');
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled + '\n');

		expect(await isConfigUserModified(`config/${testConfigPath}`)).toBe(false);
	});

	it('returns false when content differs only by CRLF vs LF', async () => {
		const bundled = await importRealBundle();
		const { isConfigUserModified } = await import('$lib/fs/file-tree');
		await memfs.writeTextFile(`config/${testConfigPath}`, bundled.replaceAll('\n', '\r\n'));

		expect(await isConfigUserModified(`config/${testConfigPath}`)).toBe(false);
	});

	it('returns true when the user genuinely edited the file', async () => {
		await importRealBundle();
		const { isConfigUserModified } = await import('$lib/fs/file-tree');
		await memfs.writeTextFile(`config/${testConfigPath}`, 'genuinely modified content');

		expect(await isConfigUserModified(`config/${testConfigPath}`)).toBe(true);
	});
});
