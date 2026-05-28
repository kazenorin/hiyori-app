import { generateText } from 'ai';
import { createModel } from '$lib/ai/provider';
import {
	type EmbeddingProviderConfig,
	getEmbeddingProviderConfig,
	getMemoryProviderConfig,
	type MemoryProviderConfig,
} from '$lib/stores/settings.svelte';
import { loadMemoryExtractionPrompt, loadMemoryExtractionSystemPrompt } from '$lib/fs/prompts';
import { type ExtractedMemories, parseMemoryExtract } from '$lib/features/memory/memory-extract-parser';
import { Memory } from '$lib/features/memory';
import { parseCharacterAliases } from '$lib/ai/act-summary-parser';
import { aliasFilterExtractionPrompt } from '$lib/definitions/pipeline-prompts';
import { stripCodeFences } from '$lib/utils/strings';
import { isAuthError, toError, withRetry } from '$lib/utils/async';
import { fileLog, log } from '$lib/logging/logger';
import { ERR_MEMORY_PROVIDER_NOT_CONFIGURED, ERR_EMBEDDING_PROVIDER_NOT_CONFIGURED } from '$lib/definitions/error-messages';

export interface PipelineResult {
	charactersProcessed: number;
	memoriesAdded: number;
	locationsAdded: number;
	aliasesAdded: number;
	inventoryAdded: number;
	inventoryChangesAdded: number;
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
		throw new Error(ERR_MEMORY_PROVIDER_NOT_CONFIGURED);
	}

	const embeddingConfig = getEmbeddingProviderConfig();
	if (!embeddingConfig) {
		throw new Error(ERR_EMBEDDING_PROVIDER_NOT_CONFIGURED);
	}

	// Step 1: Generate memories via LLM
	const [generatedText] = await Promise.all([
		generateMemoriesWithRetry(assistantResponse, llmConfig),
		log.debug('memory-pipeline', `Generating memories for message=${messageId}...`),
	]);

	await fileLog('debug', 'memory-pipeline', () => '--- Generated ---\n\n' + generatedText);

	// Step 2: Parse into structured object
	await log.debug('memory-pipeline', `parsing memories for message=${messageId}...`);
	const extracted = parseMemoryExtract(generatedText);

	await fileLog('debug', 'memory-pipeline', () => '--- Extracted ---\n\n' + JSON.stringify(extracted, null, 2));

	// Step 3: Persist each character/location (uses embedding provider)
	await log.debug('memory-pipeline', `persisting memories for message=${messageId}...`);
	const result = await persistMemoriesWithRetry(extracted, storyId, actLineId, messageId, embeddingConfig);

	// Step 4: Persist aliases from act summary
	if (actSummary) {
		const aliasEntries = parseCharacterAliases(actSummary);
		await fileLog('debug', 'memory-pipeline', () => '--- Aliases ---\n\n' + JSON.stringify(aliasEntries, null, 2));
		const aliasGroups = aliasEntries.filter((entry) => entry.aliases.length > 0).map((entry) => [entry.characterName, ...entry.aliases]);
		if (aliasGroups.length > 0) {
			const flatAliases = aliasGroups.flat();
			await log.debug('memory-pipeline', `Filtering ${flatAliases.length} alias strings via LLM...`);
			const filtered = await filterAliasesWithRetry(flatAliases, llmConfig);
			await fileLog('debug', 'memory-pipeline', () => '--- Filtered Aliases ---\n\n' + JSON.stringify(filtered, null, 2));
			const filteredSet = new Set(filtered);
			const filteredGroups = aliasGroups.map((group) => group.filter((a) => filteredSet.has(a))).filter((group) => group.length > 1);
			if (filteredGroups.length > 0) {
				result.aliasesAdded = await persistAliases(embeddingConfig, storyId, actLineId, messageId, filteredGroups);
			}
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

async function filterAliasesWithRetry(flatAliases: string[], config: MemoryProviderConfig): Promise<string[]> {
	const model = createModel(config);
	const systemPrompt = aliasFilterExtractionPrompt();
	const userPrompt = JSON.stringify(flatAliases);

	const result = await withRetry(() => generateText({ model, system: systemPrompt, prompt: userPrompt }).then((r) => r.text), {
		maxAttempts: RETRY_COUNT + 1,
		backoffMs: BACKOFF_SECONDS * 1000,
		shouldRetry: (err) => !isAuthError(err),
		onRetry: (attempt) => log.warn('memory-pipeline', `Alias filter attempt ${attempt} failed, retrying...`),
	});

	try {
		const parsed = JSON.parse(stripCodeFences(result));
		if (!Array.isArray(parsed)) return flatAliases;
		return parsed.filter((item): item is string => typeof item === 'string');
	} catch {
		await log.warn('memory-pipeline', 'Alias filter returned invalid JSON, using unfiltered aliases');
		return flatAliases;
	}
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
		inventoryAdded: 0,
		inventoryChangesAdded: 0,
		errors: [],
	};

	for (const [character, characterData] of Object.entries(extracted)) {
		let characterSuccess = true;
		for (const [location, memories] of Object.entries(characterData.locations)) {
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

		// Persist inventory if present
		if (characterData.inventory && characterData.inventory.items.length > 0) {
			try {
				const inventoryAdded = await memory.addInventory(storyId, actLineId, messageId, character, characterData.inventory.items);
				result.inventoryAdded += inventoryAdded;
			} catch (err) {
				const msg = toError(err).message;
				result.errors.push(`Character ${character}, Inventory: ${msg}`);
				await log.error('memory-pipeline', `Failed to persist inventory for ${character}`, err);
			}
		}

		// Persist inventory changes if present
		if (characterData.inventory?.changes && characterData.inventory.changes.length > 0) {
			try {
				const changesAdded = await memory.addInventoryChanges(storyId, actLineId, messageId, character, characterData.inventory.changes);
				result.inventoryChangesAdded += changesAdded;
			} catch (err) {
				const msg = toError(err).message;
				result.errors.push(`Character ${character}, Inventory Changes: ${msg}`);
				await log.error('memory-pipeline', `Failed to persist inventory changes for ${character}`, err);
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
