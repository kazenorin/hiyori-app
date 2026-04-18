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

	return {
		feed(chunk: string): ParserChainOutput {
			const { thinking, text } = thinkingParser.feed(chunk);

			const { extracted: reviewScratchpad, text: text2 } = reviewScratchpadParser.feed(text ?? '');
			const { extracted: revisedNarrative, text: text3 } = revisedNarrativeParser.feed(text2 ?? '');
			const { text: finalText, gameData } = gameDataParser.feed(text3 ?? '');

			return { text: finalText, thinking, gameData, reviewScratchpad, revisedNarrative };
			},

		flush(): ParserChainOutput {
			const thinkingFlushed = thinkingParser.flush();

			let text: string | null = null;
			let gameData: GameData | null = null;
			let reviewScratchpad: string | null = null;
			let revisedNarrative: string | null = null;

			// Process thinking flush through review_scratchpad parser
			if (thinkingFlushed.text) {
				const reviewOutput = reviewScratchpadParser.feed(thinkingFlushed.text);
				if (reviewOutput.extracted) reviewScratchpad = reviewOutput.extracted;

				// Process through revised_narrative parser
				if (reviewOutput.text) {
					const revisedOutput = revisedNarrativeParser.feed(reviewOutput.text);
					if (revisedOutput.extracted) revisedNarrative = revisedOutput.extracted;

					// Process through game-data parser
					if (revisedOutput.text) {
						const gameOutput = gameDataParser.feed(revisedOutput.text);
						if (gameOutput.text) text = gameOutput.text;
						if (gameOutput.gameData) gameData = gameOutput.gameData;
					}
				}
			}

			// Flush review_scratchpad parser
			const reviewFlushed = reviewScratchpadParser.flush();
			if (reviewFlushed.text) {
				text = (text ?? '') + reviewFlushed.text;
			}
			if (reviewFlushed.extracted) {
				reviewScratchpad = (reviewScratchpad ?? '') + reviewFlushed.extracted;
			}

			// Flush revised_narrative parser
			const revisedFlushed = revisedNarrativeParser.flush();
			if (revisedFlushed.text) {
				text = (text ?? '') + revisedFlushed.text;
			}
			if (revisedFlushed.extracted) {
				revisedNarrative = (revisedNarrative ?? '') + revisedFlushed.extracted;
			}

			// Flush game-data parser
			const flushed = gameDataParser.flush();
			if (flushed.text) {
				text = (text ?? '') + flushed.text;
			}
			if (flushed.gameData) {
				gameData = flushed.gameData;
			}

			return {
				text,
				thinking: thinkingFlushed.thinking,
				gameData,
				reviewScratchpad,
				revisedNarrative
			};
		}
	};
}
