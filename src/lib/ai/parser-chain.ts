import { createThinkingTagParser } from './thinking-tag-parser';
import { createGameDataStreamParser } from './game-data-parser';
import type { GameData } from '$lib/db/messages';

export interface ParserChainOutput {
	text: string | null;
	thinking: string | null;
	gameData: GameData | null;
}

export interface ParserChain {
	feed(chunk: string): ParserChainOutput;
	flush(): ParserChainOutput;
}

/**
 * Combined parser chain: text → thinking parser → game-data parser.
 * Extracts <think...>...</think > tags first, then intercepts ```json game-data blocks.
 */
export function createParserChain(): ParserChain {
	const thinkingParser = createThinkingTagParser();
	const gameDataParser = createGameDataStreamParser();

	function processText(text: string): ParserChainOutput {
		const output = gameDataParser.feed(text);
		return {
			text: output.text,
			thinking: null,
			gameData: output.gameData
		};
	}

	return {
		feed(chunk: string): ParserChainOutput {
			const thinkingOutput = thinkingParser.feed(chunk);

			// Collect thinking if extracted
			const thinking = thinkingOutput.thinking;

			// Pass remaining text through game-data parser
			const textToProcess = thinkingOutput.text;
			if (textToProcess) {
				const gameOutput = gameDataParser.feed(textToProcess);
				return {
					text: gameOutput.text,
					thinking,
					gameData: gameOutput.gameData
				};
			}

			return { text: null, thinking, gameData: null };
		},

		flush(): ParserChainOutput {
			// Flush thinking parser first
			const thinkingFlushed = thinkingParser.flush();

			let text: string | null = null;
			let gameData: GameData | null = null;

			if (thinkingFlushed.text) {
				const output = gameDataParser.feed(thinkingFlushed.text);
				if (output.text) text = output.text;
				if (output.gameData) gameData = output.gameData;
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
				gameData
			};
		}
	};
}
