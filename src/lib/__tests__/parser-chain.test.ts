import { describe, it, expect } from 'vitest';
import { createParserChain, type NarrativeSections } from '../ai/parser-chain';
import type { GameData } from '../db/messages';

const T = 'think';

function feedAll(chunks: string[]): {
	text: string;
	thinking: string | null;
	gameData: GameData | null;
	reviewScratchpad: string | null;
	revisedNarrative: string | null;
	revisedGameData: GameData | null;
	sections: NarrativeSections | null;
} {
	const chain = createParserChain();
	let text = '';
	let thinking: string | null = null;
	let gameData: GameData | null = null;
	let reviewScratchpad: string | null = null;
	let revisedNarrative: string | null = null;
	let revisedGameData: GameData | null = null;
	let sections: NarrativeSections | null = null;

	for (const chunk of chunks) {
		const output = chain.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
		if (output.gameData) gameData = output.gameData;
		if (output.reviewScratchpad) reviewScratchpad = (reviewScratchpad ?? '') + output.reviewScratchpad;
		if (output.revisedNarrative) revisedNarrative = (revisedNarrative ?? '') + output.revisedNarrative;
		if (output.revisedGameData) revisedGameData = output.revisedGameData;
		if (output.sections) sections = sections ? { ...sections, ...output.sections } : output.sections;
	}

	const flushed = chain.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;
	if (flushed.gameData) gameData = flushed.gameData;
	if (flushed.reviewScratchpad) reviewScratchpad = (reviewScratchpad ?? '') + flushed.reviewScratchpad;
	if (flushed.revisedNarrative) revisedNarrative = (revisedNarrative ?? '') + flushed.revisedNarrative;
	if (flushed.revisedGameData) revisedGameData = flushed.revisedGameData;
	if (flushed.sections) sections = sections ? { ...sections, ...flushed.sections } : flushed.sections;

	return { text, thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData, sections };
}

