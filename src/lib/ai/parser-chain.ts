import { createThinkingTagParser } from './thinking-tag-parser';
import { createGameDataParser } from './game-data-parser';
import { createXmlTagParser } from './xml-tag-parser';
import type { GameData } from '$lib/db/messages';

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	gameData: GameData | null;
	reviewScratchpad: string | null;
	revisedNarrative: string | null;
}

export function hasContent(output: ParserChainOutput) {
	return output.text || output.thinking || output.gameData || output.reviewScratchpad || output.revisedNarrative;
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
}

/**
 * Combined parser chain: text → thinking parser → review_scratchpad → revised_narrative → game-data parser.
 * Extracts think tags first, then XML review tags, then intercepts ```json game-data blocks.
 */
export function createParserChain(): ParserChain {
	const thinkingParser = createThinkingTagParser();
	const reviewScratchpadParser = createXmlTagParser('review_scratchpad');
	const revisedNarrativeParser = createXmlTagParser('revised_narrative');
	const gameDataParser = createGameDataParser();

	const parserChain = [
		thinkingParser,
		reviewScratchpadParser,
		revisedNarrativeParser,
		gameDataParser
	];

	function runChain(initialText: string, mode: 'feed' | 'flush'): ParserChainOutput {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const acc: any = {
			thinking: null,
			gameData: null,
			review_scratchpad: null,
			revised_narrative: null,
		};

		let text = mode === 'feed'
			? parserChain.reduce((t, parser) => parser.feed(t, acc), initialText)
			: runFlush(parserChain, acc, initialText);

		return {
			text: text || null,
			thinking: acc.thinking as string | null,
			gameData: acc.gameData as GameData | null,
			reviewScratchpad: acc.review_scratchpad as string | null,
			revisedNarrative: acc.revised_narrative as string | null,
		};
	}

	return {
		feed(chunk: string): ParserChainOutput {
			return runChain(chunk, 'feed');
		},

		flush(): ParserChainOutput {
			return runChain('', 'flush');
		}
	};
}

function runFlush(parserChain: StreamParserFeed[], acc: any, _initial: string): string {
	const [first, ...rest] = parserChain;
	let text = first.flush(acc);

	text = rest.reduce((t, parser) => parser.feed(t, acc), text);

	for (const parser of rest) {
		const flushed = parser.flush(acc);
		if (flushed) text += flushed;
	}

	return text;
}

interface StreamParserFeed {
	feed(chunk: string, accumulator: any): string;
	flush(accumulator: any): string;
}
