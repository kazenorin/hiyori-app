import { createThinkingTagParser } from './thinking-tag-parser';
import { createSaxSectionParser } from './sax-section-parser';
import type { StreamParser, ParserAccumulator } from './stream-parser';

// --- Types ---

/** Structured game data extracted from ## Game Data section */
export interface GameDataFields {
	worldState: string | null;
	decisions: string[]; // parsed from list items (ordered/unordered)
	playerAliases: string[]; // parsed from list items
	otherCharacterAliases: Record<string, string[]>; // character name → aliases
}

/** All narrative variables with proper types per field */
export interface NarrativeVariables {
	scratchpad: string | null;
	storyTitle: string | null;
	actNumber: number | null;
	sessionNumber: number | null;
	sceneNumber: number | null;
	sceneTitle: string | null;
	background: string | null;
	narrativeBody: string | null;
	cg: string | null;
	currentContext: string | null;
	activePlotThreads: string | null;
	decisionContext: string | null;
	gameData: GameDataFields | null;
}

// --- Field lists ---

/** Canonical list of all NarrativeVariables keys (excluding gameData). */
export const NARRATIVE_VARIABLE_FIELDS: (keyof NarrativeVariables)[] = [
	'scratchpad',
	'storyTitle',
	'actNumber',
	'sessionNumber',
	'sceneNumber',
	'sceneTitle',
	'background',
	'narrativeBody',
	'cg',
	'currentContext',
	'activePlotThreads',
	'decisionContext',
];

/** Number fields that need parseInt conversion from accumulated text. */
export const NUMBER_FIELDS: ReadonlySet<keyof NarrativeVariables> = new Set(['actNumber', 'sessionNumber', 'sceneNumber']);

// --- Helpers ---

/** Type-safe setter for NarrativeVariables fields, bypassing the index signature constraint. */
export function setField(obj: NarrativeVariables, key: keyof NarrativeVariables, value: string | number): void {
	(obj as unknown as Record<string, unknown>)[key] = value;
}

/** Create an empty GameDataFields. */
export function emptyGameDataFields(): GameDataFields {
	return {
		worldState: null,
		decisions: [],
		playerAliases: [],
		otherCharacterAliases: {},
	};
}

/** Create a NarrativeVariables with all fields set to null/empty. */
export function emptyVariables(): NarrativeVariables {
	return {
		scratchpad: null,
		storyTitle: null,
		actNumber: null,
		sessionNumber: null,
		sceneNumber: null,
		sceneTitle: null,
		background: null,
		narrativeBody: null,
		cg: null,
		currentContext: null,
		activePlotThreads: null,
		decisionContext: null,
		gameData: null,
	};
}

// --- Parser chain ---

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	variables: NarrativeVariables | null;
}

export function hasContent(output: ParserChainOutput): boolean {
	return !!(output.text || output.thinking || output.variables);
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
}

/**
 * Extract NarrativeVariables from the raw accumulator.
 * Number fields are parsed from text via parseInt; gameData is taken directly.
 */
function extractVariables(acc: Record<string, unknown>): NarrativeVariables | null {
	const vars = emptyVariables();
	let hasAny = false;

	for (const field of NARRATIVE_VARIABLE_FIELDS) {
		const value = acc[field];
		if (typeof value === 'string' && value.length > 0) {
			if (NUMBER_FIELDS.has(field)) {
				const parsed = parseInt(value, 10);
				if (!isNaN(parsed)) {
					setField(vars, field, parsed);
				}
			} else {
				setField(vars, field, value);
			}
			hasAny = true;
		}
	}

	// GameDataFields from GameDataAccumulator
	if (acc.gameData && typeof acc.gameData === 'object') {
		vars.gameData = acc.gameData as GameDataFields;
		hasAny = true;
	}

	return hasAny ? vars : null;
}

/**
 * Combined parser chain: thinking → sax-section.
 * ThinkingTagParser strips <think/> blocks first, then the SAX-based
 * section parser handles all structural Markdown detection, section
 * routing, and game data extraction.
 */
export function createParserChain(): ParserChain {
	const thinkingParser = createThinkingTagParser();
	const saxSectionParser = createSaxSectionParser();

	const parserChain = [thinkingParser, saxSectionParser];

	function runChain(initialText: string, mode: 'feed' | 'flush'): ParserChainOutput {
		const acc: Record<string, unknown> & { thinking: string | null } = {
			thinking: null,
		};

		const text =
			mode === 'feed'
				? parserChain.reduce((t, parser) => parser.feed(t, acc as ParserAccumulator<typeof acc>), initialText)
				: runFlush(parserChain, acc as ParserAccumulator<typeof acc>);

		return {
			text: text || null,
			thinking: (acc.thinking as string | null) ?? null,
			variables: extractVariables(acc),
		};
	}

	return {
		feed(chunk: string): ParserChainOutput {
			return runChain(chunk, 'feed');
		},

		flush(): ParserChainOutput {
			return runChain('', 'flush');
		},
	};
}

function runFlush(parserChain: StreamParser<Record<string, unknown>>[], acc: Record<string, unknown>): string {
	const [first, ...rest] = parserChain;
	let text = first.flush(acc);

	text = rest.reduce((t: string, parser: StreamParser<Record<string, unknown>>) => parser.feed(t, acc), text);

	for (const parser of rest) {
		const flushed = parser.flush(acc);
		if (flushed) text += flushed;
	}

	return text;
}
