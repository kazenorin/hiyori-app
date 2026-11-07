import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetActByActLineId = vi.fn();
vi.mock('#lib/db/acts.ts', () => ({
	getActByActLineId: (...args: unknown[]) => mockGetActByActLineId(...args),
}));

import { refreshAvailableContexts, getAvailableContexts } from '#lib/features/context-availability.svelte.ts';

beforeEach(async () => {
	vi.clearAllMocks();
	// Reset the reactive list. The continued-act cache is module-level and keyed by act line id,
	// so every test below uses a distinct id rather than needing a cache-reset export.
	await refreshAvailableContexts(null, false, false);
});

describe('context availability', () => {
	it('offers nothing for a first act with the planner off, so the strip can hide entirely', async () => {
		mockGetActByActLineId.mockResolvedValue({ id: 'act-a', continuesFromActLineId: null });
		await refreshAvailableContexts('line-a', false, false);
		expect(getAvailableContexts()).toEqual([]);
	});

	it('offers Scene Plot for a first act with the planner on', async () => {
		mockGetActByActLineId.mockResolvedValue({ id: 'act-b', continuesFromActLineId: null });
		await refreshAvailableContexts('line-b', true, false);
		expect(getAvailableContexts()).toEqual(['scenePlot']);
	});

	it('offers Story So Far for a continued act even with no summaries yet, because it will accumulate them', async () => {
		mockGetActByActLineId.mockResolvedValue({ id: 'act-c', continuesFromActLineId: 'line-parent' });
		await refreshAvailableContexts('line-c', false, false);
		expect(getAvailableContexts()).toEqual(['storySoFar']);
	});

	it('offers both for a continued act with the planner on, broader context first', async () => {
		mockGetActByActLineId.mockResolvedValue({ id: 'act-d', continuesFromActLineId: 'line-parent' });
		await refreshAvailableContexts('line-d', true, false);
		expect(getAvailableContexts()).toEqual(['storySoFar', 'scenePlot']);
	});

	it('keeps recorded plots reachable after the user disables the planner mid-story', async () => {
		// Gating on the current setting alone would hide real, editable data.
		mockGetActByActLineId.mockResolvedValue({ id: 'act-e', continuesFromActLineId: null });
		await refreshAvailableContexts('line-e', false, true);
		expect(getAvailableContexts()).toEqual(['scenePlot']);
	});

	it('offers nothing when no act line is selected, without querying', async () => {
		await refreshAvailableContexts(null, true, true);
		expect(getAvailableContexts()).toEqual([]);
		expect(mockGetActByActLineId).not.toHaveBeenCalled();
	});

	it('queries the continued-act lookup once per act line, not once per render', async () => {
		mockGetActByActLineId.mockResolvedValue({ id: 'act-f', continuesFromActLineId: 'line-parent' });
		await refreshAvailableContexts('line-f', true, false);
		await refreshAvailableContexts('line-f', true, true);
		await refreshAvailableContexts('line-f', false, false);
		expect(mockGetActByActLineId).toHaveBeenCalledTimes(1);
		expect(getAvailableContexts()).toEqual(['storySoFar']);
	});

	it('treats a missing act row as not continued rather than throwing', async () => {
		mockGetActByActLineId.mockResolvedValue(null);
		await refreshAvailableContexts('line-g', false, false);
		expect(getAvailableContexts()).toEqual([]);
	});
});
