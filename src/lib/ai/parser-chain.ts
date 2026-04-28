import { createThinkingTagParser } from './thinking-tag-parser';
import { createSaxSectionParser } from './sax-section-parser';
import type { StreamParser, ParserAccumulator } from './stream-parser';

// Re-export all types and helpers from narrative-types (single source of truth)
export type {
	NarrativeVariables,
	GameDataFields,
	FieldDescriptor,
} from './narrative-types';
export {
	FIELD_DESCRIPTORS,
	NARRATIVE_VARIABLE_FIELDS,
	NUMBER_FIELDS,
	setField,
	emptyGameDataFields,
	emptyVariables,
} from './narrative-types';

// Import for local use in extractVariables
import {
	NARRATIVE_VARIABLE_FIELDS,
	NUMBER_FIELDS,
	setField,
	emptyVariables,
} from './narrative-types';

// --- Parser chain ---

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	variables: import('./narrative-types').NarrativeVariables | null;
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
function extractVariables(acc: Record<string, unknown>): import('./narrative-types').NarrativeVariables | null {
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
		vars.gameData = acc.gameData as import('./narrative-types').GameDataFields;
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
