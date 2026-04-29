import { describe, it, expect } from 'vitest';
import type {NarrativeVariables, GameDataFields} from '../ai/narrative-types';
import {createParserChain} from '../ai/parser-chain';

const T = 'think';

function feedAll(chunks: string[]): {
	text: string;
	thinking: string | null;
	variables: NarrativeVariables | null;
} {
	const chain = createParserChain();
	let text = '';
	let thinking: string | null = null;
	let variables: NarrativeVariables | null = null;

	for (const chunk of chunks) {
		const output = chain.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
		if (output.variables) {
			if (variables) {
				variables = mergeVariables(variables, output.variables);
			} else {
				variables = output.variables;
			}
		}
	}

	const flushed = chain.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;
	if (flushed.variables) {
		if (variables) {
			variables = mergeVariables(variables, flushed.variables);
		} else {
			variables = flushed.variables;
		}
	}

	return { text, thinking, variables };
}

/** Merge two NarrativeVariables: for string fields, concatenate; for number fields, keep latest; for gameData, deep-merge. */
function mergeVariables(base: NarrativeVariables, incoming: NarrativeVariables): NarrativeVariables {
  const result: NarrativeVariables = { ...base };

  // Cast 'res' once to a mutable dictionary to satisfy TypeScript inside the loop
  const res = result as unknown as Record<string, unknown>;

  for (const key of Object.keys(incoming) as (keyof NarrativeVariables)[]) {
    const val = incoming[key];
    const existing = base[key];

    if (val === null || val === undefined) continue;

    if (key === 'gameData') {
      const baseGd = base.gameData;
      const incGd = val as GameDataFields;

      if (baseGd) {
        res.gameData = {
          worldState: (baseGd.worldState ?? '') + (incGd.worldState ?? '') || null,
          decisions: [...baseGd.decisions, ...incGd.decisions],
          playerAliases: [...baseGd.playerAliases, ...incGd.playerAliases],
          otherCharacterAliases: { ...baseGd.otherCharacterAliases, ...incGd.otherCharacterAliases },
        };
      } else {
        res.gameData = incGd;
      }
    } else if (typeof val === 'number') {
      res[key] = val;
    } else if (typeof val === 'string') {
      res[key] = (typeof existing === 'string' ? existing : '') + val;
    } else if (Array.isArray(val)) {
      res[key] = Array.isArray(existing) ? [...existing, ...val] : val;
    }
  }

  return result;
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
		const { text, variables } = feedAll([input]);
		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toContain('Story text');
	});

	it('extracts thinking and game data from same stream', () => {
		const input = '<' + T + '>Reasoning here</' + T + '>Story\n' + GAME_DATA_MD;
		const { text, thinking, variables } = feedAll([input]);
		expect(thinking).toBe('Reasoning here');
		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n');
	});

	it('extracts game data when thinking tag is followed by game data in chunks', () => {
		const chunks = ['<' + T + '>Let me think', ' about this</' + T + '>', 'Story\n' + GAME_DATA_MD];
		const { text, thinking, variables } = feedAll(chunks);
		expect(thinking).toBe('Let me think about this');
		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
		expect(text).toBe('Story\n');
	});

	it('preserves game data when text is empty between think tag and markdown block', () => {
		const input = '<' + T + '>thought</' + T + '>' + GAME_DATA_MD;
		const { thinking, variables } = feedAll([input]);
		expect(thinking).toBe('thought');
		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
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
		const { text, thinking, variables } = feedAll([chunk1]);
		expect(thinking).toBe('reasoning');
		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
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
			const { text, variables } = feedAll([input]);
			// SAX parser emits header name as text, so "Review Scratchpad" is included
			expect(variables?.reviewScratchpad).toContain('Check pacing and tone');
			expect(text).not.toContain('Check pacing');
		});

		it('extracts # Review Scratchpad after thinking tags', () => {
			const input = '<' + T + '>Let me review</' + T + '>\n# Review Scratchpad\nPacing is off\n# Revised Narrative\nStory text';
			const { thinking, variables } = feedAll([input]);
			expect(thinking).toBe('Let me review');
			expect(variables?.reviewScratchpad).toContain('Pacing is off');
		});

		it('handles # Review Scratchpad split across chunks after thinking', () => {
			const chunks = ['<' + T + '>Thought</' + T + '>', '\n# Review Scratchpad\nReview', ' notes\n# Revised Narrative\n Story'];
			const { thinking, variables } = feedAll(chunks);
			expect(thinking).toBe('Thought');
			expect(variables?.reviewScratchpad).toContain('Review notes');
		});

		it('flushes incomplete # Review Scratchpad at EOF', () => {
			const chunks = ['Text\n# Review Scratchpad\nUnfinished review'];
			const { variables } = feedAll(chunks);
			expect(variables?.reviewScratchpad).toContain('Unfinished review');
		});
	});

	describe('Revised Narrative extraction', () => {
		it('extracts # Revised Narrative content into variables', () => {
			const input = 'Original\n# Revised Narrative\nImproved version';
			const { text } = feedAll([input]);
			// Revised narrative text is consumed (not passed through as visible text)
			expect(text).not.toContain('Improved version');
		});

		it('extracts # Revised Narrative after # Review Scratchpad', () => {
			const input = '# Review Scratchpad\nFix pacing\n# Revised Narrative\nBetter pacing here';
			const { variables } = feedAll([input]);
			expect(variables?.reviewScratchpad).toContain('Fix pacing');
			// Revised narrative text is consumed
		});
	});

	describe('Revised Narrative with embedded game data', () => {
		it('extracts game data from # Revised Narrative into variables.gameData', () => {
			const narrativeMd = 'The story continues\n' + GAME_DATA_MD;
			const input = '# Revised Narrative\n' + narrativeMd;
			const { variables } = feedAll([input]);
			expect(variables?.gameData).not.toBeNull();
			expect(variables?.gameData?.decisions).toEqual(['Go left', 'Go right']);
		});

		it('accumulates game data from both draft and revised sections', () => {
			const draftMd = ['## Game Data', '', '### World State', '', 'draft state', '', '### Decisions', '', '- draft choice'].join('\n');
			const revisedMd = 'Revised text\n' + GAME_DATA_MD;
			const input = 'Draft text\n' + draftMd + '\n# Revised Narrative\n' + revisedMd;
			const { variables } = feedAll([input]);
			expect(variables?.gameData).not.toBeNull();
			// Both draft and revised game data are accumulated
			expect(variables?.gameData?.decisions).toEqual(['draft choice', 'Go left', 'Go right']);
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
			const { thinking, variables } = feedAll([input]);
			expect(thinking).toBe('Analyzing narrative');
			expect(variables?.reviewScratchpad).toContain('Tone is inconsistent');
			expect(variables?.gameData).toBeNull();
		});

		it('handles all layers split across chunks', () => {
			const chunks = ['<' + T + '>Deep ', 'thought</think', '>', '\n# Review Scratchpad\nReview', '\n# Revised Narrative\nRev', 'ised'];
			const { thinking, variables } = feedAll(chunks);
			expect(thinking).toBe('Deep thought');
			expect(variables?.reviewScratchpad).toContain('Review');
			expect(variables?.gameData).toBeNull();
		});

		it('omits missing layers', () => {
			const input = '<' + T + '>Just thinking</' + T + '>Story text';
			const { thinking, variables, text } = feedAll([input]);
			expect(thinking).toBe('Just thinking');
			expect(variables?.scratchpad).toBeFalsy();
			expect(variables?.gameData).toBeFalsy();
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
		const { variables } = feedAll([input]);

		// Review scratchpad should have the review content
		// Note: SAX parser strips list markers, so "- Rule 1: OK" becomes "Rule 1: OK"
		// SAX parser also emits header name as text, so "Review Scratchpad" prefix is included
		expect(variables?.reviewScratchpad).toContain('Rule 1: OK');

		// Story title should be captured as a variable
		expect(variables?.storyTitle).toContain('My Story');
		// Background should be captured (includes header name prefix)
		expect(variables?.background).toContain('The setting.');
		// Scratchpad content should be captured
		expect(variables?.scratchpad).toContain('[Planning notes]');
	});

	it('streams revised narrative content progressively during feed', () => {
		// Test that narrative variables accumulate across feed calls
		const chunks = [
			'# Review Scratchpad\n',
			'- Analysis\n',
			'\n# Revised Narrative\n',
			'## Scratchpad\n',
			'[Hidden]\n',
			'\n## Background\n',
			'Content here.\n',
		];

		const chain = createParserChain();
		let background = '';
		let scratchpad = '';
		let reviewScratchpad = '';

		for (const chunk of chunks) {
			const output = chain.feed(chunk);
			if (output.variables?.background) {
				background += output.variables.background;
			}
			if (output.variables?.scratchpad) {
				scratchpad += output.variables.scratchpad;
			}
			if (output.variables?.reviewScratchpad) {
				reviewScratchpad += output.variables.reviewScratchpad;
			}
		}

		const flushed = chain.flush();
		if (flushed.variables?.background) {
			background += flushed.variables.background;
		}
		if (flushed.variables?.scratchpad) {
			scratchpad += flushed.variables.scratchpad;
		}
		if (flushed.variables?.reviewScratchpad) {
			reviewScratchpad += flushed.variables.reviewScratchpad;
		}

		expect(background).toContain('Content here.');
		expect(scratchpad).toContain('[Hidden]');
		expect(reviewScratchpad).toContain('Analysis');
	});
});

