import {
	getActiveActLineId,
	getActiveAct,
	forkActLine,
	forkActLineForInterview,
	selectActLine,
	getActiveStory,
} from '$lib/stores/stories.svelte';
import { getForkSequence, loadActLineMessages, getIsBusy, getMessages } from '$lib/ai/chat.svelte';
import { enterActPlotInterviewMode } from '$lib/features/world-builder/world-builder.svelte';
import { ensureWorldFile } from '$lib/ai/world-generator';
import { setError as setStoryCreationError } from '$lib/features/world-builder/story-creation.svelte';
import { log } from '$lib/logging/logger';
import { t } from '$lib/i18n';
import { toaster } from '$lib/stores/toaster.svelte';

let isForking = $state(false);
let forkChoiceIndex = $state<number | null>(null);

export function getIsForking(): boolean {
	return isForking;
}

export function getForkChoiceIndex(): number | null {
	return forkChoiceIndex;
}

export function handleFork(messageIndex: number): void {
	const actLineId = getActiveActLineId();
	const act = getActiveAct();
	if (!actLineId || !act || getIsBusy() || isForking) return;
	forkChoiceIndex = messageIndex;
}

export async function handleForkDirect(messageIndex: number): Promise<void> {
	const actLineId = getActiveActLineId();
	const act = getActiveAct();
	if (!actLineId || !act || getIsBusy() || isForking) return;
	isForking = true;
	forkChoiceIndex = null;
	const toastId = toaster.create({ title: t('chat.forking'), type: 'loading' });
	try {
		const { branchSeq, name } = await getForkSequence(actLineId, messageIndex);
		const line = await forkActLine(actLineId, branchSeq, act.id, name);
		await loadActLineMessages(line.id);
		toaster.update(toastId, { title: t('chat.forkSuccess'), type: 'success' });
	} catch (err) {
		toaster.update(toastId, { title: t('chat.forkFailed'), type: 'error' });
		throw err;
	} finally {
		isForking = false;
	}
}

export async function handleForkWithInterview(messageIndex: number, plotMode: 'guidance' | 'phaseEvent' | null): Promise<void> {
	const story = getActiveStory();
	const actLineId = getActiveActLineId();
	const act = getActiveAct();
	if (!actLineId || !act || !story || getIsBusy() || isForking) return;

	const worldContent = await ensureWorldFile(story.id, story.name);
	isForking = true;
	forkChoiceIndex = null;
	try {
		const { branchSeq, name } = await getForkSequence(actLineId, messageIndex);
		const plotModeOverride = plotMode ?? undefined;
		const line = await forkActLineForInterview(actLineId, branchSeq, act.id, name, plotModeOverride);
		await selectActLine(line.id);

		const forkedMessage = getMessages()[messageIndex];
		const actSummary = forkedMessage?.actSummary ?? '';
		const narrativeBody = forkedMessage?.variables?.narrativeBody ?? '';
		const sceneNumber = forkedMessage?.sceneNumber ?? 1;
		const sceneTitle = forkedMessage?.variables?.sceneTitle ?? '';

		await enterActPlotInterviewMode({
			actLineId: line.id,
			worldContent,
			forkContext: { actSummary, narrativeBody, sceneNumber, sceneTitle },
			story: { id: story.id, name: story.name },
		});
	} catch (err) {
		await log.error('fork', 'Failed to start fork interview', err);
		setStoryCreationError(err instanceof Error ? err.message : t('errors.failedToStartForkInterview'));
	} finally {
		isForking = false;
	}
}

export function cancelForkChoice(onResetPlotMode?: () => void): void {
	forkChoiceIndex = null;
	onResetPlotMode?.();
}
