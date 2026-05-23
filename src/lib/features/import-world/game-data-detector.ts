// Two-pass game data detection pipeline
// Pass 1: Traditional extraction from markdown headers/keywords
// Pass 2: LLM-based extraction using pipeline GM phase + template fitter

import type { GameDataFields } from '$lib/ai/narrative-types';
import type { GameDataDetectionResult, GameDataExtractionResult, GameDataImportContext, ParsedMessage } from './types';
import { buildMetadata, type RetryConfig } from '$lib/ai/chat-stream';
import { sleep } from '$lib/utils/async';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { executeGmPhase, runGmTemplateFitter, type PipelineRunContext, type TrackPhase } from '$lib/ai/pipeline/runners';
import type { PostEditorContext } from '$lib/ai/pipeline/message-builder';
import type { PipelineCallbacks, PipelineState } from '$lib/ai/pipeline/types';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import { gameMasterSystemPromptLoader } from '$lib/fs/prompts';
import { buildImportRunContext } from './pipeline-context';

// === Pass 1: Traditional Extraction (Synchronous) ===

/**
 * Extract game data from message content by detecting decision markers.
 * Supports two marker patterns:
 *   1. Markdown headers with decision keywords (## Decision, ### Choices, etc.)
 *   2. Bold bracket markers (**[DECISION POINT]**, **[CHOICES]**, etc.)
 * Supports list items in plain and blockquote form (> 1., > *, etc.)
 */
