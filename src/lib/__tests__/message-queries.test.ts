import { describe, it, expect, vi } from 'vitest';
import type { UIMessage } from '#lib/ai/chat/types.ts';

// message-queries transitively imports db/act-lines, which calls getDatabase() at query time.
// These tests never query, but the module graph must link without a Tauri runtime.
vi.mock('#lib/db/database.ts', () => ({
	getDatabase: () => ({ select: vi.fn(async () => []), execute: vi.fn(async () => ({ rowsAffected: 0 })) }),
}));

import { findScenePlotMessage, getScenePlotForScene } from '#lib/ai/chat/message-queries.ts';

function msg(id: string, sceneNumber: number, scenePlot?: string): UIMessage {
	return { id, role: 'assistant', content: '', sceneNumber, scenePlot };
}

describe('scene plot resolution', () => {
	// The invariant: the context manager and the pipeline must resolve the SAME message.
	// getScenePlotForScene is the pipeline's entry point; findScenePlotMessage is the manager's.
	const messages = [msg('m1', 1, 'Act one plot'), msg('m2', 2), msg('m3', 3, 'Act three plot')];

	it('guidance mode returns the latest message whose scene number matches', () => {
		expect(findScenePlotMessage(messages, 3, 'guidance')?.id).toBe('m3');
		expect(getScenePlotForScene(messages, 3, 'guidance')).toBe('Act three plot');
	});

	it('guidance mode returns nothing when the clicked scene has no plot, even if an earlier scene does', () => {
		expect(findScenePlotMessage(messages, 2, 'guidance')).toBeUndefined();
		expect(getScenePlotForScene(messages, 2, 'guidance')).toBeUndefined();
	});

	it('phaseEvent mode ignores the scene number and returns the last message carrying any plot', () => {
		expect(findScenePlotMessage(messages, 2, 'phaseEvent')?.id).toBe('m3');
		expect(getScenePlotForScene(messages, 2, 'phaseEvent')).toBe('Act three plot');
	});

	it('treats an empty-string plot as absent, because the carry-forward writes "" and the pipeline skips it', () => {
		const withEmpty = [msg('m1', 1, 'Real plot'), msg('m2', 2, '')];
		expect(findScenePlotMessage(withEmpty, 2, 'guidance')).toBeUndefined();
		expect(findScenePlotMessage(withEmpty, 9, 'phaseEvent')?.id).toBe('m1');
		expect(getScenePlotForScene(withEmpty, 9, 'phaseEvent')).toBe('Real plot');
	});

	it('prefers the later message when two share a scene number', () => {
		const dupes = [msg('m1', 1, 'Old'), msg('m2', 1, 'New')];
		expect(findScenePlotMessage(dupes, 1, 'guidance')?.id).toBe('m2');
		expect(getScenePlotForScene(dupes, 1, 'guidance')).toBe('New');
	});

	it('returns undefined / null-safe on an empty message list', () => {
		expect(findScenePlotMessage([], 1, 'guidance')).toBeUndefined();
		expect(getScenePlotForScene([], 1, 'phaseEvent')).toBeUndefined();
	});
});
