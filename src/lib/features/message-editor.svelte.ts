import { getIsBusy, getIsStreaming, getMessages, updateMessageInState, type UIMessage } from '$lib/ai/chat.svelte';
import {
	getIsStreaming as getIsWorldBuilderStreaming,
	updateWorldBuilderMessageContent,
	getActPlotInterview,
	type WorldBuilderMessage,
} from '$lib/features/world-builder/world-builder.svelte';
import { updateMessageFields } from '$lib/db/messages';
import { hasTemplateMetadata } from '$lib/ai/template-renderer';
import { type NarrativeVariables } from '$lib/ai/narrative-types';
import { log } from '$lib/logging/logger';

let editingMessageId = $state<string | null>(null);
let editingIsTemplated = $state(false);

export function getEditingMessageId(): string | null {
	return editingMessageId;
}

export function getEditingIsTemplated(): boolean {
	return editingIsTemplated;
}

export function isEditingMessage(messageId: string): boolean {
	return editingMessageId === messageId;
}

export function shouldShowStreamingCursor(message: UIMessage): boolean {
	return (
		!message.content &&
		!message.reasoning &&
		!message.phases?.length &&
		!(message.variables && hasTemplateMetadata(message.variables)) &&
		getIsStreaming() &&
		message === getMessages().at(-1)
	);
}

export function startEditMessage(message: UIMessage | WorldBuilderMessage, isTemplated: boolean): void {
	if (getIsBusy() || getIsWorldBuilderStreaming()) return;
	editingMessageId = message.id;
	editingIsTemplated = isTemplated;
}

export function cancelEdit(): void {
	editingMessageId = null;
	editingIsTemplated = false;
}

export async function saveEditMainChatMessage(
	message: UIMessage,
	data: { content?: string; variables?: { sceneTitle?: string; background?: string; narrativeBody?: string; cg?: string } }
): Promise<void> {
	if (!editingMessageId) return;
	try {
		if (data.variables) {
			const updatedVariables: NarrativeVariables = {
				...message.variables,
				sceneTitle: data.variables.sceneTitle || null,
				background: data.variables.background || null,
				narrativeBody: data.variables.narrativeBody || null,
				cg: data.variables.cg || null,
			};
			await updateMessageFields(message.id, { variables: JSON.stringify(updatedVariables) });
			updateMessageInState(message.id, { variables: updatedVariables });
		} else {
			await updateMessageFields(message.id, { content: data.content ?? '' });
			updateMessageInState(message.id, { content: data.content ?? '' });
		}
		cancelEdit();
	} catch (err) {
		await log.error('edit-message', 'Failed to save message edit', err);
	}
}

export async function saveEditWorldBuilderMessage(message: WorldBuilderMessage, data: { content?: string }): Promise<void> {
	if (!editingMessageId) return;
	try {
		const content = data.content ?? '';
		updateWorldBuilderMessageContent(message.id, content);
		if (getActPlotInterview()) {
			await updateMessageFields(message.id, { content });
		}
		cancelEdit();
	} catch (err) {
		await log.error('edit-message', 'Failed to save world builder message edit', err);
	}
}
