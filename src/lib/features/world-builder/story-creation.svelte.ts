import {
	getActiveActLineId,
	getActiveAct,
	createStoryFromWorldBuilder,
	selectActLine,
	setActPlotGenerationPhase,
	getActiveStory,
	getActiveDirectorNotesText,
} from '$lib/stores/stories.svelte';
import { settings, isDirectorModeEnabled } from '$lib/stores/settings.svelte';
import {
	getStoryName as getWorldBuilderStoryName,
	getWorldContent as getWorldBuilderContent,
	enterActPlotInterviewMode,
	removeLastInterviewAssistantMessage,
	exitWorldBuilderMode,
	getMessages as getWorldBuilderMessages,
	getActPlotInterview,
} from '$lib/features/world-builder/world-builder.svelte';
import { loadActLineMessages, sendInitialNarration } from '$lib/ai/chat.svelte';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { updateWorldCard, ensureWorldFile } from '$lib/ai/world-generator';
import { ensureActPlot } from '$lib/ai/act-plot';
import { getActLine, getPrecedingActSummary, getPremisesMessages, getMessagesForLine } from '$lib/db/act-lines';
import { generateTurnOfEvents } from '$lib/features/turn-of-events-generator';
import { updateMessageFields, type Message } from '$lib/db/messages';
import { type GameDataRegenerationContext, regenerateGameData } from '$lib/ai/game-data-regenerator';
import { emptyVariables, type NarrativeVariables } from '$lib/ai/narrative-types';
import { log } from '$lib/logging/logger';
import { t } from '$lib/i18n';
import type { Story } from '$lib/db/stories';

let showCreateStoryOptions = $state(false);
let isCreatingStory = $state(false);
let createStoryError = $state<string | null>(null);
let storyCreated = $state(false);

export function getShowCreateStoryOptions(): boolean {
	return showCreateStoryOptions;
}

export function getIsCreatingStory(): boolean {
	return isCreatingStory;
}

export function getCreateStoryError(): string | null {
	return createStoryError;
}

export function setError(error: string | null): void {
	createStoryError = error;
}

export function handleCreateFromWorldBuilder(): void {
	const name = getWorldBuilderStoryName();
	if (!name) return;
	showCreateStoryOptions = true;
}

export function cancelCreateStoryOptions(): void {
	showCreateStoryOptions = false;
	createStoryError = null;
	storyCreated = false;
}

async function ensureStoryCreated(): Promise<boolean> {
	const name = getWorldBuilderStoryName();
	const worldContent = getWorldBuilderContent();
	if (!name || !worldContent) return false;

	if (!storyCreated) {
		await createStoryFromWorldBuilder(name, worldContent, settings.locale || 'en');
		storyCreated = true;
	}
	return true;
}

function getActLineAndStory(): { actLineId: string; story: Story } | null {
	const actLineId = getActiveActLineId();
	const story = getActiveStory();

	if (!actLineId || !story) {
		createStoryError = t('errors.storyCreationFailed');
		return null;
	}
	return { actLineId, story };
}

export async function handleCreateStoryImmediate(actNumber: number = 1): Promise<void> {
	isCreatingStory = true;
	createStoryError = null;

	const storyCreatedResult = await ensureStoryCreated();
	const worldContent = getWorldBuilderContent();
	const refs = getActLineAndStory();

	if (!storyCreatedResult || !worldContent || !refs) {
		createStoryError = t('errors.missingRequiredContents');
		isCreatingStory = false;
		return;
	}

	const actLine = await getActLine(refs.actLineId);
	if (!actLine) {
		createStoryError = t('errors.storyCreationFailed');
		return;
	}

	try {
		await ensureActPlot({
			worldContent,
			story: refs.story,
			actNumber,
			actLine,
			isResumeGame: false,
			onPhaseChange: setActPlotGenerationPhase,
			onGenerationComplete: () => setActPlotGenerationPhase(null),
		});
	} catch (err) {
		createStoryError = err instanceof Error ? err.message : t('errors.failedToCreateStory');
	} finally {
		setActPlotGenerationPhase(null);
		isCreatingStory = false;
	}

	exitWorldBuilderMode();
	await sendInitialNarration(refs.actLineId).then(() => log.debug('story-creation', 'initial narration sent'));
}

export async function handleCreateActPlotInterview(): Promise<void> {
	isCreatingStory = true;
	createStoryError = null;

	try {
		if (!(await ensureStoryCreated())) return;

		const refs = getActLineAndStory();
		if (!refs) {
			isCreatingStory = false;
			return;
		}

		const worldContent = getWorldBuilderContent();
		if (!worldContent) {
			createStoryError = t('errors.worldContentNotAvailable');
			isCreatingStory = false;
			return;
		}
		await enterActPlotInterviewMode({
			actLineId: refs.actLineId,
			worldContent,
			story: { id: refs.story.id, name: refs.story.name },
		});
	} catch (err) {
		createStoryError = err instanceof Error ? err.message : t('errors.failedToStartInterview');
	} finally {
		isCreatingStory = false;
	}
}

