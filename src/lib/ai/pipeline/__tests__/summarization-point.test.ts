import { describe, it, expect } from 'vitest';
import { resolveSummariesSnapshot, resolveSummarizationPoint } from '../summarization-point';
import type { UIMessage } from '$lib/ai/chat/types';

const msg = (sceneNumber: number, role: 'user' | 'assistant', actSummary?: string): UIMessage => ({
	id: `m-${role}-${sceneNumber}`,
	role,
	content: '',
	sceneNumber,
	actSummary,
});

/**
 * History mirroring the persistence invariant: the async Summarizer of the run for
 * scene S+1 merges scene S and persists the summary covering scenes 1..S on the
 * assistant message for scene S+1. Each player message is persisted with the last
 * completed scene number and sits after that scene's assistant message.
 */
function lineHistory(completedScenes: number, missingSummariesAt: number[] = []): UIMessage[] {
	const messages: UIMessage[] = [];
	for (let scene = 1; scene <= completedScenes; scene++) {
		if (scene >= 2) messages.push(msg(scene - 1, 'user'));
		const summary = scene >= 2 && !missingSummariesAt.includes(scene) ? `SUM-1-${scene - 1}` : undefined;
		messages.push(msg(scene, 'assistant', summary));
	}
	messages.push(msg(completedScenes, 'user'));
	return messages;
}

describe('resolveSummarizationPoint', () => {
	it('stays 0 until the second summarization point', () => {
		// The snapshot covering a boundary scene is only persisted during the run after
		// that boundary, so the first freezable point is the second one: with interval 8,
		// runs 1-15 keep every scene raw.
		for (const currentScene of [1, 7, 8, 9, 15]) {
			expect(resolveSummarizationPoint(currentScene, 8)).toBe(0);
		}
	});

	it('freezes one full interval below the current boundary', () => {
		expect(resolveSummarizationPoint(16, 8)).toBe(8);
		expect(resolveSummarizationPoint(23, 8)).toBe(8);
		expect(resolveSummarizationPoint(24, 8)).toBe(16);
		expect(resolveSummarizationPoint(31, 8)).toBe(16);
		expect(resolveSummarizationPoint(32, 8)).toBe(24);
		expect(resolveSummarizationPoint(15, 10)).toBe(0);
		expect(resolveSummarizationPoint(20, 10)).toBe(10);
	});

	it('returns 0 when disabled (interval <= 0)', () => {
		expect(resolveSummarizationPoint(15, 0)).toBe(0);
		expect(resolveSummarizationPoint(15, -1)).toBe(0);
	});

	it('never claims coverage that no persisted summary can have (interval 1)', () => {
		// The summary covering 1..S first exists at the start of the run for scene S+2,
		// so interval 1 is clamped to currentScene - 2.
		expect(resolveSummarizationPoint(5, 1)).toBe(3);
		expect(resolveSummarizationPoint(2, 1)).toBe(0);
	});
});

describe('resolveSummariesSnapshot', () => {
	it('keeps every scene raw until the second summarization point', () => {
		for (const currentScene of [9, 10, 15]) {
			const snapshot = resolveSummariesSnapshot(lineHistory(currentScene - 1), currentScene, 8);
			expect(snapshot).toEqual({ summarizationPoint: 0, actSummaryAtSP: '', scenesFromScene: 1 });
		}
	});

	it('freezes the 1..8 snapshot for runs 16-23, so scene 8 is never lost', () => {
		// The summary covering 1..8 is persisted on the assistant message for scene 9;
		// scenes 9+ stay raw. The player message sharing scene 9 must not shadow it.
		for (const currentScene of [16, 17, 23]) {
			const snapshot = resolveSummariesSnapshot(lineHistory(currentScene - 1), currentScene, 8);
			expect(snapshot).toEqual({ summarizationPoint: 8, actSummaryAtSP: 'SUM-1-8', scenesFromScene: 9 });
		}
	});

	it('advances the frozen coverage at every subsequent summarization point', () => {
		expect(resolveSummariesSnapshot(lineHistory(23), 24, 8)).toEqual({
			summarizationPoint: 16,
			actSummaryAtSP: 'SUM-1-16',
			scenesFromScene: 17,
		});
		expect(resolveSummariesSnapshot(lineHistory(31), 32, 8)).toEqual({
			summarizationPoint: 24,
			actSummaryAtSP: 'SUM-1-24',
			scenesFromScene: 25,
		});
	});

	it('falls back to fully raw scenes when the frozen snapshot is missing', () => {
		// The run for scene 9 failed to persist its summary. Falling back to the older
		// 1..7 snapshot would drop scene 8 into the gap between summary and raw scenes.
		const snapshot = resolveSummariesSnapshot(lineHistory(15, [9]), 16, 8);
		expect(snapshot).toEqual({ summarizationPoint: 0, actSummaryAtSP: '', scenesFromScene: 1 });
	});

	it('resolves a usable window for every positive interval', () => {
		// Interval 1: claim clamped to currentScene - 2, snapshot read from message 4.
		expect(resolveSummariesSnapshot(lineHistory(4), 5, 1)).toEqual({
			summarizationPoint: 3,
			actSummaryAtSP: 'SUM-1-3',
			scenesFromScene: 4,
		});
		expect(resolveSummariesSnapshot(lineHistory(5), 6, 2)).toEqual({
			summarizationPoint: 4,
			actSummaryAtSP: 'SUM-1-4',
			scenesFromScene: 5,
		});
	});

	it('handles an empty history', () => {
		expect(resolveSummariesSnapshot([], 16, 8)).toEqual({ summarizationPoint: 0, actSummaryAtSP: '', scenesFromScene: 1 });
	});
});
