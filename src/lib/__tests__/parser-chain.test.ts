import { describe, it, expect } from 'vitest';
import { createParserChain } from '../ai/parser-chain';
import type { GameData } from '../db/messages';

const T = 'think';
const FENCE_OPEN = '```markdown';
const FENCE_CLOSE = '```';

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

const GAME_DATA_MD = [
	'# Game Data',
	'',
	'## World State',
	'',
	'The hero stands at a crossroads.',
	'',
	'## Decisions',
	'',
	'- Go left',
	'- Go right',
].join('\n');

describe('ParserChain', () => {
	it('extracts game data when no thinking tags are present', () => {
		const input = 'Story text\n' + GAME_DATA_MD;
		const { text, gameData } = feedAll([input]);
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toContain('Story text');
	});

	it('extracts thinking and game data from same stream', () => {
		const input = '<' + T + '>Reasoning here</' + T + '>Story\n' + GAME_DATA_MD;
		const { text, thinking, gameData } = feedAll([input]);
		expect(thinking).toBe('Reasoning here');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n');
	});

	it('extracts game data when thinking tag is followed by game data in chunks', () => {
		const chunks = ['<' + T + '>Let me think', ' about this</' + T + '>', 'Story\n' + GAME_DATA_MD];
		const { text, thinking, gameData } = feedAll(chunks);
		expect(thinking).toBe('Let me think about this');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n');
	});

	it('preserves game data when text is empty between think tag and markdown block', () => {
		const input = '<' + T + '>thought</' + T + '>' + GAME_DATA_MD;
		const { thinking, gameData } = feedAll([input]);
		expect(thinking).toBe('thought');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
	});

	it('handles game data in flushed content from thinking parser', () => {
		const chunks = ['<' + T + '>Incomplete thought'];
		const { text, thinking } = feedAll(chunks);
		expect(thinking).toBeNull();
		expect(text).toContain('<' + T + '>');
		expect(text).toContain('Incomplete thought');
	});

	it('game data survives when thinking tag ends mid-chunk and markdown starts same chunk', () => {
		const chunk1 = '<' + T + '>reasoning</' + T + '>Story\n' + GAME_DATA_MD;
		const { text, thinking, gameData } = feedAll([chunk1]);
		expect(thinking).toBe('reasoning');
		expect(gameData).not.toBeNull();
		expect(gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n');
	});

	describe('reasoning accumulation', () => {
		it('preserves thinking-tag reasoning when result.reasoning is empty', () => {
			const chain = createParserChain();
			let messageReasoning = '';

			const out = chain.feed('<' + T + '>Deep reasoning here</' + T + '>Story text');
			if (out.thinking) messageReasoning += out.thinking;

			const flushed = chain.flush();
			if (flushed.thinking) messageReasoning += flushed.thinking;

			expect(messageReasoning).toBe('Deep reasoning here');
		});

		it('accumulates reasoning from both thinking tags and reasoning-delta', () => {
			const chain = createParserChain();
			let messageReasoning = '';

			const out = chain.feed('<' + T + '>Tag reasoning</' + T + '>');
			if (out.thinking) messageReasoning += out.thinking;

			messageReasoning += 'Explicit delta';

			const flushed = chain.flush();
			if (flushed.thinking) messageReasoning += flushed.thinking;

			expect(messageReasoning).toBe('Tag reasoningExplicit delta');
		});
	});

	describe('Review Scratchpad extraction', () => {
		it('extracts # Review Scratchpad and hides it from text', () => {
			const input = 'Before\n# Review Scratchpad\nCheck pacing and tone\n# Revised Narrative\n' + FENCE_OPEN + '\nAfter\n' + FENCE_CLOSE;
			const { text, reviewScratchpad } = feedAll([input]);
			expect(reviewScratchpad).toBe('\nCheck pacing and tone\n');
			expect(text).not.toContain('Check pacing');
		});

		it('extracts # Review Scratchpad after thinking tags', () => {
			const input =
				'<' +
				T +
				'>Let me review</' +
				T +
				'>\n# Review Scratchpad\nPacing is off\n# Revised Narrative\n' +
				FENCE_OPEN +
				'\nStory text\n' +
				FENCE_CLOSE;
			const { thinking, reviewScratchpad } = feedAll([input]);
			expect(thinking).toBe('Let me review');
			expect(reviewScratchpad).toBe('\nPacing is off\n');
		});

		it('handles # Review Scratchpad split across chunks after thinking', () => {
			const chunks = [
				'<' + T + '>Thought</' + T + '>',
				'\n# Review Scratchpad\nReview',
				' notes\n# Revised Narrative\n' + FENCE_OPEN + '\n Story\n' + FENCE_CLOSE,
			];
			const { thinking, reviewScratchpad } = feedAll(chunks);
			expect(thinking).toBe('Thought');
			expect(reviewScratchpad).toBe('\nReview notes\n');
		});

		it('flushes incomplete # Review Scratchpad at EOF', () => {
			const chunks = ['Text\n# Review Scratchpad\nUnfinished review'];
			const { reviewScratchpad } = feedAll(chunks);
			expect(reviewScratchpad).toBe('\nUnfinished review');
		});
	});

	describe('Revised Narrative extraction', () => {
		it('extracts # Revised Narrative content from code fence', () => {
			const input = 'Original\n# Revised Narrative\n' + FENCE_OPEN + '\nImproved version\n' + FENCE_CLOSE;
			const { revisedNarrative } = feedAll([input]);
			expect(revisedNarrative).toBe('Improved version\n');
		});

		it('extracts # Revised Narrative after # Review Scratchpad', () => {
			const input = '# Review Scratchpad\nFix pacing\n# Revised Narrative\n' + FENCE_OPEN + '\nBetter pacing here\n' + FENCE_CLOSE;
			const { reviewScratchpad, revisedNarrative } = feedAll([input]);
			expect(reviewScratchpad).toBe('\nFix pacing\n');
			expect(revisedNarrative).toBe('Better pacing here\n');
		});
	});

	describe('Revised Narrative with embedded game data', () => {
		it('extracts game data from # Revised Narrative code fence into revisedGameData', () => {
			const narrativeMd = 'The story continues\n' + GAME_DATA_MD;
			const input = '# Revised Narrative\n' + FENCE_OPEN + '\n' + narrativeMd + '\n' + FENCE_CLOSE;
			const { revisedNarrative, revisedGameData } = feedAll([input]);
			expect(revisedNarrative).toBe('The story continues\n');
			expect(revisedGameData).not.toBeNull();
			expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
		});

		it('prioritizes revisedGameData over gameData in review callback pattern', () => {
			const draftMd = ['# Game Data', '', '## World State', '', 'draft state', '', '## Decisions', '', '- draft choice'].join('\n');
			const revisedMd = 'Revised text\n' + GAME_DATA_MD;
			const input = 'Draft text\n' + draftMd + '\n# Revised Narrative\n' + FENCE_OPEN + '\n' + revisedMd + '\n' + FENCE_CLOSE;
			const { gameData, revisedGameData, revisedNarrative } = feedAll([input]);
			expect(revisedNarrative).toBe('Revised text\n');
			expect(gameData).not.toBeNull();
			expect(gameData?.decisions).toEqual(['draft choice']);
			expect(revisedGameData).not.toBeNull();
			expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
		});
	});

	describe('full chain: thinking + review + revised + game data', () => {
		it('extracts all layers in sequence', () => {
			const input =
				'<' +
				T +
				'>Analyzing narrative</' +
				T +
				'>' +
				'\n# Review Scratchpad' +
				'\nTone is inconsistent' +
				'\n# Revised Narrative' +
				'\n' +
				FENCE_OPEN +
				'\nThe sun set over the hills' +
				'\n' +
				FENCE_CLOSE;
			const { thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll([input]);
			expect(thinking).toBe('Analyzing narrative');
			expect(reviewScratchpad).toBe('\nTone is inconsistent\n');
			expect(revisedNarrative).toBe('The sun set over the hills\n');
			expect(gameData).toBeNull();
			expect(revisedGameData).toBeNull();
		});

		it('handles all layers split across chunks', () => {
			const chunks = [
				'<' + T + '>Deep ',
				'thought</think',
				'>',
				'\n# Review Scratchpad\nReview',
				'\n# Revised Narrative\n' + FENCE_OPEN,
				'\nRev',
				'ised\n' + FENCE_CLOSE,
			];
			const { thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll(chunks);
			expect(thinking).toBe('Deep thought');
			expect(reviewScratchpad).toBe('\nReview\n');
			expect(revisedNarrative).toBe('Revised\n');
			expect(gameData).toBeNull();
			expect(revisedGameData).toBeNull();
		});

		it('omits missing layers', () => {
			const input = '<' + T + '>Just thinking</' + T + '>Story text';
			const { thinking, gameData, reviewScratchpad, revisedNarrative, text } = feedAll([input]);
			expect(thinking).toBe('Just thinking');
			expect(reviewScratchpad).toBeNull();
			expect(revisedNarrative).toBeNull();
			expect(gameData).toBeNull();
			expect(text).toBe('Story text');
		});
	});
});
