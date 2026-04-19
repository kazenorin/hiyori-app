// Two-pass game data detection pipeline
// Pass 1: Traditional extraction from markdown headers/keywords
// Pass 2: LLM-based extraction for remaining messages

import type { GameData } from '$lib/db/messages';
import type { GameDataDetectionResult, GameDataExtractionResult, ParsedMessage } from './types';
import { buildMetadata, type RetryConfig, streamWithRetry } from '$lib/ai/chat-stream';
import {loadChoicesExtractionPrompt, loadStorySystemPrompt, loadSystemPrompt} from '$lib/fs/prompts';
import { sleep } from '$lib/utils/async';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { getMainProviderConfig, type ProviderConfig } from '$lib/stores/settings.svelte';
import {getActiveStory, getActiveSystemPromptOrDefault} from "$lib/stores/stories.svelte";

// === Pass 1: Traditional Extraction (Synchronous) ===

/**
 * Extract game data from message content by detecting decision markers.
 * Supports two marker patterns:
 *   1. Markdown headers with decision keywords (## Decision, ### Choices, etc.)
 *   2. Bold bracket markers (**[DECISION POINT]**, **[CHOICES]**, etc.)
 * Supports list items in plain and blockquote form (> 1., > *, etc.)
 */
export function extractGameDataTraditional(content: string): GameData | null {
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
				worldState: worldState.trim(),
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

// === Pass 2: LLM Extraction (Asynchronous) ===

/**
 * Use LLM to extract game data for messages that lack it after Pass 1.
 * Returns extraction results only for messages where game_data was extracted.
 */
export async function extractGameDataWithLLM(
	messages: ParsedMessage[],
	indicesNeedingExtraction: number[],
	retryConfig: RetryConfig,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void
): Promise<GameDataExtractionResult[]> {
	const providerConfig = getMainProviderConfig();
	const systemPrompt = await getActiveSystemPromptOrDefault();
	const choicesExtractionPrompt = await loadChoicesExtractionPrompt();
	const results: GameDataExtractionResult[] = [];

	for (let i = 0; i < indicesNeedingExtraction.length; i++) {
		const msgIndex = indicesNeedingExtraction[i];
		const msg = messages[msgIndex];
		if (!msg || msg.role !== 'assistant') continue;

		const acc = await streamWithRetry(
			systemPrompt,
			[
				{ role: 'user', content: choicesExtractionPrompt },
				{ role: 'user', content: msg.content },
			],
			retryConfig,
			(state) => {
				onProgress(msgIndex, state);
			},
			(err, attempt) => {
				onError(msgIndex, err, attempt);
			},
			providerConfig
		);

		const gameData = acc.state.gameData;
		const metadata = await acc.resultMetadata;

		results.push({
			messageIndex: msgIndex,
			gameData,
			source: gameData ? 'llm' : 'none',
			metadata: JSON.stringify(buildMetadata(metadata, providerConfig?.model), null, 2),
		});

		// Rate limit: small delay between LLM calls to avoid hitting API rate limits
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
	onError: (msgIndex: number, err: Error, attempt: number) => void
): Promise<GameDataDetectionResult> {
	const results: GameDataExtractionResult[] = [];
	const indicesNeedingLLM: number[] = [];

	// Pass 1: Traditional extraction
	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];

		// Skip non-assistant messages and messages that already have game_data
		if (message.role !== 'assistant' || message.gameData) {
			if (message.gameData) {
				results.push({
					messageIndex: i,
					gameData: message.gameData,
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
		const llmResults = await extractGameDataWithLLM(messages, indicesNeedingLLM, retryConfig, onProgress, onError);

		results.push(...llmResults);
		llmCallsMade = llmResults.filter((r) => r.source === 'llm').length;
	}

	return {
		results: results.sort((a, b) => a.messageIndex - b.messageIndex),
		llmCallsMade,
	};
}
