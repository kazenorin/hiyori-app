import { createThinkingTagParser } from './thinking-tag-parser';
import { createMarkdownGameDataParser } from './markdown-game-data-parser';
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

const MARKDOWN_CODE_FENCE_REGEX = /[\s]*```(?:markdown|md)?\n([\s\S]*?)```/;

function stripMarkdownCodeFence(text: string): string {
	const match = text.match(MARKDOWN_CODE_FENCE_REGEX);
	return match ? match[1] : text.trim();
}

/**
 * Creates a nested parser that captures `# {heading}` section content to EOF,
 * strips the outer ```markdown code fence, then extracts game data.
 *
 * During feed, body deltas are accumulated locally (not emitted) because
 * code fence stripping requires the complete body. On flush, the full body
 * is stripped, fed through the game data parser, and the cleaned narrative
 * is emitted.
 */
function createRevisedNarrativeParser(heading: string, accumulatorKey: string, gameDataKey: string): StreamParser<Record<string, unknown>> {
	const headingParser = createHeadingSectionParser(heading, { accumulatorKey, captureToEnd: true });
	const gameDataParser = createMarkdownGameDataParser(gameDataKey);
	let rawBody = '';

	function captureBodyDelta(accumulator: Record<string, unknown>): void {
		const delta = accumulator[accumulatorKey] as string | undefined;
		if (delta) {
			rawBody += delta;
			accumulator[accumulatorKey] = null;
		}
	}

	return {
		feed(chunk: string, accumulator: Record<string, unknown>): string {
			const text = headingParser.feed(chunk, accumulator);
			captureBodyDelta(accumulator);
			return text;
		},

		flush(accumulator: Record<string, unknown>): string {
			const text = headingParser.flush(accumulator);
			captureBodyDelta(accumulator);

			if (rawBody) {
				const stripped = stripMarkdownCodeFence(rawBody);
				const feedResult = gameDataParser.feed(stripped, accumulator as Record<string, GameData | null>);
				const flushResult = gameDataParser.flush(accumulator as Record<string, GameData | null>);
				accumulator[accumulatorKey] = feedResult + flushResult;
			}

			return text;
		},
	};
}

/**
 * Combined parser chain: text → thinking → scratchpad → review_scratchpad → revised_narrative (with game-data) → game-data.
 * Extracts think tags first, hides scratchpad section, then heading-based review sections,
 * then revised narrative with embedded game data, then top-level game data.
 */
export function createParserChain(): ParserChain {
	const thinkingParser = createThinkingTagParser();
	const scratchpadParser = createHeadingSectionParser('Scratchpad');
	const reviewScratchpadParser = createHeadingSectionParser('Review Scratchpad', 'review_scratchpad');
	const revisedNarrativeParser = createRevisedNarrativeParser('Revised Narrative', 'revised_narrative', 'revisedGameData');
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
