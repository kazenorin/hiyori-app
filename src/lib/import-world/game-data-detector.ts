// Two-pass game data detection pipeline
// Pass 1: Traditional extraction from markdown headers/keywords
// Pass 2: LLM-based extraction for remaining messages

import type { Message, GameData } from '$lib/db/messages';
import type { GameDataDetectionResult, GameDataExtractionResult, RetryConfig } from './types';
import { generateText } from 'ai';
import { createModel } from '$lib/ai/provider';
import { getMainProviderConfig } from '$lib/stores/settings.svelte';
import { loadSystemPrompt } from '$lib/fs/prompts';
import { sleep } from '$lib/utils/async';

// === Pass 1: Traditional Extraction (Synchronous) ===

/**
 * Extract game data from message content by detecting markdown headers
 * containing decision-related keywords and parsing list items below them.
 */
export function extractGameDataTraditional(content: string): GameData | null {
	// Split on one or more leading # characters (markdown headers)
	const sections = content.split(/^(?=#{1,6}\s)/m);

	for (const section of sections) {
		const lines = section.split('\n');
		if (lines.length === 0) continue;

		// Check if header matches decision keywords
		const header = lines[0].toLowerCase();
		if (!isDecisionHeader(header)) continue;

		// Extract text between header and first list item
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
				// Text between header and first list item → worldState
				worldState += (worldState ? ' ' : '') + trimmed;
			}
		}

		// Need at least 2 decisions to be valid
		if (decisions.length >= 2) {
			return {
				worldState: worldState.trim(),
				decisions
			};
		}
	}

	return null;
}

/**
 * Check if a header line contains decision-related keywords.
 */
function isDecisionHeader(header: string): boolean {
	// Match keywords: decision, decisions, choice, choices, option, options
	// Also match pattern: what ... do?
	const keywords = ['decision', 'decisions', 'choice', 'choices', 'option', 'options'];
	const strippedHeader = header.replace(/^#+\s*/, '');

	for (const keyword of keywords) {
		if (strippedHeader.includes(keyword)) return true;
	}

	// Match "what ... do?" pattern
	if (/what.+do\?/.test(strippedHeader)) return true;

	return false;
}

/**
 * Check if a trimmed line is a list item (bullet, dash, or numbered).
 */
function isListItem(trimmed: string): boolean {
	// Bullet list: starts with * or -
	if (/^[*-]\s/.test(trimmed)) return true;
	// Numbered list: starts with digit followed by . or )
	if (/^\d+[.)]\s/.test(trimmed)) return true;
	return false;
}

/**
 * Clean a list item line by removing markdown formatting and preserving content.
 */
function cleanListItem(line: string): string {
	let cleaned = line;

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
	messages: Message[],
	indicesNeedingExtraction: number[],
	retryConfig: RetryConfig,
	choicesExtractionPrompt: string
): Promise<GameDataExtractionResult[]> {
	const config = getMainProviderConfig();
	if (!config?.apiKey) {
		return [];
	}

	const systemPrompt = await loadSystemPrompt();
	const model = createModel(config);
	const results: GameDataExtractionResult[] = [];

	for (const msgIndex of indicesNeedingExtraction) {
		const msg = messages[msgIndex];
		if (!msg || msg.role !== 'assistant') continue;

		const gameData = await retryLLMCall(
			model,
			systemPrompt,
			msg.content,
			choicesExtractionPrompt,
			retryConfig
		);

		results.push({
			messageIndex: msgIndex,
			gameData,
			source: gameData ? 'llm' : 'none'
		});

		// Rate limit: small delay between LLM calls to avoid hitting API rate limits
		if (indicesNeedingExtraction.indexOf(msgIndex) < indicesNeedingExtraction.length - 1) {
			await sleep(100);
		}
	}

	return results;
}

async function retryLLMCall(
	model: ReturnType<typeof createModel>,
	systemPrompt: string,
	messageContent: string,
	choicesExtractionPrompt: string,
	retryConfig: RetryConfig
): Promise<GameData | null> {
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= retryConfig.retryCount; attempt++) {
		try {
			const result = await generateText({
				model,
				system: systemPrompt,
				messages: [
					{ role: 'assistant', content: messageContent },
					{ role: 'user', content: choicesExtractionPrompt }
				]
			});

			return parseLLMGameData(result.text);
		} catch (e) {
			lastError = e instanceof Error ? e : new Error(String(e));

			if (attempt < retryConfig.retryCount) {
				await sleep(retryConfig.backoffIntervalSeconds * 1000 * (attempt + 1));
			}
		}
	}

	return null;
}

/**
 * Parse LLM response text to extract GameData JSON.
 */
function parseLLMGameData(text: string): GameData | null {
	// Try to extract JSON from the response
	// Look for ```json blocks first
	const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
	if (jsonBlockMatch) {
		return parseGameDataObject(jsonBlockMatch[1]);
	}

	// Try to find raw JSON object in the text
	const jsonObjectMatch = text.match(/\{[\s\S]*"worldState"[\s\S]*"decisions"[\s\S]*\}/);
	if (jsonObjectMatch) {
		return parseGameDataObject(jsonObjectMatch[0]);
	}

	return null;
}

function parseGameDataObject(json: string): GameData | null {
	try {
		const parsed = JSON.parse(json);
		if (
			parsed &&
			typeof parsed === 'object' &&
			typeof parsed.worldState === 'string' &&
			Array.isArray(parsed.decisions) &&
			parsed.decisions.every((d: unknown) => typeof d === 'string')
		) {
			return {
				worldState: parsed.worldState,
				decisions: parsed.decisions
			};
		}
		return null;
	} catch {
		return null;
	}
}

// === Full Pipeline ===

/**
 * Run the complete game data detection pipeline on an array of messages.
 * Pass 1 runs synchronously, Pass 2 uses LLM for remaining messages.
 * Returns a combined result with all extractions.
 */
export async function runGameDataDetection(
	messages: Message[],
	retryConfig: RetryConfig,
	choicesExtractionPrompt: string
): Promise<GameDataDetectionResult> {
	const results: GameDataExtractionResult[] = [];
	const indicesNeedingLLM: number[] = [];

	// Pass 1: Traditional extraction
	for (let i = 0; i < messages.length; i++) {
		const msg = messages[i];

		// Skip non-assistant messages and messages that already have game_data
		if (msg.role !== 'assistant' || msg.gameData) {
			if (msg.gameData) {
				results.push({
					messageIndex: i,
					gameData: msg.gameData,
					source: 'traditional'
				});
			}
			continue;
		}

		const gameData = extractGameDataTraditional(msg.content);
		if (gameData) {
			results.push({
				messageIndex: i,
				gameData,
				source: 'traditional'
			});
		} else {
			indicesNeedingLLM.push(i);
		}
	}

	// Pass 2: LLM extraction for messages still missing game_data
	let llmCallsMade = 0;
	if (indicesNeedingLLM.length > 0) {
		const llmResults = await extractGameDataWithLLM(
			messages,
			indicesNeedingLLM,
			retryConfig,
			choicesExtractionPrompt
		);
		results.push(...llmResults);
		llmCallsMade = llmResults.filter((r) => r.source === 'llm').length;
	}

	return {
		results: results.sort((a, b) => a.messageIndex - b.messageIndex),
		llmCallsMade
	};
}
