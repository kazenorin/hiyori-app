import { generateText } from 'ai';
import { createModel } from './provider';
import {
	type EmbeddingProviderConfig,
	getEmbeddingProviderConfig,
	getMemoryProviderConfig,
	type MemoryProviderConfig,
} from '$lib/stores/settings.svelte';
import { loadMemoryExtractionPrompt, loadMemoryExtractionSystemPrompt } from '$lib/fs/prompts';
import { type ExtractedMemories, parseMemoryExtract } from '$lib/memory/memory-extract-parser';
import { Memory } from '$lib/memory/memory';
import { parseCharacterAliases, type CharacterAliasEntry } from './act-summary-parser';
import { isAuthError, toError, withRetry } from '$lib/utils/async';
import { log } from '$lib/logging/logger';

export interface PipelineResult {
	charactersProcessed: number;
	memoriesAdded: number;
	locationsAdded: number;
	aliasesAdded: number;
	errors: string[];
}

const RETRY_COUNT = 3;
const BACKOFF_SECONDS = 2;

export async function runMemoryExtractionPipeline(
	assistantResponse: string,
	storyId: string,
	actLineId: string,
	messageId: string,
	actSummary?: string
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
	const [generatedText] = await Promise.all([
		generateMemoriesWithRetry(assistantResponse, llmConfig),
		log.debug('memory-pipeline', `Generating memories for message=${messageId}...`),
	]);

	// Step 2: Parse into structured object
	await log.debug('memory-pipeline', `parsing memories for message=${messageId}...`);
	const extracted = parseMemoryExtract(generatedText);

	// Step 3: Persist each character/location (uses embedding provider)
	await log.debug('memory-pipeline', `persisting memories for message=${messageId}...`);
	const result = await persistMemoriesWithRetry(extracted, storyId, actLineId, messageId, embeddingConfig);

	// Step 4: Persist aliases from act summary
	if (actSummary) {
		const aliasEntries = parseCharacterAliases(actSummary);
		const aliasGroups = aliasEntries
			.filter((entry) => entry.aliases.length > 0)
			.map((entry) => entry.aliases);
		if (aliasGroups.length > 0) {
			result.aliasesAdded = await persistAliases(embeddingConfig, storyId, actLineId, messageId, aliasGroups);
		}
	}

	return result;
}

async function generateMemoriesWithRetry(response: string, config: MemoryProviderConfig): Promise<string> {
	const model = createModel(config);
	const systemPrompt = await loadMemoryExtractionSystemPrompt();
	const extractionPromptTemplate = await loadMemoryExtractionPrompt();
	const userPrompt = extractionPromptTemplate + '\n' + response;

	return await withRetry(() => generateText({ model, system: systemPrompt, prompt: userPrompt }).then((r) => r.text), {
		maxAttempts: RETRY_COUNT + 1,
		backoffMs: BACKOFF_SECONDS * 1000,
		shouldRetry: (err) => !isAuthError(err),
		onRetry: (attempt) => log.warn('memory-pipeline', `Memory generation attempt ${attempt} failed, retrying...`),
	});
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
		aliasesAdded: 0,
		errors: [],
	};

	for (const [character, locations] of Object.entries(extracted) as [string, { [location: string]: string[] }][]) {
		let characterSuccess = true;
		for (const [location, memories] of Object.entries(locations) as [string, string[]][]) {
			// Per-location retry scope — avoids duplicating previously succeeded locations
			try {
				const { memoriesAdded, locationAdded } = await persistLocationWithRetry(
					memory,
					storyId,
					actLineId,
					messageId,
					character,
					location,
					memories
				);
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

async function persistAliases(config: EmbeddingProviderConfig, storyId: string, actLineId: string, messageId: string, aliases: string[][]) {
	const memory = new Memory(config);
	await memory.addAliases(storyId, actLineId, messageId, aliases);
	return aliases.reduce((sum, group) => sum + group.length, 0);
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
			onRetry: (attempt) => log.warn('memory-pipeline', `Location "${location}" for ${character} attempt ${attempt} failed, retrying...`),
		}
	);

	return { memoriesAdded, locationAdded };
}