describe('Narrative Variables', () => {
	it('captures all narrative variables from structured output', () => {
		const lines = [
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
		];
		// Feed line by line (with trailing newlines) to simulate streaming
		const chunks = lines.map((l) => l + '\n');

		const { variables } = feedAll(chunks);

		expect(variables).not.toBeNull();
		// Note: ## Scratchpad does NOT populate variables.scratchpad — that field
		// is only populated by "# Review Scratchpad" headers. Plain ## Scratchpad
		// content passes through as visible text.
		expect(variables!.storyTitle).toContain('The Great Adventure');
		expect(variables!.actNumber).toBe(3);
		expect(variables!.sessionNumber).toBe(7);
		expect(variables!.sceneNumber).toBe(12);
		expect(variables!.sceneTitle).toContain('The Dark Forest');
		expect(variables!.background).toContain('A moonlit clearing in an ancient forest.');
		expect(variables!.narrativeBody).toContain('The hero stepped forward cautiously.');
		expect(variables!.cg).toContain('Wide shot, moonlit clearing, hero silhouette.');
		expect(variables!.currentContext).toContain('Approaching the ancient ruins.');
		expect(variables!.activePlotThreads).toEqual(['The missing artifact', 'The traitor in the party']);
		expect(variables!.decisionContext).toContain('Choose how to enter the ruins.');
		// ## Scratchpad is not the same as # Review Scratchpad
		expect(variables!.scratchpad).toContain('[Planning notes]');
	});

	it('captures partial variables with null for missing fields', () => {
		const input = ['## Background', 'A dark and stormy night.', '', '## Narrative Body', 'Something happened.'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		expect(variables!.background).toContain('A dark and stormy night.');
		expect(variables!.narrativeBody).toContain('Something happened.');
		expect(variables!.storyTitle).toBeNull();
		expect(variables!.actNumber).toBeNull();
		expect(variables!.cg).toBeNull();
	});

	it('returns null variables when no structured content', () => {
		const { variables } = feedAll(['Just plain text here.']);
		expect(variables).toBeNull();
	});

	it('streams variables progressively across feed calls', () => {
		const chain = createParserChain();

		// Header-only feed: opens the header and emits "Background" as text,
		// but the accumulator filters out the header name, so no variables yet
		const output1 = chain.feed('## Background\n');
		expect(output1.variables).toBeNull();

		// Content feed: section body arrives and produces background
		const output2 = chain.feed('A dark forest.\n');
		expect(output2.variables).not.toBeNull();
		expect(output2.variables!.background).toContain('dark forest');
	});

	it('captures variables alongside game data', () => {
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

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		expect(variables!.background).toContain('The setting sun.');
		expect(variables!.narrativeBody).toContain('The story unfolds.');
		expect(variables!.gameData).not.toBeNull();
		// SAX parser emits "World State" header name as text within game data
		expect(variables!.gameData!.worldState).toContain('The world is at peace.');
		expect(variables!.gameData!.decisions).toEqual(['Fight', 'Flee']);
	});
});
