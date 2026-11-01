import { describe, it, expect, vi, beforeEach } from 'vitest';

const settingsMock = vi.hoisted(() => ({ reviewerEnabled: true }));

vi.mock('$lib/stores/settings.svelte', () => ({
	isReviewerEnabled: () => settingsMock.reviewerEnabled,
}));

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));

vi.mock('$lib/ai/chat/persistence', () => ({
	serializeImportantPhrases: (phrases: string[]) => phrases.join('\n'),
	updatePersistentMessageMetadata: vi.fn(async () => {}),
}));

import { createPipelineCallbacks } from '$lib/ai/chat/pipeline-callbacks';
import type { UIMessage } from '$lib/ai/chat/types';
import type { PipelineCallbacks } from '$lib/ai/pipeline/types';

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
