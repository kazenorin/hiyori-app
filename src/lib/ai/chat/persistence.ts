import * as dbActLines from '$lib/db/act-lines';
import * as dbMessages from '$lib/db/messages';
import { parseImportantPhrases, serializeImportantPhrases } from '$lib/db/messages';
export { serializeImportantPhrases };
import { Memory } from '$lib/features/memory';
import { log } from '$lib/logging/logger';
import { getMemoryProviderConfig, settings } from '$lib/stores/settings.svelte';
import { getActiveStoryId } from '$lib/stores/stories.svelte';
import { getErrorMessage } from '$lib/utils/error-handling';
import type { MessageMetadata, PhaseMetadata } from '../chat-stream';
import type { AssistantContext } from '$lib/ai/pipeline/types';
import type { UIMessage } from './types';

export function parseMetadata(raw: string | undefined | null): MessageMetadata | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		// Migration: rename old field names
		if ('promptTokens' in parsed && !('inputTokens' in parsed)) {
			parsed.inputTokens = parsed.promptTokens;
			delete parsed.promptTokens;
		}
		if ('completionTokens' in parsed && !('outputTokens' in parsed)) {
			parsed.outputTokens = parsed.completionTokens;
			delete parsed.completionTokens;
		}
		return parsed;
	} catch {
		return undefined;
	}
}

export async function persistMessage(actLineId: string, message: UIMessage, sequence: number): Promise<void> {
	await dbMessages.createMessage({
		id: message.id,
		role: 'assistant',
		content: message.content,
		reasoning: message.reasoning,
		metadata: message.metadata ? JSON.stringify(message.metadata) : undefined,
		sceneNumber: message.sceneNumber,
		variables: message.variables,
		actSummary: message.actSummary,
		scenePlot: message.scenePlot,
		importantPhrases: message.importantPhrases ? serializeImportantPhrases(message.importantPhrases) : undefined,
	});
	await dbActLines.addMessageToLine(actLineId, message.id, sequence);
}

export async function persistUserMessage(playerResponse: string, sceneNumber: number, actLineId: string): Promise<UIMessage> {
	const userMessage: UIMessage = {
		id: crypto.randomUUID(),
		role: 'user',
		content: playerResponse,
		sceneNumber: sceneNumber,
	};

	await dbMessages.createMessage({
		id: userMessage.id,
		role: userMessage.role,
		content: userMessage.content,
		sceneNumber: userMessage.sceneNumber,
	});

	const userSeq = await dbActLines.getNextSequence(actLineId);
	await dbActLines.addMessageToLine(actLineId, userMessage.id, userSeq);
	return userMessage;
}

export async function loadActLineMessagesFromDB(actLineId: string): Promise<UIMessage[]> {
	const dbMsgs = await dbActLines.getMessagesForLine(actLineId);
	return dbMsgs.map((m) => ({
		id: m.id,
		role: m.role,
		content: m.content,
		reasoning: m.reasoning,
		metadata: parseMetadata(m.metadata),
		sceneNumber: m.sceneNumber ?? 0,
		variables: m.variables,
		actSummary: m.actSummary,
		scenePlot: m.scenePlot,
		importantPhrases: parseImportantPhrases(m.importantPhrases),
	}));
}

export async function backfillImportantPhrases(
	msgs: UIMessage[],
	deps: {
		extract: (narrativeBody: string) => Promise<string[]>;
		persist: (messageId: string, metadataUpdates: { importantPhrases?: string }) => Promise<void>;
	}
): Promise<void> {
	for (let i = 0; i < msgs.length; i++) {
		const msg = msgs[i];
		if (msg.role === 'assistant' && !msg.importantPhrases?.length && msg.variables?.narrativeBody) {
			try {
				const phrases = await deps.extract(msg.variables.narrativeBody);
				if (phrases.length > 0) {
					await deps.persist(msg.id, { importantPhrases: serializeImportantPhrases(phrases) });
					msgs[i] = { ...msgs[i], importantPhrases: phrases };
				}
			} catch (err) {
				await log.error('backfill-phrases', `Failed to extract phrases for message=${msg.id}`, err);
			}
		}
	}
}

/** Remove messages from a given index onwards. Returns success + remaining messages. */
export async function removeMessagesFromIndex(
	actLineId: string,
	messages: UIMessage[],
	fromIndex: number
): Promise<{ success: boolean; remaining: UIMessage[] }> {
	const idsToRemove = messages.slice(fromIndex).map((m) => m.id);
	const success = await removeMessagesById(actLineId, idsToRemove);
	return { success, remaining: success ? messages.slice(0, fromIndex) : messages };
}

export async function removeMessagesById(actLineId: string, messageIds: string[]): Promise<boolean> {
	let removedIds: string[] = [];
	try {
		removedIds = await dbActLines.removeMessagesFromActLine(actLineId, messageIds);
	} catch (err) {
		await log.error('remove-messages-from-index', 'Message removal failed', err);
		return false;
	}

	if (removedIds.length > 0) {
		try {
			await removeMemoriesFromActLine(actLineId, removedIds);
		} catch (err) {
			await log.error('remove-messages-from-index', 'Memory cleanup failed', err);
		}
	}
	return true;
}

export async function removeMemoriesFromActLine(actLineId: string, messageIdsToRemove: string[]): Promise<void> {
	const storyId = getActiveStoryId();
	if (storyId && settings.memoryEnabled) {
		const config = getMemoryProviderConfig();
		if (config) {
			const memory = new Memory(config);
			await memory.deleteByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteLocationsByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteAliasesByMessages(storyId, actLineId, messageIdsToRemove);
			await memory.deleteInventoryByMessages(storyId, actLineId, messageIdsToRemove);
		}
	}
}

/**
 * Handle errors from streaming: persist partial on abort, remove message on other errors.
 * Returns updated messages and error string instead of mutating module state.
 */
export async function handleStreamError(
	err: unknown,
	responseMsg: UIMessage,
	actLineId: string,
	msgs: UIMessage[]
): Promise<{ messages: UIMessage[]; error: string | null }> {
	if (err instanceof DOMException && err.name === 'AbortError') {
		if (responseMsg && responseMsg.content) {
			const seq = await dbActLines.getNextSequence(actLineId);
			await persistMessage(actLineId, responseMsg, seq);
		}
		await log.warn('send-message', 'User aborted.');
		return { messages: msgs, error: null };
	}
	const errorMessage = getErrorMessage(err);
	await log.error('send-message', errorMessage, err);
	await dbActLines.deleteEventsForMessage(responseMsg.id);
	return { messages: msgs.filter((m) => m.id !== responseMsg.id), error: errorMessage };
}

export async function updateLastPlotGeneration(
	phases: PhaseMetadata[] | undefined,
	actLineId: string,
	assistant: AssistantContext,
	sceneNumber: number
): Promise<void> {
	if (phases?.some((p) => p.phaseName === 'PLOT_PLANNER')) {
		await dbActLines.recordPlotGeneration(actLineId, assistant, sceneNumber);
	}
}

export async function updatePersistentMessageMetadata(
	messageId: string,
	metadataUpdates: {
		actSummary?: string;
		metadata?: string;
		importantPhrases?: string;
	}
): Promise<void> {
	if (Object.keys(metadataUpdates).length > 0) {
		await dbMessages.updateMessageFields(messageId, metadataUpdates);
	}
}
