import { describe, it, expect } from 'vitest';
import { createParserChain } from '../ai/parser-chain';
import type { GameData } from '../db/messages';

const T = 'think';

function feedAll(chunks: string[]): {
	text: string;
	thinking: string | null;
	gameData: GameData | null;
	reviewScratchpad: string | null;
	revisedNarrative: string | null;
	revisedGameData: GameData | null;
} {
	const chain = createParserChain();
	let text = '';
	let thinking: string | null = null;
	let gameData: GameData | null = null;
	let reviewScratchpad: string | null = null;
	let revisedNarrative: string | null = null;
	let revisedGameData: GameData | null = null;

	for (const chunk of chunks) {
		const output = chain.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
		if (output.gameData) gameData = output.gameData;
		if (output.reviewScratchpad) reviewScratchpad = (reviewScratchpad ?? '') + output.reviewScratchpad;
		if (output.revisedNarrative) revisedNarrative = (revisedNarrative ?? '') + output.revisedNarrative;
		if (output.revisedGameData) revisedGameData = output.revisedGameData;
	}

	const flushed = chain.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;
	if (flushed.gameData) gameData = flushed.gameData;
	if (flushed.reviewScratchpad) reviewScratchpad = (reviewScratchpad ?? '') + flushed.reviewScratchpad;
	if (flushed.revisedNarrative) revisedNarrative = (revisedNarrative ?? '') + flushed.revisedNarrative;
	if (flushed.revisedGameData) revisedGameData = flushed.revisedGameData;

	return { text, thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData };
}

