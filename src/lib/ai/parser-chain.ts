import { createThinkingTagParser } from './thinking-tag-parser';
import { createSaxSectionParser } from './sax-section-parser';
import type { GameData } from '$lib/db/messages';
import type { StreamParser } from './stream-parser';

export interface NarrativeSections {
	storyTitle: string | null;
	actNumber: string | null;
	sessionNumber: string | null;
	sceneNumber: string | null;
	sceneTitle: string | null;
	background: string | null;
	narrativeBody: string | null;
	cg: string | null;
	currentContext: string | null;
	activePlotThreads: string | null;
	decisionContext: string | null;
}

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	gameData: GameData | null;
	reviewScratchpad: string | null;
	revisedNarrative: string | null;
	revisedGameData: GameData | null;
	sections: NarrativeSections | null;
}

export function hasContent(output: ParserChainOutput) {
	return (
		output.text ||
		output.thinking ||
		output.gameData ||
		output.reviewScratchpad ||
		output.revisedNarrative ||
		output.revisedGameData ||
		output.sections
	);
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
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

	const SECTION_FIELDS: (keyof NarrativeSections)[] = [
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

	function extractSectionsFromAcc(acc: Record<string, unknown>): NarrativeSections | null {
		let hasAny = false;
		const sections: NarrativeSections = {
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
		};
		for (const field of SECTION_FIELDS) {
			const accKey = 'section_' + field;
			const value = acc[accKey];
			if (typeof value === 'string' && value.length > 0) {
				sections[field] = value;
				hasAny = true;
			}
		}
		return hasAny ? sections : null;
	}

	function runChain(initialText: string, mode: 'feed' | 'flush'): ParserChainOutput {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acc: any = {
			thinking: null,
			gameData: null,
			revisedGameData: null,
			review_scratchpad: null,
			revised_narrative: null,
		};

		const text = mode === 'feed' ? parserChain.reduce((t, parser) => parser.feed(t, acc), initialText) : runFlush(parserChain, acc);

		return {
			text: text || null,
			thinking: acc.thinking as string | null,
			gameData: acc.gameData as GameData | null,
			reviewScratchpad: acc.review_scratchpad as string | null,
			revisedNarrative: acc.revised_narrative as string | null,
			revisedGameData: acc.revisedGameData as GameData | null,
			sections: extractSectionsFromAcc(acc),
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
