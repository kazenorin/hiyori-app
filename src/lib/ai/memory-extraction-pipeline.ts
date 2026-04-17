import { generateText } from 'ai';
import { createModel } from './provider';
import { getMemoryProviderConfig, getEmbeddingProviderConfig, settings, type MemoryProviderConfig, type EmbeddingProviderConfig } from '$lib/stores/settings.svelte';
import { loadMemoryExtractionSystemPrompt, loadMemoryExtractionPrompt } from '$lib/fs/prompts';
import { parseMemoryExtract, type ExtractedMemories } from '$lib/memory/memory-extract-parser';
import { Memory } from '$lib/memory/memory';
import { isAuthError, withRetry, toError } from '$lib/utils/async';
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
	actLineId: string,
	messageId: string
): Promise<PipelineResult> {
	const llmConfig = getMemoryProviderConfig();
	if (!llmConfig) {
		throw new Error('Memory provider not configured');
	}

	const embeddingConfig = getEmbeddingProviderConfig();
	if (!embeddingConfig) {
		throw new Error('Embedding provider not configured');
	}

	// Step 1: Generate memories via LLM
	const generatedText = await generateMemoriesWithRetry(assistantResponse, llmConfig);

	// Step 2: Parse into structured object
	const extracted = parseMemoryExtract(generatedText);

	// Step 3: Persist each character/location (uses embedding provider)
	return await persistMemoriesWithRetry(extracted, storyId, actLineId, messageId, embeddingConfig);
}

async function generateMemoriesWithRetry(response: string, config: MemoryProviderConfig): Promise<string> {
	const model = createModel(config);
	const systemPrompt = await loadMemoryExtractionSystemPrompt();
	const extractionPromptTemplate = await loadMemoryExtractionPrompt();
	const userPrompt = extractionPromptTemplate + '\n' + response;

	return await withRetry(
		() => generateText({ model, system: systemPrompt, prompt: userPrompt }).then(r => r.text),
		{
			maxAttempts: RETRY_COUNT + 1,
			backoffMs: BACKOFF_SECONDS * 1000,
			shouldRetry: (err) => !isAuthError(err),
			onRetry: (attempt) => log.warn('memory-pipeline', `Memory generation attempt ${attempt} failed, retrying...`)
		}
	);
}

async function persistMemoriesWithRetry(
	extracted: ExtractedMemories,
	storyId: string,
	actLineId: string,
	messageId: string,
	config: EmbeddingProviderConfig
): Promise<PipelineResult> {
	const memory = new Memory(config);
	const result: PipelineResult = {
		charactersProcessed: 0,
		memoriesAdded: 0,
		locationsAdded: 0,
		errors: []
	};

	for (const [character, locations] of Object.entries(extracted)) {
		let characterSuccess = true;
		for (const [location, memories] of Object.entries(locations)) {
			// Per-location retry scope — avoids duplicating previously succeeded locations
			try {
				const { memoriesAdded, locationAdded } = await persistLocationWithRetry(memory, storyId, actLineId, messageId, character, location, memories);
				result.memoriesAdded += memoriesAdded;
				if (locationAdded) result.locationsAdded += 1;
			} catch (err) {
				const msg = toError(err).message;
				result.errors.push(`Character ${character}, Location "${location}": ${msg}`);
				await log.error('memory-pipeline', `Failed to persist memories for ${character} at "${location}"`, err);
				characterSuccess = false;
			}
		}
		if (characterSuccess) {
			result.charactersProcessed += 1;
		}
	}

	return result;
}

async function persistLocationWithRetry(
	memory: Memory,
	storyId: string,
	actLineId: string,
	messageId: string,
	character: string,
	location: string,
	memories: string[]
): Promise<{ memoriesAdded: number; locationAdded: boolean }> {
	let memoriesAdded = 0;
	let locationAdded = false;

	await withRetry(
		async () => {
			memoriesAdded = await memory.add(storyId, actLineId, messageId, character, location, memories);
			locationAdded = await memory.addLocation(storyId, actLineId, messageId, location);
		},
		{
			maxAttempts: RETRY_COUNT + 1,
			backoffMs: BACKOFF_SECONDS * 1000,
			onRetry: (attempt) => log.warn('memory-pipeline', `Location "${location}" for ${character} attempt ${attempt} failed, retrying...`)
		}
	);

	return { memoriesAdded, locationAdded };
}