export function extractGameDataTraditional(content: string): GameDataFields | null {
	// Split on markdown headers OR bold bracket markers containing decision keywords
	// Pattern 1: #{1,6} headers
	// Pattern 2: **[...]** where brackets contain decision keywords
	const sections = content.split(/^(?=(?:#{1,6}\s|\*\*\[.*?(?:decision|choice|option).*?\]\*\*))/im);

	for (const section of sections) {
		const lines = section.split('\n');
		if (lines.length === 0) continue;

		const header = lines[0];
		if (!isDecisionHeader(header)) continue;

		// Extract text between header and first list item → worldState
		let worldState = '';
		const decisions: string[] = [];
		let foundFirstListItem = false;

		for (let i = 1; i < lines.length; i++) {
			const line = lines[i];
			const trimmed = line.trim();

			if (!trimmed) continue;

			if (isListItem(trimmed)) {
				foundFirstListItem = true;
				const cleaned = cleanListItem(trimmed);
				if (cleaned) {
					decisions.push(cleaned);
				}
			} else if (!foundFirstListItem) {
				worldState += (worldState ? ' ' : '') + trimmed;
			}
		}

		// Need at least 2 decisions to be valid
		if (decisions.length >= 2) {
			return {
				activePlotThreads: [],
				decisionContext: worldState.trim() || null,
				decisions,
			};
		}
	}

	return null;
}

/**
 * Check if a header line contains decision-related keywords.
 * Handles:
 *   - Markdown headers: ## Decision, ### Choices, etc.
 *   - Bold bracket markers: **[DECISION POINT]**, **[CHOICES]**, etc.
 */
function isDecisionHeader(header: string): boolean {
	// Strip common prefix markers for detection
	// Keep the content inside **bold** or just the raw text
	const keywords = ['decision', 'decisions', 'choice', 'choices', 'option', 'options'];

	// For "**[DECISION POINT]**" style headers, extract content between **[ and ]**
	const bracketMatch = header.match(/^\**\[(.+?)\]\*\*|^(.+)$/i);
	const content = bracketMatch ? (bracketMatch[1] ?? bracketMatch[2] ?? '') : header;

	// Check stripped content for keywords
	const lowerContent = content.toLowerCase();
	for (const keyword of keywords) {
		if (lowerContent.includes(keyword)) return true;
	}

	// Match "what ... do?" pattern
	return /what.+do\?/i.test(lowerContent);
}

/**
 * Check if a trimmed line is a list item.
 * Supports:
 *   - Bullet lists: *, -
 *   - Numbered lists: 1., 2)
 *   - Blockquote prefixed: > 1., > *, > -
 */
function isListItem(trimmed: string): boolean {
	// Remove leading blockquote marker if present
	const withoutQuote = trimmed.replace(/^>\s*/, '');

	// Bullet list: starts with * or -
	if (/^[*-]\s/.test(withoutQuote)) return true;
	// Numbered list: starts with digit followed by . or )
	return /^\d+[.)]\s/.test(withoutQuote);
}

/**
 * Clean a list item line by removing markdown formatting and preserving content.
 * Handles blockquote prefixed items (> 1., > *, etc.)
 */
function cleanListItem(line: string): string {
	let cleaned = line;

	// Remove leading blockquote marker
	cleaned = cleaned.replace(/^>\s*/, '');

	// Remove list marker and leading whitespace
	cleaned = cleaned.replace(/^[*-]\s+/, '');
	cleaned = cleaned.replace(/^\d+[.)]\s+/, '');

	// Trim surrounding markdown formatting characters
	cleaned = cleaned.trim();
	cleaned = cleanMarkdownFormatting(cleaned);

	return cleaned;
}

/**
 * Strip markdown formatting from text: bold (**), italic (*), code (`),
 * brackets, braces, parens, quotes.
 */
function cleanMarkdownFormatting(text: string): string {
	let cleaned = text;

	// Remove bold markers (**text** or __text__)
	cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
	cleaned = cleaned.replace(/__(.+?)__/g, '$1');

	// Remove italic markers (*text* or _text_)
	cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
	cleaned = cleaned.replace(/_(.+?)_/g, '$1');

	// Remove inline code markers (`text`)
	cleaned = cleaned.replace(/`(.+?)`/g, '$1');

	// Trim surrounding punctuation: {, [, (, ", ', ), ], }
	cleaned = cleaned.replace(/^[{[("']+/, '');
	cleaned = cleaned.replace(/[)\]"'}]+$/, '');

	return cleaned.trim();
}

// === Pass 2: LLM Extraction via Pipeline GM Phase ===

function buildImportPipelineCallbacks(
	msgIndex: number,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void
): PipelineCallbacks {
	return {
		onPhaseStart: () => {},
		onPhaseStream: (_phase, streamState) => {
			onProgress(msgIndex, streamState);
		},
		onPhaseRetry: (_phase, attempt, maxAttempts) => {
			onError(msgIndex, new Error(`GM phase retry ${attempt}/${maxAttempts}`), attempt);
		},
		onPhaseComplete: () => {},
		onError: (_phase, error) => {
			const err = error instanceof Error ? error : new Error(String(error));
			onError(msgIndex, err, 0);
		},
		onAllComplete: () => {},
	};
}

function buildImportPipelineRunContext(
	retryConfig: RetryConfig,
	abortSignal: AbortSignal,
	callbacks: PipelineCallbacks,
	gmSystemPrompt: string
): PipelineRunContext {
	return buildImportRunContext(retryConfig, abortSignal, callbacks, { gameMasterSystemPrompt: gmSystemPrompt });
}

function buildImportPostEditorContext(msgContent: string, importCtx: GameDataImportContext): PostEditorContext {
	return {
		actPlot: importCtx.actCard.content, // strictly speaking act cards are act summaries, but actSummary is optional, while act plots are not
		actPhase: undefined,
		actSummary: '',
		previousScenePlot: undefined,
		previousNarrativeBody: undefined,
		completedScenes: 0,
		player: undefined,
		previousTurnOfEvents: undefined,
		editorOutput: msgContent,
		directorNotes: '',
	};
}

/**
 * Use pipeline GM phase + template fitter to extract game data for messages
 * that lack it after Pass 1. Uses the same production-grade extraction logic
 * as the live narrative pipeline.
 */
export async function extractGameDataWithLLM(
	messages: ParsedMessage[],
	indicesNeedingExtraction: number[],
	retryConfig: RetryConfig,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void,
	importCtx: GameDataImportContext
): Promise<GameDataExtractionResult[]> {
	const providerConfigs = buildPipelineProviderConfigs();
	const gmSystemPrompt = await gameMasterSystemPromptLoader.loadDefault();
	const results: GameDataExtractionResult[] = [];

	for (let i = 0; i < indicesNeedingExtraction.length; i++) {
		const msgIndex = indicesNeedingExtraction[i];
		const msg = messages[msgIndex];
		if (!msg || msg.role !== 'assistant') continue;

		const abortController = new AbortController();
		const callbacks = buildImportPipelineCallbacks(msgIndex, onProgress, onError);
		const ctx = buildImportPipelineRunContext(retryConfig, abortController.signal, callbacks, gmSystemPrompt);

		const postEditorCtx = buildImportPostEditorContext(msg.content, importCtx);

		const trackPhase: TrackPhase = (_phaseName, result) => result.state;
		let state: PipelineState = { currentPhase: null };

		const gmResult = await executeGmPhase(ctx, state, postEditorCtx);
		state = trackPhase('GAME_MASTER', gmResult, providerConfigs.gameMaster?.model);

		state = await runGmTemplateFitter(ctx, state, trackPhase);

		const gameData = state.gameData ?? null;

		results.push({
			messageIndex: msgIndex,
			gameData,
			source: gameData ? 'llm' : 'none',
			metadata: JSON.stringify(buildMetadata(gmResult.metadata, providerConfigs.gameMaster?.model), null, 2),
		});

		if (i < indicesNeedingExtraction.length - 1) {
			await sleep(100);
		}
	}

	return results;
}

// === Full Pipeline ===

/**
 * Run the complete game data detection pipeline on parsed messages.
 * Pass 1 runs synchronously (markdown header parsing).
 * Pass 2 uses LLM for remaining messages (only if API key is configured).
 * Returns detection results and the number of LLM calls made.
 */
export async function runGameDataDetection(
	messages: ParsedMessage[],
	retryConfig: RetryConfig,
	log: (msg: string) => void,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void,
	importCtx: GameDataImportContext
): Promise<GameDataDetectionResult> {
	const results: GameDataExtractionResult[] = [];
	const indicesNeedingLLM: number[] = [];

	// Pass 1: Traditional extraction
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		// Skip non-assistant messages and messages that already have game_data
		if (message.role !== 'assistant' || message.variables?.gameData) {
			if (message.variables?.gameData) {
				results.push({
					messageIndex: i,
					gameData: message.variables.gameData,
					source: 'traditional',
				});
			}
			continue;
		}

		const gameData = extractGameDataTraditional(message.content);
		if (gameData) {
			results.push({
				messageIndex: i,
				gameData,
				source: 'traditional',
			});
			log(`Generated GameData[${i}] using traditional method.`);
		} else {
			indicesNeedingLLM.push(i);
		}
	}

	// Pass 2: LLM extraction for messages still missing game_data
	let llmCallsMade = 0;
	if (indicesNeedingLLM.length > 0) {
		const llmResults = await extractGameDataWithLLM(messages, indicesNeedingLLM, retryConfig, onProgress, onError, importCtx);

		results.push(...llmResults);
		llmCallsMade = llmResults.filter((r) => r.source === 'llm').length;
	}

	return {
		results: results.sort((a, b) => a.messageIndex - b.messageIndex),
		llmCallsMade,
	};
}
