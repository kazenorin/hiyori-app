import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsMock = vi.hoisted(() => ({ reviewerEnabled: true }));

vi.mock('#lib/stores/settings.svelte.ts', () => ({
	isReviewerEnabled: () => settingsMock.reviewerEnabled,
}));

vi.mock('#lib/logging/logger.ts', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('#lib/ai/chat/persistence.ts', () => ({
	serializeImportantPhrases: (phrases: string[]) => phrases.join('\n'),
	updatePersistentMessageMetadata: vi.fn(async () => {}),
}));

import { createPipelineCallbacks } from '#lib/ai/chat/pipeline-callbacks.ts';
import type { UIMessage } from '#lib/ai/chat/types.ts';
import type { PipelineCallbacks } from '#lib/ai/pipeline/types.ts';

function makeHarness() {
	let message: UIMessage = { id: 'msg-1', role: 'assistant', content: '', reasoning: '', phases: [], sceneNumber: 1 };
	const callbacks: PipelineCallbacks = createPipelineCallbacks({
		getCurrentMessage: () => message,
		setCurrentMessage: (m) => {
			message = m;
		},
		onError: vi.fn(),
	});
	return {
		callbacks,
		get message() {
			return message;
		},
		phase(name: string) {
			return message.phases?.find((p) => p.phaseName === name);
		},
	};
}

beforeEach(() => {
	settingsMock.reviewerEnabled = true;
});

describe('createPipelineCallbacks with the reviewer enabled', () => {
	it('pushes an EDITOR phases entry on start — the editor is a first-class phase', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('EDITOR');
		expect(h.phase('EDITOR')).toEqual({ phaseName: 'EDITOR', content: '' });
	});

	it('dual-routes EDITOR stream deltas into both the body and the phases entry', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('EDITOR');
		h.callbacks.onPhaseStream('EDITOR', { content: 'polished prose', reasoning: 'editor thoughts', variables: null });

		// The message body keeps streaming editor output (routing unchanged)...
		expect(h.message.content).toBe('polished prose');
		expect(h.message.reasoning).toBe('editor thoughts');
		// ...and the phases entry mirrors it so the dialog can render the EDITOR pane.
		expect(h.phase('EDITOR')).toEqual({ phaseName: 'EDITOR', content: 'polished prose', reasoning: 'editor thoughts' });
	});

	it('updates both body and entry with final editor output and reasoning on EDITOR complete', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('EDITOR');
		h.callbacks.onPhaseStream('EDITOR', { content: 'partial', reasoning: null, variables: null });
		h.callbacks.onPhaseComplete('EDITOR', { editorOutput: 'final prose', editorReasoning: 'final thoughts', editorVariables: null });

		expect(h.message.content).toBe('final prose');
		expect(h.phase('EDITOR')).toEqual({ phaseName: 'EDITOR', content: 'final prose', reasoning: 'final thoughts' });
	});

	it('writes retry text into the EDITOR entry without touching the body', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('EDITOR');
		h.callbacks.onPhaseStream('EDITOR', { content: 'partial prose', reasoning: null, variables: null });
		h.callbacks.onPhaseRetry('EDITOR', 2, 3);

		expect(h.phase('EDITOR')?.content).toBe('Retrying (attempt 2/3)...');
		expect(h.message.content).toBe('partial prose');
	});

	it('keeps WRITER entry-only (body untouched) when the reviewer is enabled', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('WRITER');
		h.callbacks.onPhaseStream('WRITER', { content: 'rough draft', reasoning: 'writer thoughts', variables: null });

		expect(h.message.content).toBe('');
		expect(h.phase('WRITER')).toEqual({ phaseName: 'WRITER', content: 'rough draft', reasoning: 'writer thoughts' });
	});
});

describe('createPipelineCallbacks with the reviewer disabled', () => {
	beforeEach(() => {
		settingsMock.reviewerEnabled = false;
	});

	it('hides WRITER from the phases array — its stream is the body seed', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('WRITER');
		h.callbacks.onPhaseStream('WRITER', { content: 'final prose', reasoning: null, variables: null });
		h.callbacks.onPhaseComplete('WRITER', { editorOutput: 'final prose' });

		expect(h.message.phases).toEqual([]);
		expect(h.message.content).toBe('final prose');
	});

	it('still gives EDITOR a phases entry and dual-routes its stream', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('EDITOR');
		h.callbacks.onPhaseStream('EDITOR', { content: 'edited', reasoning: 'why', variables: null });

		expect(h.message.content).toBe('edited');
		expect(h.phase('EDITOR')).toEqual({ phaseName: 'EDITOR', content: 'edited', reasoning: 'why' });
	});
});

