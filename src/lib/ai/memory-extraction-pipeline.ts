import { generateText } from 'ai';
import { createModel } from './provider';
import { getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
import { loadMemoryExtractionSystemPrompt, loadMemoryExtractionPrompt } from '$lib/fs/prompts';
import { parseMemoryExtract, type ExtractedMemories } from '$lib/memory/memory-extract-parser';
import { Memory } from '$lib/memory/memory';
import { isAuthError, sleep } from '$lib/utils/async';
import { log } from '$lib/logging/logger';

export interface PipelineResult {
	charactersProcessed: number;
	memoriesAdded: number;
	locationsAdded: number;
	errors: string[];
}

const RETRY_COUNT = 3;
const BACKOFF_SECONDS = 2;

export async function runMemoryExtractionPipeline(
	assistantResponse: string,
	storyId: string,
	actLineId: string
): Promise<PipelineResult> {
	const config = getMemoryProviderConfig();
	if (!config) {
		throw new Error('Memory provider not configured');
	}

	// Step 1: Generate memories via LLM
	const generatedText = await generateMemoriesWithRetry(assistantResponse, config);

	// Step 2: Parse into structured object
	const extracted = parseMemoryExtract(generatedText);

	// Step 3: Persist each character/location
	return await persistMemoriesWithRetry(extracted, storyId, actLineId, config);
}

async function generateMemoriesWithRetry(response: string, config: NonNullable<ReturnType<typeof getMemoryProviderConfig>>): Promise<string> {
	const model = createModel(config);
	const systemPrompt = await loadMemoryExtractionSystemPrompt();
	const extractionPromptTemplate = await loadMemoryExtractionPrompt();
	const userPrompt = extractionPromptTemplate + '\n' + response;

	for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
		try {
			const result = await generateText({
				model,
				system: systemPrompt,
				prompt: userPrompt
			});
			return result.text;
		} catch (err) {
			if (isAuthError(err instanceof Error ? err : new Error(String(err)))) {
				throw new Error('Authentication failed. Please check your API key in Settings.');
			}
			if (attempt < RETRY_COUNT) {
				await log.warn('memory-pipeline', `Memory generation attempt ${attempt + 1} failed, retrying...`);
				await sleep(BACKOFF_SECONDS * 1000 * (attempt + 1));
			}
		}
	}
	throw new Error('Memory generation failed after retries');
}

async function persistMemoriesWithRetry(
	extracted: ExtractedMemories,
	storyId: string,
	actLineId: string,
	config: NonNullable<ReturnType<typeof getMemoryProviderConfig>>
): Promise<PipelineResult> {
	const memory = new Memory(config);
	const result: PipelineResult = {
		charactersProcessed: 0,
		memoriesAdded: 0,
		locationsAdded: 0,
		errors: []
	};

	for (const [character, locations] of Object.entries(extracted)) {
		// Per-character retry scope
		for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
			try {
				for (const [location, memories] of Object.entries(locations)) {
					await memory.add(storyId, actLineId, character, location, memories);
					await memory.addLocation(storyId, actLineId, location);
					result.memoriesAdded += memories.length;
					result.locationsAdded += 1;
				}
				result.charactersProcessed += 1;
				break; // Success, exit retry loop
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				if (attempt < RETRY_COUNT) {
					await log.warn('memory-pipeline', `Persisting memories for ${character} attempt ${attempt + 1} failed, retrying...`);
					await sleep(BACKOFF_SECONDS * 1000 * (attempt + 1));
				} else {
					result.errors.push(`Character ${character}: ${msg}`);
					await log.error('memory-pipeline', `Failed to persist memories for ${character}`, err);
				}
			}
		}
	}

	return result;
}