const GAME_DATA_MD = [
	'## Game Data',
	'',
	'### World State',
	'',
	'The hero stands at a crossroads.',
	'',
	'### Decisions',
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
			const input = 'Before\n# Review Scratchpad\nCheck pacing and tone\n# Revised Narrative\nAfter';
			const { text, reviewScratchpad } = feedAll([input]);
			expect(reviewScratchpad).toBe('Check pacing and tone\n');
			expect(text).not.toContain('Check pacing');
		});

		it('extracts # Review Scratchpad after thinking tags', () => {
			const input = '<' + T + '>Let me review</' + T + '>\n# Review Scratchpad\nPacing is off\n# Revised Narrative\nStory text';
			const { thinking, reviewScratchpad } = feedAll([input]);
			expect(thinking).toBe('Let me review');
			expect(reviewScratchpad).toBe('Pacing is off\n');
		});

		it('handles # Review Scratchpad split across chunks after thinking', () => {
			const chunks = ['<' + T + '>Thought</' + T + '>', '\n# Review Scratchpad\nReview', ' notes\n# Revised Narrative\n Story'];
			const { thinking, reviewScratchpad } = feedAll(chunks);
			expect(thinking).toBe('Thought');
			expect(reviewScratchpad).toBe('Review notes\n');
		});

		it('flushes incomplete # Review Scratchpad at EOF', () => {
			const chunks = ['Text\n# Review Scratchpad\nUnfinished review'];
			const { reviewScratchpad } = feedAll(chunks);
			expect(reviewScratchpad).toBe('Unfinished review');
		});
	});

	describe('Revised Narrative extraction', () => {
		it('extracts # Revised Narrative content', () => {
			const input = 'Original\n# Revised Narrative\nImproved version';
			const { revisedNarrative } = feedAll([input]);
			expect(revisedNarrative).toBe('Improved version');
		});

		it('extracts # Revised Narrative after # Review Scratchpad', () => {
			const input = '# Review Scratchpad\nFix pacing\n# Revised Narrative\nBetter pacing here';
			const { reviewScratchpad, revisedNarrative } = feedAll([input]);
			expect(reviewScratchpad).toBe('Fix pacing\n');
			expect(revisedNarrative).toBe('Better pacing here');
		});
	});

	describe('Revised Narrative with embedded game data', () => {
		it('extracts game data from # Revised Narrative into revisedGameData', () => {
			const narrativeMd = 'The story continues\n' + GAME_DATA_MD;
			const input = '# Revised Narrative\n' + narrativeMd;
			const { revisedNarrative, revisedGameData } = feedAll([input]);
			expect(revisedNarrative).toBe('The story continues\n');
			expect(revisedGameData).not.toBeNull();
			expect(revisedGameData?.decisions).toEqual(['Go left', 'Go right']);
		});

		it('prioritizes revisedGameData over gameData in review callback pattern', () => {
			const draftMd = ['## Game Data', '', '### World State', '', 'draft state', '', '### Decisions', '', '- draft choice'].join('\n');
			const revisedMd = 'Revised text\n' + GAME_DATA_MD;
			const input = 'Draft text\n' + draftMd + '\n# Revised Narrative\n' + revisedMd;
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
				'\nThe sun set over the hills';
			const { thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll([input]);
			expect(thinking).toBe('Analyzing narrative');
			expect(reviewScratchpad).toBe('Tone is inconsistent\n');
			expect(revisedNarrative).toBe('The sun set over the hills');
			expect(gameData).toBeNull();
			expect(revisedGameData).toBeNull();
		});

		it('handles all layers split across chunks', () => {
			const chunks = ['<' + T + '>Deep ', 'thought</think', '>', '\n# Review Scratchpad\nReview', '\n# Revised Narrative\nRev', 'ised'];
			const { thinking, gameData, reviewScratchpad, revisedNarrative, revisedGameData } = feedAll(chunks);
			expect(thinking).toBe('Deep thought');
			expect(reviewScratchpad).toBe('Review\n');
			expect(revisedNarrative).toBe('Revised');
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

describe('Revised Narrative with ## Scratchpad (suppress-nesting)', () => {
	it('captures revised narrative content after ## Scratchpad', () => {
		// This tests the bug where ## Scratchpad inside # Revised Narrative
		// would cause section mode to reset to 'normal' instead of 'captureRevised'
		const input = [
			'# Review Scratchpad',
			'- Rule 1: OK',
			'',
			'# Revised Narrative',
			'## Scratchpad',
			'[Planning notes]',
			'',
			'## Story Information',
			'',
			'### Story Title',
			'My Story',
			'',
			'## Background',
			'The setting.',
		].join('\n');
		const { revisedNarrative, reviewScratchpad } = feedAll([input]);

		// Review scratchpad should have the review content
		// Note: SAX parser strips list markers, so "- Rule 1: OK" becomes "Rule 1: OK"
		expect(reviewScratchpad).toBe('Rule 1: OK\n');

		// Revised narrative should include content after ## Scratchpad
		// (The scratchpad section itself is suppressed)
		// Note: SAX parser strips header markers, so "## Story Information" becomes "Story Information"
		expect(revisedNarrative).not.toBeNull();
		expect(revisedNarrative).toContain('Story Information');
		expect(revisedNarrative).toContain('My Story');
		expect(revisedNarrative).toContain('The setting.');
		expect(revisedNarrative).not.toContain('[Planning notes]');
	});

	it('streams revised narrative content progressively during feed', () => {
		// Test that revised narrative accumulates across feed calls
		const chunks = [
			'# Review Scratchpad\n',
			'- Analysis\n',
			'\n# Revised Narrative\n',
			'## Scratchpad\n',
			'[Hidden]\n',
			'\n## Story\n',
			'Content here.\n',
		];

		const chain = createParserChain();
		let revisedNarrative = '';

		for (const chunk of chunks) {
			const output = chain.feed(chunk);
			if (output.revisedNarrative) {
				revisedNarrative += output.revisedNarrative;
			}
		}

		const flushed = chain.flush();
		if (flushed.revisedNarrative) {
			revisedNarrative += flushed.revisedNarrative;
		}

		expect(revisedNarrative).toContain('Story');
		expect(revisedNarrative).toContain('Content here.');
		expect(revisedNarrative).not.toContain('[Hidden]');
	});
});

describe('Narrative Sections', () => {
	it('captures all narrative sections from structured output', () => {
		const input = [
			'## Scratchpad',
			'[Planning notes]',
			'',
			'## Story Information',
			'',
			'### Story Title',
			'The Great Adventure',
			'',
			'### Act Number',
			'3',
			'',
			'### Session number',
			'7',
			'',
			'### Scene',
			'',
			'#### Scene number',
			'12',
			'',
			'#### Scene title',
			'The Dark Forest',
			'',
			'## Background',
			'A moonlit clearing in an ancient forest.',
			'',
			'## Narrative Body',
			'The hero stepped forward cautiously.',
			'',
			'## CG',
			'Wide shot, moonlit clearing, hero silhouette.',
			'',
			'## Status Update',
			'',
			'### Current Context',
			'Approaching the ancient ruins.',
			'',
			'### Active Plot Threads',
			'- The missing artifact',
			'- The traitor in the party',
			'',
			'## Decision context',
			'Choose how to enter the ruins.',
		].join('\n');

		const { sections, text } = feedAll([input]);

		expect(sections).not.toBeNull();
		expect(sections!.storyTitle).toContain('The Great Adventure');
		expect(sections!.actNumber).toContain('3');
		expect(sections!.sessionNumber).toContain('7');
		expect(sections!.sceneNumber).toContain('12');
		expect(sections!.sceneTitle).toContain('The Dark Forest');
		expect(sections!.background).toContain('A moonlit clearing in an ancient forest.');
		expect(sections!.narrativeBody).toContain('The hero stepped forward cautiously.');
		expect(sections!.cg).toContain('Wide shot, moonlit clearing, hero silhouette.');
		expect(sections!.currentContext).toContain('Approaching the ancient ruins.');
		expect(sections!.activePlotThreads).toContain('missing artifact');
		expect(sections!.decisionContext).toContain('Choose how to enter the ruins.');
		// Scratchpad should be suppressed
		expect(text).not.toContain('[Planning notes]');
	});

	it('captures partial sections with null for missing fields', () => {
		const input = ['## Background', 'A dark and stormy night.', '', '## Narrative Body', 'Something happened.'].join('\n');

		const { sections } = feedAll([input]);

		expect(sections).not.toBeNull();
		expect(sections!.background).toContain('A dark and stormy night.');
		expect(sections!.narrativeBody).toContain('Something happened.');
		expect(sections!.storyTitle).toBeNull();
		expect(sections!.actNumber).toBeNull();
		expect(sections!.cg).toBeNull();
	});

	it('returns null sections when no structured content', () => {
		const { sections } = feedAll(['Just plain text here.']);
		expect(sections).toBeNull();
	});

	it('streams sections progressively across feed calls', () => {
		const chain = createParserChain();

		// Header-only feed: section field is set but no content yet
		const output1 = chain.feed('## Background\n');
		// No sections yet — the header name is skipped and no body text has arrived
		expect(output1.sections).toBeNull();

		// Content feed: section body arrives
		const output2 = chain.feed('A dark forest.\n');
		expect(output2.sections).not.toBeNull();
		expect(output2.sections!.background).toContain('dark forest');
	});

	it('captures sections alongside game data', () => {
		const input = [
			'## Background',
			'The setting sun.',
			'',
			'## Narrative Body',
			'The story unfolds.',
			'',
			'## Game Data',
			'',
			'### World State',
			'The world is at peace.',
			'',
			'### Decisions',
			'- Fight',
			'- Flee',
		].join('\n');

		const { sections, gameData } = feedAll([input]);

		expect(sections).not.toBeNull();
		expect(sections!.background).toContain('The setting sun.');
		expect(sections!.narrativeBody).toContain('The story unfolds.');
		expect(gameData).not.toBeNull();
		expect(gameData!.worldState).toBe('The world is at peace.');
		expect(gameData!.decisions).toEqual(['Fight', 'Flee']);
	});
});
