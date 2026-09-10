import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string) => key,
	loadLocaleStrings: vi.fn(async () => {}),
}));

import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem } from '$lib/fs/file-system';
import { readRequirementsBlock } from '$lib/fs/requirements-files';
import {
	exitWorldBuilderMode,
	getRecordedRequirements,
	handleRecordRequirement,
	appendRequirementToSidecar,
} from '$lib/features/world-builder/world-builder.svelte';

describe('world-builder recorded requirements', () => {
	beforeEach(() => {
		exitWorldBuilderMode();
	});

	it('records a world-builder requirement in memory', async () => {
		await handleRecordRequirement('must', 'A');
		expect(getRecordedRequirements()).toEqual([{ category: 'must', requirement: 'A' }]);
	});

	it('dedups an exact category+text duplicate', async () => {
		await handleRecordRequirement('must', 'A');
		await handleRecordRequirement('must', 'A');
		expect(getRecordedRequirements()).toHaveLength(1);
	});

	it('keeps the same text under a different category', async () => {
		await handleRecordRequirement('must', 'A');
		await handleRecordRequirement('may', 'A');
		expect(getRecordedRequirements()).toHaveLength(2);
	});

	it('clears requirements on reset so WB and act-plot sets never mix', async () => {
		await handleRecordRequirement('may', 'B');
		exitWorldBuilderMode();
		expect(getRecordedRequirements()).toEqual([]);
	});
});

describe('act-plot sidecar concurrency', () => {
	const DIR = '/story/act-1/main-line';

	beforeEach(() => {
		setFileSystem(new InMemoryFileSystem());
	});

	it('serializes concurrent appends so no requirement is dropped', async () => {
		// The AI SDK runs multiple tool calls from one assistant turn concurrently;
		// an unguarded read-modify-write would let the last write clobber the others.
		await Promise.all([
			appendRequirementToSidecar(DIR, { category: 'must', requirement: 'A' }),
			appendRequirementToSidecar(DIR, { category: 'should', requirement: 'B' }),
			appendRequirementToSidecar(DIR, { category: 'may', requirement: 'C' }),
		]);

		const body = await readRequirementsBlock(DIR);
		const lines = body.split('\n').filter((line) => line.trim() !== '');
		expect(lines).toHaveLength(3);
		expect(body).toContain('A');
		expect(body).toContain('B');
		expect(body).toContain('C');
	});
});
