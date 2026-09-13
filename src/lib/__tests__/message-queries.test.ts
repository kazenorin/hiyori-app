import { describe, it, expect } from 'vitest';
import { getActSummaryAtScene } from '$lib/ai/chat/message-queries';
import type { UIMessage } from '$lib/ai/chat/types';

const msg = (sceneNumber: number, actSummary?: string): UIMessage => ({
	id: `m${sceneNumber}-${actSummary ?? 'none'}`,
	role: 'assistant',
	content: '',
	sceneNumber,
	actSummary,
});

describe('getActSummaryAtScene', () => {
	it('returns the latest summary at or before maxScene', () => {
		const messages = [msg(3, 'S3'), msg(6, 'S6'), msg(9, 'S9')];
		expect(getActSummaryAtScene(messages, 7)).toBe('S6');
		expect(getActSummaryAtScene(messages, 9)).toBe('S9');
		expect(getActSummaryAtScene(messages, 3)).toBe('S3');
	});

	it('returns empty string when nothing exists at or before maxScene', () => {
		// Early act: no completed summary yet ⇒ caller omits the Summaries message.
		expect(getActSummaryAtScene([msg(3, 'S3'), msg(6, 'S6')], 2)).toBe('');
	});

	it('skips messages without a summary and falls back to an earlier one', () => {
		expect(getActSummaryAtScene([msg(3, 'S3'), msg(6), msg(9, 'S9')], 7)).toBe('S3');
	});

	it('returns empty for no messages', () => {
		expect(getActSummaryAtScene([], 5)).toBe('');
	});
});
