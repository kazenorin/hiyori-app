import { getIsBusy, getMessages, clearMessages, runEpilogueFlow } from '$lib/ai/chat.svelte';
import {
	getActiveActLineId,
	getActiveAct,
	getActiveStory,
	createActLineContinuation,
	selectAct,
	selectActLine,
} from '$lib/stores/stories.svelte';
import { enterActPlotInterviewMode, type NewActInterviewContext } from '$lib/features/world-builder/world-builder.svelte';
import { getActLine, getEndingType, getMessageSequence } from '$lib/db/act-lines';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { generateAndRecordActShortSummary } from '$lib/ai/act-short-summary-generator';
import { log } from '$lib/logging/logger';

export async function handleContinueToNextAct(): Promise<void> {
	if (getIsBusy()) return;
	const endedActLineId = getActiveActLineId();
	if (!endedActLineId) return;

	const story = getActiveStory();
	const endedActLine = await getActLine(endedActLineId);
	const endingType = await getEndingType(endedActLineId);
	if (!story || !endedActLine || !endingType) return;

	const endedAct = getActiveAct();
	if (!endedAct) return;

	const lastAssistantMsg = getMessages().findLast((m) => m.role === 'assistant');
	const currentSummary = lastAssistantMsg?.actSummary ?? '';
	const worldContent = await ensureWorldFile(story.id, story.name);

	const assistantMessageSequence = lastAssistantMsg?.id ? await getMessageSequence(endedActLineId, lastAssistantMsg.id) : null;

	if (lastAssistantMsg && assistantMessageSequence != null && currentSummary) {
		generateAndRecordActShortSummary(endedActLineId, currentSummary, {
			messageId: lastAssistantMsg.id,
			messageSequence: assistantMessageSequence,
		}).catch(() => {});
	}

	try {
		await clearMessages();

		const { act: newAct, actLine: newLine } = await createActLineContinuation(endedAct, endedActLine, story);
		await selectAct(newAct.id);
		await selectActLine(newLine.id);

		const newActContext: NewActInterviewContext = {
			endingType,
			actSummary: currentSummary,
		};

		await enterActPlotInterviewMode({
			actLineId: newLine.id,
			worldContent,
			newActContext,
			story: { id: story.id, name: story.name },
		});
	} catch (err) {
		await log.error('continue-to-next-act', 'Failed to start next act', err);
	}
}

export function handleEndStory(): void {
	if (getIsBusy()) return;
	const actLineId = getActiveActLineId();
	if (!actLineId) return;
	runEpilogueFlow(actLineId);
}
