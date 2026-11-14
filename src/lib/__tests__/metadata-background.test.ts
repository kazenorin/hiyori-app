import { describe, it, expect, vi } from 'vitest';

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	getSummarizerProviderConfig: () => ({ model: 'sum-model' }),
}));

import { mergePreservedBackgroundMetadata, mergeTokenFields } from '#lib/ai/chat/metadata.ts';
import type { MessageMetadata } from '#lib/ai/chat-stream.ts';

const summarizerEntry = {
	phaseName: 'SUMMARIZER',
	model: 'sum-model',
	finishReason: 'stop',
	inputTokens: 100,
	outputTokens: 20,
	totalTokens: 120,
	cacheReadTokens: 50,
	durationMs: 10,
};

function mainMetadata(): MessageMetadata {
	return {
		model: 'main-model',
		finishReason: 'stop',
		inputTokens: 500,
		outputTokens: 200,
		totalTokens: 700,
		durationMs: 100,
		phases: [
			{
				phaseName: 'WRITER',
				model: 'main-model',
				finishReason: 'stop',
				inputTokens: 500,
				outputTokens: 200,
				totalTokens: 700,
				durationMs: 100,
			},
		],
	};
}

describe('mergePreservedBackgroundMetadata', () => {
	it('re-appends background entries merged during the run without double counting', () => {
		// WHY: the summarizer can complete BEFORE main finalize; finalize rebuilds
		// metadata from the main aggregate and must not drop the early entry.
		const existing: MessageMetadata = {
			...mainMetadata(),
			inputTokens: 600,
			totalTokens: 820,
			phases: [...mainMetadata().phases!, summarizerEntry],
		};
		const merged = mergePreservedBackgroundMetadata(mainMetadata(), existing);
		expect(merged?.inputTokens).toBe(600);
		expect(merged?.totalTokens).toBe(820);
		expect(merged?.cacheReadTokens).toBe(50);
		expect(merged?.phases?.map((p) => p.phaseName)).toEqual(['WRITER', 'SUMMARIZER']);
	});

	it('returns main metadata unchanged when no background entries exist', () => {
		const merged = mergePreservedBackgroundMetadata(mainMetadata(), mainMetadata());
		expect(merged).toEqual(mainMetadata());
	});

	it('builds from background entries when main metadata is absent', () => {
		const existing: MessageMetadata = {
			model: 'sum-model',
			finishReason: 'stop',
			inputTokens: 100,
			outputTokens: 20,
			totalTokens: 120,
			durationMs: 10,
			phases: [summarizerEntry],
		};
		const merged = mergePreservedBackgroundMetadata(undefined, existing);
		expect(merged?.inputTokens).toBe(100);
		expect(merged?.phases).toEqual([summarizerEntry]);
	});
});