describe('createPipelineCallbacks non-body phases', () => {
	it('routes REVIEWER stream and completion to the phases entry only', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('REVIEWER');
		h.callbacks.onPhaseStream('REVIEWER', { content: 'notes so far', reasoning: null, variables: null });
		expect(h.phase('REVIEWER')?.content).toBe('notes so far');
		expect(h.message.content).toBe('');

		h.callbacks.onPhaseComplete('REVIEWER', { reviewerOutput: 'full review' });
		expect(h.phase('REVIEWER')?.content).toBe('full review');
	});
});

describe('background phase callbacks', () => {
	const meta = (input: number, output: number) => ({
		finishReason: 'stop',
		usage: { inputTokens: input, outputTokens: output, totalTokens: input + output, cacheReadTokens: 5 },
		durationMs: 10,
		models: new Set(['sum-model']),
	});

	it('merges per-phase metadata into message.metadata on complete', () => {
		// WHY: the dialog meta line (tokens/cache) must appear when a background
		// phase completes — not only when the whole chain settles.
		const h = makeHarness();
		h.callbacks.onPhaseStart('SUMMARIZER');
		h.callbacks.onPhaseComplete('SUMMARIZER', { actSummary: 'merged summary' }, meta(100, 20));

		expect(h.phase('SUMMARIZER')?.content).toBe('merged summary');
		expect(h.message.metadata?.inputTokens).toBe(100);
		expect(h.message.metadata?.cacheReadTokens).toBe(5);
		expect(h.message.metadata?.phases).toEqual([
			{
				phaseName: 'SUMMARIZER',
				model: 'sum-model',
				finishReason: 'stop',
				inputTokens: 100,
				outputTokens: 20,
				totalTokens: 120,
				cacheReadTokens: 5,
				durationMs: 10,
			},
		]);
	});

	it('accumulates metadata across phases without double counting', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('SUMMARIZER');
		h.callbacks.onPhaseComplete('SUMMARIZER', { actSummary: 's' }, meta(100, 20));
		h.callbacks.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
		h.callbacks.onPhaseComplete('CHARACTER_PROFILE_COMPRESSOR', { profileCompressionLog: 'log' }, meta(200, 30));

		expect(h.message.metadata?.inputTokens).toBe(300);
		expect(h.message.metadata?.phases?.map((p) => p.phaseName)).toEqual(['SUMMARIZER', 'CHARACTER_PROFILE_COMPRESSOR']);
	});

	it('keeps main phases before background phases regardless of start order', () => {
		// WHY: the Summarizer starts during the Writer; live start-order would
		// interleave chips nondeterministically and diverge from persisted layout.
		const h = makeHarness();
		h.callbacks.onPhaseStart('WRITER');
		h.callbacks.onPhaseStart('SUMMARIZER');
		h.callbacks.onPhaseStart('REVIEWER');
		h.callbacks.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
		h.callbacks.onPhaseStart('EDITOR');

		expect(h.message.phases?.map((p) => p.phaseName)).toEqual([
			'WRITER',
			'REVIEWER',
			'EDITOR',
			'SUMMARIZER',
			'CHARACTER_PROFILE_COMPRESSOR',
		]);
	});

	it('routes the compressor log through getPhaseContent on complete', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('CHARACTER_PROFILE_COMPRESSOR');
		h.callbacks.onPhaseStream('CHARACTER_PROFILE_COMPRESSOR', { content: 'partial log', reasoning: 'thinking', variables: null });
		h.callbacks.onPhaseComplete('CHARACTER_PROFILE_COMPRESSOR', { profileCompressionLog: 'final log' });

		expect(h.phase('CHARACTER_PROFILE_COMPRESSOR')).toEqual({
			phaseName: 'CHARACTER_PROFILE_COMPRESSOR',
			content: 'final log',
			reasoning: 'thinking',
		});
		expect(h.message.content).toBe('');
	});

	it('onPhaseFailed strips the started entry so no ghost chip survives', () => {
		const h = makeHarness();
		h.callbacks.onPhaseStart('SUMMARIZER');
		h.callbacks.onPhaseStream('SUMMARIZER', { content: 'partial', reasoning: null, variables: null });
		h.callbacks.onPhaseFailed?.('SUMMARIZER');

		expect(h.phase('SUMMARIZER')).toBeUndefined();
	});
});
