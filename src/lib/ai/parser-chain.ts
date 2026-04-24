import { createThinkingTagParser } from './thinking-tag-parser';
import { createMarkdownGameDataParser } from './markdown-game-data-parser';
import { createXmlTagParser } from './xml-tag-parser';
import { createNestedParser } from './nested-parser';
import { createHeadingSectionParser } from './heading-section-parser';
import type { GameData } from '$lib/db/messages';
import type { StreamParser } from './stream-parser';

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	gameData: GameData | null;
	reviewScratchpad: string | null;
	revisedNarrative: string | null;
	revisedGameData: GameData | null;
}

export function hasContent(output: ParserChainOutput) {
	return output.text || output.thinking || output.gameData || output.reviewScratchpad || output.revisedNarrative || output.revisedGameData;
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
}

/**
 * Combined parser chain: text → thinking → scratchpad → review_scratchpad → revised_narrative (with game-data) → game-data.
 * Extracts think tags first, then hides scratchpad section, then XML review tags,
 * then revised narrative with embedded game data, then top-level game data.
 */
export function createParserChain(): ParserChain {
	const thinkingParser = createThinkingTagParser();
	const scratchpadParser = createHeadingSectionParser('Scratchpad');
	const reviewScratchpadParser = createXmlTagParser('review_scratchpad');
	const revisedNarrativeParser = createNestedParser(
		'revised_narrative',
		createXmlTagParser('revised_narrative'),
		createMarkdownGameDataParser('revisedGameData')
	);
	const gameDataParser = createMarkdownGameDataParser('gameData');

	const parserChain = [thinkingParser, scratchpadParser, reviewScratchpadParser, revisedNarrativeParser, gameDataParser];

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
