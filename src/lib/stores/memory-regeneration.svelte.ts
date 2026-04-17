import { Memory } from '$lib/memory/memory';
import { getEmbeddingProviderConfig, getMemoryProviderConfig } from '$lib/stores/settings.svelte';
import { getActiveStoryId, getActiveActLineId } from './stories.svelte';
import { getMessagesForLine } from '$lib/db/act-lines';
import { runMemoryExtractionPipeline } from '$lib/ai/memory-extraction-pipeline';
import { log } from '$lib/logging/logger';

let isRegenerating = $state(false);
let error = $state<string | null>(null);
let lastResult = $state<string | null>(null);

export function getIsRegenerating(): boolean {
	return isRegenerating;
}

export function getRegenError(): string | null {
	return error;
}

export function getLastRegenResult(): string | null {
	return lastResult;
}

export async function regenerateMemoriesForCurrentLine(): Promise<void> {
	const storyId = getActiveStoryId();
	const actLineId = getActiveActLineId();

	if (!storyId || !actLineId) {
		error = 'No active act line selected.';
		return;
	}

	isRegenerating = true;
	error = null;
	lastResult = null;

	try {
		const embeddingConfig = getEmbeddingProviderConfig();
		if (!embeddingConfig) {
			throw new Error('Embedding provider not configured');
		}

		// Delete existing memories and locations for this act line
		const memory = new Memory(embeddingConfig);
		const deletedMemories = await memory.deleteByActLine(storyId, actLineId);
		const deletedLocations = await memory.deleteLocationsByActLine(storyId, actLineId);
		await log.info('memory-regen', `Deleted ${deletedMemories} memories and ${deletedLocations} locations for act line ${actLineId}`);

		// Get all messages for the act line and filter to assistant messages only
		const messages = await getMessagesForLine(actLineId);
		const assistantMessages = messages.filter((m) => m.role === 'assistant');

		if (assistantMessages.length === 0) {
			lastResult = 'No assistant messages found.';
			return;
		}

		// Run pipeline for each assistant message sequentially
		let totalCharacters = 0;
		let totalMemories = 0;
		let totalLocations = 0;
		let errorCount = 0;

		for (const msg of assistantMessages) {
			try {
				const result = await runMemoryExtractionPipeline(
					msg.content,
					storyId,
					actLineId,
					msg.id
				);
				totalCharacters += result.charactersProcessed;
				totalMemories += result.memoriesAdded;
				totalLocations += result.locationsAdded;
				errorCount += result.errors.length;
			} catch (err) {
				errorCount += 1;
				await log.error('memory-regen', `Failed for message ${msg.id}`, err);
			}
		}

		lastResult = `${totalMemories} memories, ${totalLocations} locations from ${assistantMessages.length} messages`;
		if (errorCount > 0) {
			lastResult += ` (${errorCount} errors)`;
		}
		await log.info('memory-regen', `Regeneration complete: ${lastResult}`);
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to regenerate memories.';
		error = message;
		await log.error('memory-regen', message, err);
	} finally {
		isRegenerating = false;
	}
}

export function resetRegenState(): void {
	error = null;
	lastResult = null;
}
