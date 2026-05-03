import { createThinkingTagParser } from './thinking-tag-parser';
import { createSaxSectionParser } from './sax-section-parser';
import type { StreamParser, ParserAccumulator } from './stream-parser';

import type { NarrativeVariables, GameDataFields } from './narrative-types';
import { NARRATIVE_VARIABLE_FIELDS, setField, emptyVariables } from './narrative-types';

/** Key used on the accumulator to track finalized fields. Must match sax-section-parser. */
const FINALIZED_FIELDS_KEY = '__finalized';

// --- Parser chain ---

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	variables: NarrativeVariables | null;
	/** Field names whose values are finalized (raw content) and should replace rather than concatenate on merge. */
	finalizedFields: Set<string>;
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
 * String fields are taken directly; gameData is taken directly.
 */
function extractVariables(acc: Record<string, unknown>): { variables: NarrativeVariables | null; finalizedFields: Set<string> } {
	const vars = emptyVariables();
	let hasAny = false;

	for (const field of NARRATIVE_VARIABLE_FIELDS) {
		const value = acc[field];
		if (typeof value === 'string' && value.length > 0) {
			setField(vars, field, value);
			hasAny = true;
		}
	}

	// GameDataFields from GameDataAccumulator
	if (acc.gameData && typeof acc.gameData === 'object') {
		vars.gameData = acc.gameData as GameDataFields;
		hasAny = true;
	}

	const finalizedFields = (acc[FINALIZED_FIELDS_KEY] as Set<string> | undefined) ?? new Set<string>();
	return { variables: hasAny ? vars : null, finalizedFields };
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

		const { variables, finalizedFields } = extractVariables(acc);
		return {
			text: text || null,
			thinking: (acc.thinking as string | null) ?? null,
			variables,
			finalizedFields,
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
