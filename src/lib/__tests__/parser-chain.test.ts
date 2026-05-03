import { describe, it, expect } from 'vitest';
import type { NarrativeVariables, GameDataFields } from '../ai/narrative-types';
import { createParserChain } from '../ai/parser-chain';

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
	let finalizedFields = new Set<string>();

	for (const chunk of chunks) {
		const output = chain.feed(chunk);
		if (output.text) text += output.text;
		if (output.thinking) thinking = (thinking ?? '') + output.thinking;
		if (output.variables) {
			if (variables) {
				variables = mergeVariables(variables, output.variables, finalizedFields);
			} else {
				variables = output.variables;
			}
			finalizedFields = new Set([...finalizedFields, ...output.finalizedFields]);
		}
	}

	const flushed = chain.flush();
	if (flushed.text) text += flushed.text;
	if (flushed.thinking) thinking = (thinking ?? '') + flushed.thinking;
	if (flushed.variables) {
		if (variables) {
			variables = mergeVariables(variables, flushed.variables, finalizedFields);
		} else {
			variables = flushed.variables;
		}
		finalizedFields = new Set([...finalizedFields, ...flushed.finalizedFields]);
	}

	return { text, thinking, variables };
}

/** Merge two NarrativeVariables: for string fields, concatenate (or replace if finalized); for gameData, deep-merge. */
function mergeVariables(
	base: NarrativeVariables,
	incoming: NarrativeVariables,
	finalizedFields: Set<string> = new Set()
): NarrativeVariables {
	const result: NarrativeVariables = { ...base };

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
					activePlotThreads: [...baseGd.activePlotThreads, ...incGd.activePlotThreads],
					decisionContext: incGd.decisionContext ?? baseGd.decisionContext,
					decisions: [...baseGd.decisions, ...incGd.decisions],
				};
			} else {
				res.gameData = incGd;
			}
		} else if (typeof val === 'string') {
			// Finalized fields (raw content from onLeaveElement) replace rather than concatenate
			res[key] = finalizedFields.has(key as string) ? val : (typeof existing === 'string' ? existing : '') + val;
		} else if (Array.isArray(val)) {
			res[key] = Array.isArray(existing) ? [...existing, ...val] : val;
		}
	}

	return result;
}

const GAME_DATA_MD = [
	'## Game Data',
	'',
	'### Active Plot Threads',
	'',
	'- The missing artifact',
	'',
	'### Decision Context',
	'',
	'Choose your path.',
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
		expect(variables?.gameData?.activePlotThreads).toEqual(['The missing artifact']);
		expect(variables?.gameData?.decisionContext).toContain('Choose your path');
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

	describe('full chain: thinking + game data', () => {
		it('extracts all layers in sequence', () => {
			const input = '<' + T + '>Analyzing narrative</' + T + '>' + '\n' + GAME_DATA_MD;
			const { thinking, variables } = feedAll([input]);
			expect(thinking).toBe('Analyzing narrative');
			expect(variables?.gameData).not.toBeNull();
		});

		it('handles layers split across chunks', () => {
			const chunks = ['<' + T + '>Deep ', 'thought</think', '>', '\n' + GAME_DATA_MD];
			const { thinking, variables } = feedAll(chunks);
			expect(thinking).toBe('Deep thought');
			expect(variables?.gameData).not.toBeNull();
		});

		it('omits game data when not present', () => {
			const input = '<' + T + '>Just thinking</' + T + '>Story text';
			const { thinking, variables, text } = feedAll([input]);
			expect(thinking).toBe('Just thinking');
			expect(variables?.gameData).toBeFalsy();
			expect(text).toBe('Story text');
		});
	});
});

describe('Narrative Variables', () => {
	it('captures all narrative variables from structured output', () => {
		const lines = [
			'## Scene title',
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
			'## Game Data',
			'',
			'### Active Plot Threads',
			'',
			'- The missing artifact',
			'- The traitor in the party',
			'',
			'### Decision Context',
			'',
			'Choose how to enter the ruins.',
			'',
			'### Decisions',
			'',
			'- Enter through the front gate',
			'- Sneak through the back',
		];
		const chunks = lines.map((l) => l + '\n');

		const { variables } = feedAll(chunks);

		expect(variables).not.toBeNull();
		expect(variables!.sceneTitle).toContain('The Dark Forest');
		expect(variables!.background).toContain('A moonlit clearing in an ancient forest.');
		expect(variables!.narrativeBody).toContain('The hero stepped forward cautiously.');
		expect(variables!.cg).toContain('Wide shot, moonlit clearing, hero silhouette.');
		expect(variables!.gameData).not.toBeNull();
		expect(variables!.gameData!.activePlotThreads).toEqual(['The missing artifact', 'The traitor in the party']);
		expect(variables!.gameData!.decisionContext).toContain('Choose how to enter the ruins');
		expect(variables!.gameData!.decisions).toEqual(['Enter through the front gate', 'Sneak through the back']);
	});

	it('captures partial variables with null for missing fields', () => {
		const input = ['## Background', 'A dark and stormy night.', '', '## Narrative Body', 'Something happened.'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		expect(variables!.background).toContain('A dark and stormy night.');
		expect(variables!.narrativeBody).toContain('Something happened.');
		expect(variables!.sceneTitle).toBeNull();
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
			'### Active Plot Threads',
			'',
			'- The quest',
			'',
			'### Decision Context',
			'',
			'A crossroads.',
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
		expect(variables!.gameData!.activePlotThreads).toEqual(['The quest']);
		expect(variables!.gameData!.decisionContext).toContain('A crossroads');
		expect(variables!.gameData!.decisions).toEqual(['Fight', 'Flee']);
	});
});

describe('raw content capture', () => {
	it('captures raw markdown with list markers in section fields', () => {
		const input = ['## Background', '- Ancient trees', '- A clearing', '', '## Narrative Body', 'The hero arrived.'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		// Background should contain raw markdown with list markers
		expect(variables!.background).toContain('- Ancient trees');
		expect(variables!.background).toContain('- A clearing');
		// Narrative Body should contain raw text
		expect(variables!.narrativeBody).toContain('The hero arrived.');
	});

	it('captures raw content with sub-headers in parent sections', () => {
		const input = ['## Background', '### History', 'Old tales of the forest.'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		// Background should include the sub-header in its raw content
		expect(variables!.background).toContain('### History');
		expect(variables!.background).toContain('Old tales of the forest.');
	});

	it('preserves indentation in raw content', () => {
		const input = ['## Background', '- item one', '  - nested item', '- item two'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		expect(variables!.background).toContain('- item one');
		expect(variables!.background).toContain('  - nested item');
		expect(variables!.background).toContain('- item two');
	});

	it('raw content excludes heading line of own section', () => {
		const input = ['## Background', 'Some text here.'].join('\n');

		const { variables } = feedAll([input]);

		expect(variables).not.toBeNull();
		// The heading line "## Background" should NOT be in the raw content
		expect(variables!.background).not.toContain('## Background');
		expect(variables!.background).toContain('Some text here.');
	});

	it('excludes subsection header name from Decision Context', () => {
		const input = [
			'Story text.',
			'',
			'## Game Data',
			'',
			'### Decision Context',
			'',
			'Choose your path carefully.',
			'',
			'### Decisions',
			'',
			'- Go left',
			'- Go right',
		].join('\n');

		const { variables } = feedAll([input]);

		expect(variables?.gameData).not.toBeNull();
		expect(variables?.gameData?.decisionContext).not.toContain('Decision Context');
		expect(variables?.gameData?.decisionContext).toContain('Choose your path carefully.');
	});
});
