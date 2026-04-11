import { describe, it, expect } from 'vitest';
import { createParserChain } from '../ai/parser-chain';
import type { GameData } from '../db/messages';

const T = 'think';

function feedAll(chunks: string[]): { text: string; thinking: string | null; gameData: GameData | null } {
	const chain = createParserChain();
	let text = '';
	let thinking: string | null = null;
	let gameData: GameData | null = null;

	for (const chunk of chunks) {
		const output = chain.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
		if (output.gameData) gameData = output.gameData;
	}

	const flushed = chain.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;
	if (flushed.gameData) gameData = flushed.gameData;

	return { text, thinking, gameData };
}

const GAME_DATA_JSON = JSON.stringify({
	worldState: 'The hero stands at a crossroads.',
	decisions: ['Go left', 'Go right']
});

describe('ParserChain', () => {
	it('extracts game data when no thinking tags are present', () => {
		const input = `Story text\n\`\`\`json\n${GAME_DATA_JSON}\n\`\`\`\nMore text`;
		const { text, gameData } = feedAll([input]);
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toContain('Story text');
		expect(text).toContain('More text');
	});

	it('extracts thinking and game data from same stream', () => {
		const input = `<${T}>Reasoning here</${T}>Story\n\`\`\`json\n${GAME_DATA_JSON}\n\`\`\`\nEnd`;
		const { text, thinking, gameData } = feedAll([input]);
		expect(thinking).toBe('Reasoning here');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n\nEnd');
	});

	it('extracts game data when thinking tag is followed by game data in chunks', () => {
		const chunks = [
			`<${T}>Let me think`,
			` about this</${T}>`,
			'Story\n```json\n',
			GAME_DATA_JSON,
			'\n```\nEnd'
		];
		const { text, thinking, gameData } = feedAll(chunks);
		expect(thinking).toBe('Let me think about this');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n\nEnd');
	});

	it('preserves game data when text is empty between think tag and json block', () => {
		const input = `<${T}>thought</${T}>\`\`\`json\n${GAME_DATA_JSON}\n\`\`\` `;
		const { thinking, gameData } = feedAll([input]);
		expect(thinking).toBe('thought');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
	});

	it('handles game data in flushed content from thinking parser', () => {
		const chunks = [`<${T}>Incomplete thought`];
		const { text, thinking } = feedAll(chunks);
		expect(thinking).toBeNull();
		expect(text).toContain(`<${T}>`);
		expect(text).toContain('Incomplete thought');
	});

	it('game data survives when thinking tag ends mid-chunk and json starts same chunk', () => {
		const chunk1 = `<${T}>reasoning</${T}>\`\`\`json\n`;
		const chunk2 = GAME_DATA_JSON;
		const chunk3 = '\n```';
		const { text, thinking, gameData } = feedAll([chunk1, chunk2, chunk3]);
		expect(thinking).toBe('reasoning');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('');
	});

	describe('reasoning accumulation', () => {
		it('preserves thinking-tag reasoning when result.reasoning is empty', () => {
			const chain = createParserChain();
			let messageReasoning = '';

			const out = chain.feed(`<${T}>Deep reasoning here</${T}>Story text`);
			if (out.thinking) messageReasoning += out.thinking;

			const flushed = chain.flush();
			if (flushed.thinking) messageReasoning += flushed.thinking;

			expect(messageReasoning).toBe('Deep reasoning here');
		});

		it('accumulates reasoning from both thinking tags and reasoning-delta', () => {
			const chain = createParserChain();
			let messageReasoning = '';

			const out = chain.feed(`<${T}>Tag reasoning</${T}>`);
			if (out.thinking) messageReasoning += out.thinking;

			messageReasoning += 'Explicit delta';

			const flushed = chain.flush();
			if (flushed.thinking) messageReasoning += flushed.thinking;

			expect(messageReasoning).toBe('Tag reasoningExplicit delta');
		});
	});
});
