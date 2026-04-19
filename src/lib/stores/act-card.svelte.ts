import { generateActCard } from '$lib/ai/act-card-generator';
import { getActiveActLineId } from './stories.svelte';
import { log } from '$lib/logging/logger';

let isGenerating = $state(false);
let error = $state<string | null>(null);
let lastGeneratedPath = $state<string | null>(null);

export function getIsGenerating(): boolean {
	return isGenerating;
}

export function getError(): string | null {
	return error;
}

export function getLastGeneratedPath(): string | null {
	return lastGeneratedPath;
}

export async function generateActCardForCurrentLine(): Promise<void> {
	if (!getActiveActLineId()) {
		error = 'No active act line selected.';
		return;
	}

	isGenerating = true;
	error = null;
	lastGeneratedPath = null;

	try {
		const result = await generateActCard();
		lastGeneratedPath = result.filePath;
	} catch (err) {
		const message = err instanceof Error ? err.message : 'Failed to generate act card.';
		error = message;
		await log.error('act-card', message, err);
	} finally {
		isGenerating = false;
	}
}

export function resetState(): void {
	error = null;
	lastGeneratedPath = null;
}
