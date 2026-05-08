import { parseContent } from '$lib/chat-stream-parser';
import type { OutputDescriptor } from '$lib/chat-stream-parser/types';
import { createThinkingTagParser } from './thinking-tag-parser';
import type { NarrativeVariables, GameDataFields } from './narrative-types';
import { NARRATIVE_DESCRIPTORS } from './descriptors';
import type { ParserChainOutput } from './parser-chain';

const THROTTLE_MS = 150;
const MIN_NEW_CHARS = 50;

/**
 * Map flat parseContent result to NarrativeVariables.
 * Scene fields come from SCENE_DESCRIPTORS (outputPath: 'sceneTitle', etc).
 * Game data fields come from GAME_DATA_DESCRIPTORS (outputPath: 'activePlotThreads', etc).
 */
function assembleVariables(result: Record<string, unknown>): NarrativeVariables {
	return {
		sceneTitle: (result.sceneTitle as string) ?? null,
		background: (result.background as string) ?? null,
		narrativeBody: (result.narrativeBody as string) ?? null,
		cg: (result.cg as string) ?? null,
		gameData: assembleGameData(result),
	};
}

function assembleGameData(result: Record<string, unknown>): GameDataFields | null {
	const threads = result.activePlotThreads as string[] | undefined;
	const context = result.decisionContext as string | undefined;
	const decisions = result.decisions as string[] | undefined;
	const hasAny = (threads && threads.length > 0) || context || (decisions && decisions.length > 0);
	if (!hasAny) return null;
	return {
		activePlotThreads: threads ?? [],
		decisionContext: context ?? null,
		decisions: decisions ?? [],
	};
}

function hasFields(vars: NarrativeVariables): boolean {
	return vars.sceneTitle !== null || vars.background !== null || vars.narrativeBody !== null || vars.cg !== null || vars.gameData !== null;
}

/**
 * Streaming parser that wraps ThinkingTagParser with throttled chat-stream-parser.
 *
 * Accumulates post-thinking-tag text and calls parseContent() when:
 * 1. THROTTLE_MS elapsed since last parse AND MIN_NEW_CHARS accumulated since last parse
 * 2. A new ## header boundary is detected (immediate re-parse)
 * 3. flush() is called (stream end)
 *
 * Each parseContent() call produces complete field values, so variables replace
 * (not merge) the previous state.
 */
export function createNarrativeStreamParser(descriptors: OutputDescriptor[] = NARRATIVE_DESCRIPTORS) {
	const thinkingParser = createThinkingTagParser();
	let accumulatedContent = '';
	let thinking: string | null = null;
	let lastParseTime = 0;
	let lastParseContentLength = 0;
	let latestVariables: NarrativeVariables | null = null;

	function detectSectionBoundary(oldContent: string, newContent: string): boolean {
		const oldHeaders = (oldContent.match(/^##\s+/gm) ?? []).length;
		const newHeaders = (newContent.match(/^##\s+/gm) ?? []).length;
		return newHeaders > oldHeaders;
	}

	function shouldParse(newContentLength: number, isBoundary: boolean): boolean {
		if (isBoundary) return true;
		if (descriptors.length === 0) return false;
		const now = Date.now();
		const newChars = newContentLength - lastParseContentLength;
		return now - lastParseTime >= THROTTLE_MS && newChars >= MIN_NEW_CHARS;
	}

	function doParse(): NarrativeVariables | null {
		if (!accumulatedContent.trim()) return null;
		if (descriptors.length === 0) return null;

		const result = parseContent<Record<string, unknown>>(accumulatedContent, descriptors, {});
		const vars = assembleVariables(result);
		lastParseTime = Date.now();
		lastParseContentLength = accumulatedContent.length;
		return hasFields(vars) ? vars : null;
	}

	function feed(chunk: string): ParserChainOutput {
		const thinkingAcc: { thinking: string | null } = { thinking: null };
		const nonThinkingText = thinkingParser.feed(chunk, thinkingAcc);

		if (thinkingAcc.thinking) {
			thinking = thinking ? thinking + thinkingAcc.thinking : thinkingAcc.thinking;
		}

		if (nonThinkingText) {
			const oldContent = accumulatedContent;
			accumulatedContent += nonThinkingText;
			const isBoundary = detectSectionBoundary(oldContent, accumulatedContent);

			if (shouldParse(accumulatedContent.length, isBoundary)) {
				const vars = doParse();
				if (vars) latestVariables = vars;
			}
		}

		const hasText = nonThinkingText.length > 0;
		const hasThinking = thinkingAcc.thinking !== null;
		const hasVariables = latestVariables !== null;

		return {
			text: hasText ? nonThinkingText : null,
			thinking: hasThinking ? thinkingAcc.thinking : null,
			variables: hasVariables ? latestVariables : null,
			finalizedFields: new Set<string>(),
		};
	}

	function flush(): ParserChainOutput {
		const thinkingAcc: { thinking: string | null } = { thinking: null };
		const remainingText = thinkingParser.flush(thinkingAcc);

		if (thinkingAcc.thinking) {
			thinking = thinking ? thinking + thinkingAcc.thinking : thinkingAcc.thinking;
		}

		if (remainingText) {
			accumulatedContent += remainingText;
		}

		// Always do a final parse on flush
		const vars = doParse();
		if (vars) latestVariables = vars;

		return {
			text: remainingText || null,
			thinking: thinkingAcc.thinking,
			variables: latestVariables,
			finalizedFields: new Set<string>(),
		};
	}

	return { feed, flush };
}
