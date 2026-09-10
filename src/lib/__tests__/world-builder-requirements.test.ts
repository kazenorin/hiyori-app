import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/localization', () => ({
	ls: (key: string) => key,
	loadLocaleStrings: vi.fn(async () => {}),
}));

import { exitWorldBuilderMode, getRecordedRequirements, handleRecordRequirement } from '$lib/features/world-builder/world-builder.svelte';

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