export async function handleStartGameAfterInterview(isGameResumeMode: boolean, updateWorld: boolean = false): Promise<void> {
	const refs = getActLineAndStory();
	if (!refs) return;
	const resolvedActNumber = getActiveAct()?.actNumber ?? 1;
	createStoryError = null;
	const actLine = await getActLine(refs.actLineId);
	if (!actLine) {
		createStoryError = t('errors.storyCreationFailed');
		return;
	}

	isCreatingStory = true;
	try {
		await removeLastInterviewAssistantMessage();

		let worldContent = getWorldBuilderContent();
		if (worldContent) {
			if (updateWorld) {
				const folderName = await resolveStoryFolder(refs.story.id, refs.story.name);
				const actSummary = await getPrecedingActSummary(refs.actLineId);
				const transcript = await getPremisesMessages(refs.actLineId);
				const transcriptMessages = transcript
					.filter((m) => m.role === 'user' || m.role === 'assistant')
					.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

				worldContent = await updateWorldCard({
					folderName,
					currentWorldContent: worldContent,
					actSummary: actSummary ?? '',
					interviewTranscript: transcriptMessages,
				});
			}

			let forkedMessage: Message | undefined = undefined;
			if (isGameResumeMode) {
				forkedMessage = await enrichForkedMessageWithTurnOfEvents(refs.actLineId, refs.story.id, refs.story.name);
			}

			const actPlotContent = await ensureActPlot({
				worldContent: worldContent ?? undefined,
				story: refs.story,
				actNumber: resolvedActNumber,
				actLine,
				isResumeGame: isGameResumeMode,
				onPhaseChange: setActPlotGenerationPhase,
				onGenerationComplete: () => setActPlotGenerationPhase(null),
			});

			if (forkedMessage) {
				await regenerateGameDataForForkedMessage(forkedMessage.id, {
					worldContent: worldContent ?? '',
					actPlot: actPlotContent,
					actSummary: forkedMessage.actSummary ?? '',
					directorNotes: isDirectorModeEnabled() ? getActiveDirectorNotesText(forkedMessage.sceneNumber ?? 1) : '',
					sceneNumber: forkedMessage.sceneNumber ?? 1,
					narrativeVariables: forkedMessage.variables ?? emptyVariables(),
					playerResponse: null,
				});
			}

			exitWorldBuilderMode();

			if (isGameResumeMode) {
				await loadActLineMessages(refs.actLineId);
			} else {
				sendInitialNarration(refs.actLineId).then(() => log.debug('story-creation', 'initial narration sent'));
			}
		} else {
			createStoryError = t('errors.worldContentNotAvailable');
		}
	} catch (err) {
		createStoryError = err instanceof Error ? err.message : t('errors.failedToStartGame');
	} finally {
		setActPlotGenerationPhase(null);
		isCreatingStory = false;
	}
}

async function enrichForkedMessageWithTurnOfEvents(actLineId: string, storyId: string, storyName: string): Promise<Message | undefined> {
	const lineMessages = await getMessagesForLine(actLineId);
	const lastAssistant = lineMessages.findLast((m) => m.role === 'assistant');
	if (!lastAssistant || !lastAssistant.variables?.narrativeBody) return undefined;

	const interviewMessages = getWorldBuilderMessages();
	if (interviewMessages.length === 0) return undefined;

	const turnOfEventsText = await generateTurnOfEvents({
		storyId,
		storyName,
		actSummary: lastAssistant.actSummary ?? '',
		narrativeBody: lastAssistant.variables.narrativeBody,
		sceneNumber: lastAssistant.sceneNumber ?? 1,
		sceneTitle: lastAssistant.variables.sceneTitle ?? '',
		interviewMessages: interviewMessages.filter((m) => m.role === 'user' || m.role === 'assistant'),
	});

	const enrichedVariables: NarrativeVariables = {
		...lastAssistant.variables,
		turnOfEvents: turnOfEventsText,
	};

	await updateMessageFields(lastAssistant.id, {
		variables: JSON.stringify(enrichedVariables),
	});
	return {
		...lastAssistant,
		variables: enrichedVariables,
	};
}

async function regenerateGameDataForForkedMessage(messageId: string, ctx: GameDataRegenerationContext): Promise<void> {
	const regeneratedGameData = await regenerateGameData(ctx);
	if (regeneratedGameData) {
		const updatedVariables: NarrativeVariables = {
			...ctx.narrativeVariables,
			gameData: regeneratedGameData,
		};
		await updateMessageFields(messageId, {
			variables: JSON.stringify(updatedVariables),
		});
	}
}