const GAME_DATA_JSON = JSON.stringify({
	worldState: 'The hero stands at a crossroads.',
	decisions: ['Go left', 'Go right'],
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
		const chunks = [`<${T}>Let me think`, ` about this</${T}>`, 'Story\n```json\n', GAME_DATA_JSON, '\n```\nEnd'];
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

		describe('review_scratchpad extraction', () => {
			it('extracts review_scratchpad and hides it from text', () => {
				const input = 'Before<review_scratchpad>Check pacing and tone</review_scratchpad>After';
				const { text, reviewScratchpad } = feedAll([input]);
				expect(text).toBe('BeforeAfter');
				expect(reviewScratchpad).toBe('Check pacing and tone');
			});

			it('extracts review_scratchpad after thinking tags', () => {
				const input = `<${T}>Let me review</${T}><review_scratchpad>Pacing is off</review_scratchpad>Story text`;
				const { text, thinking, reviewScratchpad } = feedAll([input]);
				expect(thinking).toBe('Let me review');
				expect(reviewScratchpad).toBe('Pacing is off');
				expect(text).toBe('Story text');
			});

			it('handles review_scratchpad split across chunks after thinking', () => {
				const chunks = [`<${T}>Thought</${T}>`, '<review_scratchpad>Review', ' notes</review_scratchpad>', ' Story'];
				const { text, thinking, reviewScratchpad } = feedAll(chunks);
				expect(thinking).toBe('Thought');
				expect(reviewScratchpad).toBe('Review notes');
				expect(text).toBe(' Story');
			});

			it('flushes incomplete review_scratchpad as text', () => {
				const chunks = ['Text<review_scratchpad>Unfinished review'];
				const { text, reviewScratchpad } = feedAll(chunks);
				expect(text).toBe('Text');
				expect(reviewScratchpad).toBe('Unfinished review');
			});
		});

		describe('revised_narrative extraction', () => {
			it('extracts revised_narrative and hides it from text', () => {
				const input = 'Original<revised_narrative>Improved version</revised_narrative>';
				const { text, revisedNarrative } = feedAll([input]);
				expect(text).toBe('Original');
				expect(revisedNarrative).toBe('Improved version');
			});

			it('extracts revised_narrative after review_scratchpad', () => {
				const input = '<review_scratchpad>Fix pacing</review_scratchpad><revised_narrative>Better pacing here</revised_narrative>End';
				const { text, reviewScratchpad, revisedNarrative } = feedAll([input]);
				expect(reviewScratchpad).toBe('Fix pacing');
				expect(revisedNarrative).toBe('Better pacing here');
				expect(text).toBe('End');
			});
		});

		describe('revised_narrative with embedded game data', () => {
			it('extracts game data from revised_narrative into revisedGameData', () => {
				const input = [
					'<revised_narrative>The story continues\n```json\n',
					GAME_DATA_JSON,
					'\n```\nMore narrative</revised_narrative>',
				].join('');
				const { text, gameData, revisedNarrative, revisedGameData } = feedAll([input]);
				expect(text).toBe('');
				expect(revisedNarrative).toBe('The story continues\n\nMore narrative');
				expect(gameData).toBeNull(); // No game data outside the tag
				expect(revisedGameData).not.toBeNull(); // Game data inside the tag
				expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
			});

			it('handles revised_narrative game data split across chunks', () => {
				const chunks = ['<revised_narrative>Text```json\n', GAME_DATA_JSON, '\n```</revised_narrative>'];
				const { revisedNarrative, revisedGameData, gameData } = feedAll(chunks);
				expect(revisedNarrative).toBe('Text');
				expect(revisedGameData).not.toBeNull();
				expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
				expect(gameData).toBeNull();
			});

			it('prioritizes revisedGameData over gameData in review callback pattern', () => {
				// Simulates reviewer output: draft gameData outside, revised gameData inside tag
				const input = [
					'Draft text```json\n',
					JSON.stringify({ worldState: 'draft state', decisions: ['draft choice'] }),
					'\n```\n',
					'<revised_narrative>Revised text```json\n',
					GAME_DATA_JSON,
					'\n```\n</revised_narrative>',
				].join('');
				const { text, gameData, revisedGameData, revisedNarrative } = feedAll([input]);
				expect(text).toBe('Draft text\n'); // Draft game data removed from text
				expect(revisedNarrative).toBe('Revised text\n');
				expect(gameData).not.toBeNull();
				expect(gameData?.decisions).toEqual(['draft choice']);
				expect(revisedGameData).not.toBeNull();
				expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
			});
		});

		describe('full chain: thinking + review + revised + game data', () => {
			it('extracts all layers in sequence', () => {
				const input = [
					`<${T}>Analyzing narrative</${T}>`,
					'<review_scratchpad>Tone is inconsistent</review_scratchpad>',
					'<revised_narrative>The sun set over the hills</revised_narrative>',
					'Story continues\n```json\n',
					GAME_DATA_JSON,
					'\n```\nEnd',
				].join('');
				const { text, thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll([input]);
				expect(thinking).toBe('Analyzing narrative');
				expect(reviewScratchpad).toBe('Tone is inconsistent');
				expect(revisedNarrative).toBe('The sun set over the hills');
				expect(gameData).not.toBeNull();
				expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
				expect(revisedGameData).toBeNull();
				expect(text).toBe('Story continues\n\nEnd');
			});

			it('handles all layers split across chunks', () => {
				const chunks = [
					`<${T}>Deep `,
					'thought</think',
					'>',
					'<review_scratchpad>Review',
					'</review_scratchpad>',
					'<revised_narrative>Rev',
					'ised</revised_narrative>',
					'Text```json\n',
					GAME_DATA_JSON,
					'\n```',
				];
				const { text, thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll(chunks);
				expect(thinking).toBe('Deep thought');
				expect(reviewScratchpad).toBe('Review');
				expect(revisedNarrative).toBe('Revised');
				expect(gameData).not.toBeNull();
				expect(revisedGameData).toBeNull();
				expect(text).toBe('Text');
			});

			it('omits missing layers', () => {
				const input = `<${T}>Just thinking</${T}>Story text`;
				const { text, thinking, gameData, reviewScratchpad, revisedNarrative } = feedAll([input]);
				expect(thinking).toBe('Just thinking');
				expect(reviewScratchpad).toBeNull();
				expect(revisedNarrative).toBeNull();
				expect(gameData).toBeNull();
				expect(text).toBe('Story text');
			});
		});
	});
});
