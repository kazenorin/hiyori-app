import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('#lib/logging/logger.ts', () => ({
	log: {
		info: vi.fn(async () => {}),
		error: vi.fn(async () => {}),
		warn: vi.fn(async () => {}),
		debug: vi.fn(async () => {}),
	},
	fileLog: vi.fn(async () => {}),
}));

import { buildCompactSummarizerMessages } from '#lib/ai/pipeline/message-builder.ts';
import { loadLocaleStrings } from '#lib/localization/index.ts';
import type { NarrativeVariables } from '#lib/ai/narrative-types.ts';

beforeAll(async () => {
	await loadLocaleStrings('en');
});

const existingSummary = '# Act Summary\n\n## Scene Summaries\n\n### Scene 8: Before\n- Location: Road\n- Summary: Earlier events.';

const variables: NarrativeVariables = {
	sceneTitle: 'The Gate',
	background: null,
	narrativeBody: 'They arrive at the gate.',
	turnOfEvents: 'The gate is sealed.',
	cg: null,
	gameData: null,
};

const player = { playerResponse: 'Open the gate', playerMessageId: 'msg-9' };

describe('buildCompactSummarizerMessages', () => {
	it('full layout: summary, narrative body, player response, turn of events, final line', () => {
		const messages = buildCompactSummarizerMessages(existingSummary, variables, 9, player, undefined, 'FINAL-LINE');
		const contents = messages.map((m) => m.content);
		expect(contents).toHaveLength(5);
		expect(contents[0]).toContain('Scene 8: Before');
		expect(contents[1]).toContain('Narrative Body for Scene 9');
		expect(contents[1]).toContain('They arrive at the gate.');
		expect(contents[2]).toContain('Player Response');
		expect(contents[2]).toContain('Open the gate');
		expect(contents[3]).toContain('Turn Of Events');
		expect(contents[3]).toContain('The gate is sealed.');
		expect(contents[4]).toBe('FINAL-LINE');
		expect(messages.every((m) => m.role === 'user')).toBe(true);
	});

	it('no narrative body: summary + player response + final line only (pre-change fallback)', () => {
		const messages = buildCompactSummarizerMessages(existingSummary, undefined, 9, player, undefined, 'FALLBACK-LINE');
		const contents = messages.map((m) => m.content);
		expect(contents).toHaveLength(3);
		expect(contents[0]).toContain('Scene 8: Before');
		expect(contents[1]).toContain('Open the gate');
		expect(contents[2]).toBe('FALLBACK-LINE');
	});

	it('empty summary and no player: skeleton section + final line', () => {
		// serializeActSummary always emits the Act Summary / Scene Summaries headers,
		// so an empty summary still yields one skeleton section (today's parity).
		const messages = buildCompactSummarizerMessages('', undefined, 1, undefined, undefined, 'FALLBACK-LINE');
		const contents = messages.map((m) => m.content);
		expect(contents).toHaveLength(2);
		expect(contents[0]).toContain('Act Summary');
		expect(contents[0]).toContain('Scene Summaries');
		expect(contents[1]).toBe('FALLBACK-LINE');
	});

	it('no turn of events: section omitted', () => {
		const messages = buildCompactSummarizerMessages(
			existingSummary,
			{ ...variables, turnOfEvents: null },
			9,
			player,
			undefined,
			'FINAL-LINE'
		);
		const contents = messages.map((m) => m.content);
		expect(contents).toHaveLength(4);
		expect(contents.some((c) => c.includes('Turn Of Events'))).toBe(false);
	});
});
