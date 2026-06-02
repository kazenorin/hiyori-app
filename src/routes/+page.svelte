<script lang="ts">
	import {
		clearMessages,
		deleteLastExchange,
		deleteOrphanedUserMessages,
		getActEnded,
		getCharacterNames,
		getError,
		getForkSequence,
		getIsBusy,
		getIsStreaming,
		getLatestActivePlotThreads,
		getLatestDecisionContext,
		getLatestDecisions,
		getMessages,
		getStoryConcluded,
		isUserMessage,
		loadActLineMessages,
		regenerateLastResponse,
		runEpilogueFlow,
		sendInitialNarration,
		sendMessage,
		stopStreaming,
		type UIMessage,
		updateMessageInState,
	} from '$lib/ai/chat.svelte';
	import MetadataPanel from '$lib/components/MetadataPanel.svelte';
	import {
		deleteLastWorldBuilderExchange,
		enterActPlotInterviewMode,
		exitWorldBuilderMode,
		getActPlotInterview,
		getError as getWorldBuilderError,
		getGameResumeInterview,
		getHasInterviewMessages,
		getIsActive as getIsWorldBuilderActive,
		getIsComplete as getIsWorldBuilderComplete,
		getIsNextActInterview,
		getIsStreaming as getIsWorldBuilderStreaming,
		getMessages as getWorldBuilderMessages,
		getStoryName as getWorldBuilderStoryName,
		getWorldContent as getWorldBuilderContent,
		type NewActInterviewContext,
		regenerateLastWorldBuilderResponse,
		removeLastInterviewAssistantMessage,
		sendWorldBuilderMessage,
		stopStreaming as stopWorldBuilderStreaming,
		type WorldBuilderMessage,
		updateWorldBuilderMessageContent,
	} from '$lib/features/world-builder/world-builder.svelte';
	import {
		createActLineContinuation,
		createStoryFromWorldBuilder,
		forkActLine,
		forkActLineForInterview,
		getActiveAct,
		getActiveActLineId,
		getActiveDirectorNotesText,
		getActiveStory,
		getIsSelectingStory,
		selectAct,
		selectActLine,
		setActPlotGenerationPhase,
	} from '$lib/stores/stories.svelte';
	import { isDirectorModeEnabled, settings } from '$lib/stores/settings.svelte';
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import ChatControls from '$lib/components/ChatControls.svelte';
	import DirectorNotesPanel from '$lib/components/DirectorNotesPanel.svelte';
	import WorldBuilderControls from '$lib/components/WorldBuilderControls.svelte';
	import { hasTemplateMetadata, renderTemplate } from '$lib/ai/template-renderer';
	import { emptyVariables, formatPhaseName, type NarrativeVariables } from '$lib/ai/narrative-types';
	import { loadStoryMessageTemplate, loadStoryMessageTemplateForStory } from '$lib/fs/view-templates';
	import { ensureActPlot } from '$lib/ai/act-plot';
	import {
		getActLine,
		getEndingType,
		getMessageSequence,
		getMessagesForLine,
		getPrecedingActSummary,
		getPremisesMessages,
	} from '$lib/db/act-lines';
	import { log } from '$lib/logging/logger';
	import { generateTurnOfEvents } from '$lib/features/turn-of-events-generator';
	import { type Message, updateMessageFields } from '$lib/db/messages';
	import { type GameDataRegenerationContext, regenerateGameData } from '$lib/ai/game-data-regenerator';
	import type { Story } from '$lib/db/stories';

	import { t } from '$lib/i18n';
	import { resolveStoryFolder } from '$lib/fs/story-folders';
	import { updateWorldCard, ensureWorldFile } from '$lib/ai/world-generator';
	import { generateAndRecordActShortSummary } from '$lib/ai/act-short-summary-generator';
	import ScrollToFAB from '$lib/components/ScrollToFAB.svelte';
	import MobileInputSheet from '$lib/components/MobileInputSheet.svelte';
	import ChoicesSheet from '$lib/components/ChoicesSheet.svelte';
	import ReasoningAccordion from '$lib/components/chat/ReasoningAccordion.svelte';
	import MessageActions from '$lib/components/chat/MessageActions.svelte';
	import ForkChoicePanel from '$lib/components/chat/ForkChoicePanel.svelte';
	import MessageEditForm from '$lib/components/chat/MessageEditForm.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { mobileNav } from '$lib/stores/mobile-nav.svelte';
	import { scrollToBottom } from '$lib/utils/scroll';

	let input = $state('');
	let chatContainer = $state<HTMLDivElement | null>(null);
	let wbChatContainer = $state<HTMLDivElement | null>(null);
	let copiedId = $state<string | null>(null);
	let wasChatStreaming = $state(false);
	let wasWbStreaming = $state(false);
	let rightPanelExpanded = $state(false);
	let mobileDirectorNotesExpanded = $state(false);
	let latestDecisions = $derived(getLatestDecisions());
	let latestActivePlotThreads = $derived(getLatestActivePlotThreads());
	let latestDecisionContext = $derived(getLatestDecisionContext());
	let lastMessageIdx = $derived(getMessages().findLastIndex((m: UIMessage) => m.role === 'assistant'));
	let characterNames = $derived(getCharacterNames());
	let storyMessageTemplate = $state<string>('');

	// Sync choices badge count for mobile bottom nav
	$effect(() => {
		mobileNav.choicesCount = latestDecisions.length;
	});

	$effect(() => {
		getActiveActLineId();
		const story = getActiveStory();
		let stale = false;
		const templatePromise = story ? loadStoryMessageTemplateForStory(story.id, story.name) : loadStoryMessageTemplate();
		templatePromise
			.then((loadedTemplate) => {
				if (!stale) storyMessageTemplate = loadedTemplate;
			})
			.catch(() => {});
		return () => {
			stale = true;
		};
	});
	let lastWbMessageIdx = $derived(getWorldBuilderMessages().findLastIndex((m: WorldBuilderMessage) => m.role === 'assistant'));

	// World builder story creation state
	let showCreateStoryOptions = $state(false);
	let isCreatingStory = $state(false);
	let createStoryError = $state<string | null>(null);
	let isForking = $state(false);
	let forkChoiceIndex = $state<number | null>(null);
	let updateWorldCardChecked = $state(false);
	let forkPlotMode = $state<'guidance' | 'phaseEvent' | null>(null);

	let editingMessageId = $state<string | null>(null);
	let editingIsTemplated = $state(false);


	// Reset fork choice when navigating to a different act line
	$effect(() => {
		getActiveActLineId();
		forkChoiceIndex = null;
	});

	async function handleCopy(messageId: string, content: string) {
		await navigator.clipboard.writeText(content);
		copiedId = messageId;
		setTimeout(() => {
			copiedId = null;
		}, 1500);
	}

	function isEditingMessage(messageId: string): boolean {
		return editingMessageId === messageId;
	}

	function shouldShowStreamingCursor(message: UIMessage): boolean {
		return (
			!message.content &&
			!message.reasoning &&
			!message.phases?.length &&
			!(message.variables && hasTemplateMetadata(message.variables)) &&
			getIsStreaming() &&
			message === getMessages().at(-1)
		);
	}

	function startEditMessage(message: UIMessage | WorldBuilderMessage, isTemplated: boolean) {
		if (getIsBusy() || getIsWorldBuilderStreaming()) return;
		editingMessageId = message.id;
		editingIsTemplated = isTemplated;
	}

	function cancelEdit() {
		editingMessageId = null;
		editingIsTemplated = false;
	}



	async function saveEditMainChatMessage(message: UIMessage, data: { content?: string; variables?: { sceneTitle?: string; background?: string; narrativeBody?: string; cg?: string } }) {
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

	async function saveEditWorldBuilderMessage(message: WorldBuilderMessage, data: { content?: string }) {
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

	async function handleRegenerate(messageId: string) {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		await regenerateLastResponse(actLineId, messageId);
	}

	async function handleDelete() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		await deleteLastExchange(actLineId);
	}

	async function handleDeleteOrphanedUserMessages() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		await deleteOrphanedUserMessages(actLineId);
	}

	async function handleWorldBuilderRegenerate() {
		if (getIsWorldBuilderStreaming()) return;
		await regenerateLastWorldBuilderResponse();
	}

	async function handleWorldBuilderDelete() {
		if (getIsWorldBuilderStreaming()) return;
		await deleteLastWorldBuilderExchange();
	}

	async function handleFork(messageIndex: number) {
		const actLineId = getActiveActLineId();
		const act = getActiveAct();
		if (!actLineId || !act || getIsBusy() || isForking) return;
		forkChoiceIndex = messageIndex;
	}

	async function handleForkDirect(messageIndex: number) {
		const actLineId = getActiveActLineId();
		const act = getActiveAct();
		if (!actLineId || !act || getIsBusy() || isForking) return;
		isForking = true;
		forkChoiceIndex = null;
		try {
			const { branchSeq, name } = await getForkSequence(actLineId, messageIndex);
			const line = await forkActLine(actLineId, branchSeq, act.id, name);
			await loadActLineMessages(line.id);
		} finally {
			isForking = false;
		}
	}

	async function handleForkWithInterview(messageIndex: number) {
		const story = getActiveStory();
		const actLineId = getActiveActLineId();
		const act = getActiveAct();
		if (!actLineId || !act || !story || getIsBusy() || isForking) return;

		const worldContent = await ensureWorldFile(story.id, story.name);
		isForking = true;
		forkChoiceIndex = null;
		try {
			const { branchSeq, name } = await getForkSequence(actLineId, messageIndex);
			const plotModeOverride = forkPlotMode ?? undefined;
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
			createStoryError = err instanceof Error ? err.message : t('errors.failedToStartForkInterview');
		} finally {
			isForking = false;
		}
	}

	function cancelForkChoice() {
		forkChoiceIndex = null;
		forkPlotMode = null;
	}

	function handleSubmit() {
		const text = input.trim();
		if (!text || getIsBusy() || getIsWorldBuilderStreaming()) return;

		if (getIsWorldBuilderActive()) {
			input = '';
			sendWorldBuilderMessage(text);
			return;
		}

		const actLineId = getActiveActLineId();
		if (!actLineId) return;
		input = '';
		sendMessage(actLineId, text);
	}

	function handleCreateFromWorldBuilder() {
		const name = getWorldBuilderStoryName();
		if (!name) return;
		showCreateStoryOptions = true;
	}

	function cancelCreateStoryOptions() {
		showCreateStoryOptions = false;
		createStoryError = null;
		storyCreated = false;
	}

	// Track whether story was already created to prevent duplicates on retry
	let storyCreated = $state(false);

	/**
	 * Ensure story is created from world builder content.
	 * Returns true if story exists (either already created or newly created).
	 */
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

	/**
	 * Get active act line and story references, setting error if missing.
	 * Returns null if either is missing.
	 */
	function getActLineAndStory(): { actLineId: string; story: Story } | null {
		const actLineId = getActiveActLineId();
		const story = getActiveStory();

		if (!actLineId || !story) {
			createStoryError = t('errors.storyCreationFailed');
			return null;
		}
		return { actLineId, story };
	}

	async function handleCreateStoryImmediate(actNumber: number = 1) {
		isCreatingStory = true;
		createStoryError = null;

		const storyCreated = await ensureStoryCreated();
		const worldContent = getWorldBuilderContent();
		const refs = getActLineAndStory();

		if (!storyCreated || !worldContent || !refs) {
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

	async function handleCreateActPlotInterview() {
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

	async function handleStartGameAfterInterview(isGameResumeMode: boolean, updateWorld: boolean = false) {
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

	async function regenerateGameDataForForkedMessage(messageId: string, ctx: GameDataRegenerationContext) {
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

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === 'End') {
			const container = getIsWorldBuilderActive() ? wbChatContainer : chatContainer;
			if (container) {
				e.preventDefault();
				scrollToBottom(container);
			}
		}
	}

	function handleDecisionClick(decision: string) {
		if (getIsBusy()) return;
		const actLineId = getActiveActLineId();
		if (!actLineId) return;
		sendMessage(actLineId, decision);
	}

	async function handleContinueToNextAct() {
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

	function handleEndStory() {
		if (getIsBusy()) return;
		const actLineId = getActiveActLineId();
		if (!actLineId) return;
		runEpilogueFlow(actLineId);
	}

	function isCursorVisible(container: HTMLDivElement | null) {
		if (!container) return false;
		const cursor = container.querySelector('[data-streaming-cursor]');
		if (!cursor) return false;
		const containerRect = container.getBoundingClientRect();
		const cursorRect = cursor.getBoundingClientRect();
		return cursorRect.top <= containerRect.bottom && cursorRect.bottom >= containerRect.top;
	}

	function isWbCursorVisible(container: HTMLDivElement | null) {
		if (!container) return false;
		const cursor = container.querySelector('[data-streaming-cursor]');
		if (!cursor) return false;
		const containerRect = container.getBoundingClientRect();
		const cursorRect = cursor.getBoundingClientRect();
		return cursorRect.top <= containerRect.bottom && cursorRect.bottom >= containerRect.top;
	}

	$effect(() => {
		if (!chatContainer) return;

		const scrollIfCursorVisible = (container: HTMLDivElement) => {
			if (isCursorVisible(container)) {
				scrollToBottom(container);
			}
		};

		const mutationObserver = new MutationObserver((_) => scrollIfCursorVisible(chatContainer!));
		mutationObserver.observe(chatContainer, { childList: true, subtree: true, characterData: true });

		const resizeObserver = new ResizeObserver((_) => scrollIfCursorVisible(chatContainer!));
		resizeObserver.observe(chatContainer);

		return () => {
			mutationObserver.disconnect();
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		if (!wbChatContainer) return;

		const scrollWbIfCursorVisible = (container: HTMLDivElement) => {
			if (isWbCursorVisible(container)) {
				scrollToBottom(container);
			}
		};

		const mutationObserver = new MutationObserver((_) => scrollWbIfCursorVisible(wbChatContainer!));
		mutationObserver.observe(wbChatContainer, { childList: true, subtree: true, characterData: true });

		const resizeObserver = new ResizeObserver((_) => scrollWbIfCursorVisible(wbChatContainer!));
		resizeObserver.observe(wbChatContainer);

		return () => {
			mutationObserver.disconnect();
			resizeObserver.disconnect();
		};
	});

	$effect(() => {
		const isStreaming = getIsStreaming();
		if (wasChatStreaming && !isStreaming && chatContainer) {
			requestAnimationFrame(() => {
				if (chatContainer) scrollToBottom(chatContainer);
			});
		}
		wasChatStreaming = isStreaming;
	});

	$effect(() => {
		const isStreaming = getIsWorldBuilderStreaming();
		if (wasWbStreaming && !isStreaming && wbChatContainer) {
			requestAnimationFrame(() => {
				if (wbChatContainer) scrollToBottom(wbChatContainer);
			});
		}
		wasWbStreaming = isStreaming;
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="flex-1 flex flex-col lg:flex-row min-h-0">
	{#if getIsSelectingStory()}
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<div class="text-surface-500 animate-pulse">{t('chat.loadingStory')}</div>
			</div>
		</div>
	{:else if getIsWorldBuilderActive()}
		<!-- World builder mode -->
		<div class="flex-1 flex flex-col min-h-0 min-w-0">
			<!-- Chat messages area -->
			<div bind:this={wbChatContainer} class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6 min-w-0">
				<div class="px-2 md:px-4 lg:px-8 space-y-3 md:space-y-4">
					<div class="text-center py-4">
						<h2 class="h2 font-display text-surface-700-300 mb-2">{t('chat.worldBuilder')}</h2>
						<p class="text-xs text-surface-500">{t('chat.worldBuilderPrompt')}</p>
					</div>

					{#each getWorldBuilderMessages() as message, i (message.id)}
						{#if message.role === 'user'}
							<div class="flex justify-end">
								<div class="max-w-[90%] md:max-w-[80%] min-w-0 rounded-(--radius-container) bg-primary-100-900 p-3 md:p-5">
									{#if isEditingMessage(message.id)}
										<MessageEditForm
											mode="wb-user"
											messageId={message.id}
											initial={{ content: message.content }}
											onsave={(data) => saveEditWorldBuilderMessage(message, data)}
											oncancel={cancelEdit}
										/>
									{:else}
										<div class="leading-relaxed text-primary-900-100">
											<MarkdownContent content={message.content} />
										</div>
									{/if}
									{#if !getIsWorldBuilderStreaming() && !isEditingMessage(message.id)}
										<div class="flex gap-2 mt-3 pt-3 border-t border-primary-200-800">
											<button
												class="flex items-center gap-1 text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
												title="Edit message"
												onclick={() => startEditMessage(message, false)}
											>
												<Icon name="edit" class="w-3.5 h-3.5" />
												{t('chat.edit')}
											</button>
											<button
												class="flex items-center gap-1 text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
												title="Copy message"
												onclick={() => handleCopy(message.id, message.content)}
											>
												<Icon name="copy" class="w-3.5 h-3.5" />
												{copiedId === message.id ? t('chat.copied') : t('chat.copy')}
											</button>
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<div class="rounded-(--radius-container) bg-surface-50-950 p-3 md:p-5 shadow-message border border-surface-200-800">
								{#if isEditingMessage(message.id)}
									<MessageEditForm
										mode="wb-assistant"
										messageId={message.id}
										initial={{ content: message.content }}
										onsave={(data) => saveEditWorldBuilderMessage(message, data)}
										oncancel={cancelEdit}
									/>
								{:else if message.content}
									<div class="leading-relaxed text-surface-800-200">
										<MarkdownContent content={message.content} {characterNames} />
									</div>
								{/if}
								{#if getIsWorldBuilderStreaming() && message === getWorldBuilderMessages().at(-1)}
									<span
										data-streaming-cursor
										class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm {message.content ? 'mt-2' : ''}"
									></span>
								{/if}
								{#if !getIsWorldBuilderStreaming() && message.content && !isEditingMessage(message.id)}
									<div class="flex gap-2 mt-2 md:mt-3 pt-2 md:pt-3 border-t border-surface-200-800">
										<button
											class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
											title="Edit message"
											onclick={() => startEditMessage(message, false)}
										>
											<Icon name="edit" class="w-3.5 h-3.5" />
											{t('chat.edit')}
										</button>
										<button
											class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
											title="Copy message"
											onclick={() => handleCopy(message.id, message.content)}
										>
											<Icon name="copy" class="w-3.5 h-3.5" />
											{copiedId === message.id ? t('chat.copied') : t('chat.copy')}
										</button>
										{#if i === lastWbMessageIdx}
											<button
												class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
												title="Regenerate response"
												onclick={handleWorldBuilderRegenerate}
											>
												<Icon name="regenerate" class="w-3.5 h-3.5" />
												{t('chat.regenerate')}
											</button>
											<button
												class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-error-500 transition-colors"
												title="Delete last exchange"
												onclick={handleWorldBuilderDelete}
											>
												<Icon name="trash" class="w-3.5 h-3.5" />
												{t('chat.delete')}
											</button>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<ScrollToFAB chatContainer={wbChatContainer} isStreaming={getIsWorldBuilderStreaming()} />

			<!-- Pinned control section -->
			<div class="hidden md:block">
				<WorldBuilderControls
					isComplete={getIsWorldBuilderComplete()}
					storyName={getWorldBuilderStoryName()}
					{showCreateStoryOptions}
					{isCreatingStory}
					{createStoryError}
					worldBuilderError={getWorldBuilderError()}
					isInterviewMode={getActPlotInterview()}
					isGameResumeMode={getGameResumeInterview()}
					hasInterviewMessages={getHasInterviewMessages()}
					isStreaming={getIsWorldBuilderStreaming()}
					showUpdateWorldCardOption={getIsNextActInterview()}
					bind:updateWorldCard={updateWorldCardChecked}
					onCreateStory={handleCreateFromWorldBuilder}
					onStartImmediate={handleCreateStoryImmediate}
					onStartInterview={handleCreateActPlotInterview}
					onStartGame={handleStartGameAfterInterview}
					onCancel={exitWorldBuilderMode}
					onDismissOptions={cancelCreateStoryOptions}
					onRetry={handleCreateStoryImmediate}
					chatContainer={wbChatContainer}
				/>
			</div>

			<!-- Mobile Input Sheet -->
			<div class="md:hidden">
				<MobileInputSheet
					bind:value={input}
					isStreaming={getIsWorldBuilderStreaming()}
					isDisabled={getIsWorldBuilderStreaming() || (getIsWorldBuilderComplete() && !getActPlotInterview())}
					placeholder={t('chat.worldBuilderPlaceholder')}
					showDirectorNotes={false}
					onSubmit={handleSubmit}
					onStop={stopWorldBuilderStreaming}
					onKeydown={handleKeydown}
				/>
			</div>
		</div>

		<!-- Right-side input panel (tablet+ only) -->
		<aside
			class="hidden md:flex lg:w-80 border-t lg:border-t-0 lg:border-l border-surface-200-800 flex-col bg-surface-50-950 shrink-0 {rightPanelExpanded
				? 'max-h-none'
				: 'lg:max-h-none max-h-10'}"
		>
			<!-- Mobile toggle bar -->
			<button
				class="lg:hidden flex w-full items-center justify-between px-3 py-2 text-xs text-surface-500 hover:bg-surface-100-900 transition-colors"
				type="button"
				aria-expanded={rightPanelExpanded}
				onclick={() => (rightPanelExpanded = !rightPanelExpanded)}
			>
				<span class="font-medium text-surface-500 uppercase tracking-wider">{t('chat.worldBuilder')}</span>
				<Icon name="chevron-down" class="h-4 w-4 transition-transform {rightPanelExpanded ? 'rotate-180' : ''}" />
			</button>

			<div class="flex-1 flex flex-col min-h-0 p-3 lg:p-4">
				<div class="hidden lg:flex items-center justify-between mb-3">
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('chat.worldBuilder')}</span>
					<button class="text-xs text-surface-500 hover:text-error-500 transition-colors" type="button" onclick={exitWorldBuilderMode}>
						{t('chat.exit')}
					</button>
				</div>

				<textarea
					class="input flex-1 resize-none text-sm leading-relaxed"
					placeholder={t('chat.worldBuilderPlaceholder')}
					aria-label="World builder input"
					bind:value={input}
					onkeydown={handleKeydown}
					disabled={getIsWorldBuilderStreaming() || (getIsWorldBuilderComplete() && !getActPlotInterview())}
				></textarea>

				<div class="mt-3">
					{#if getIsWorldBuilderStreaming()}
						<Button variant="filled-error" fullWidth onclick={stopWorldBuilderStreaming}>{t('chat.stop')}</Button>
					{:else if !getIsWorldBuilderComplete() || getActPlotInterview()}
						<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> {t('chat.send')} </button>
					{/if}
				</div>
			</div>
		</aside>
	{:else if !getActiveActLineId()}
		<!-- Empty state — no act line selected -->
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<h2 class="h2 font-display text-surface-700-300">{t('chat.noActLineSelected')}</h2>
				<p class="text-surface-400-500 max-w-lg">{t('chat.emptyState')}</p>
			</div>
		</div>
	{:else}
		<!-- Middle column: scrollable chat + pinned controls -->
		<div class="flex-1 flex flex-col min-h-0 min-w-0">
			<!-- Chat messages area -->
			<div bind:this={chatContainer} class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6 min-w-0">
				<div class="px-2 md:px-4 lg:px-8 space-y-3 md:space-y-4">
					{#if getMessages().length === 0}
						<div class="flex flex-col items-center justify-center py-24 text-center">
							<h2 class="h2 font-display text-surface-700-300 mb-3">{t('chat.beginAdventure')}</h2>
							<p class="text-surface-400-500 max-w-lg">{t('chat.emptyChat')}</p>
						</div>
					{:else}
						{#each getMessages() as message, i (message.id)}
							{#if message.role === 'user'}
								<div class="flex justify-end">
									<div class="max-w-[90%] md:max-w-[80%] min-w-0 rounded-(--radius-container) bg-primary-100-900 p-3 md:p-5">
										<div class="leading-relaxed text-primary-900-100 min-w-0">
											<MarkdownContent content={message.content} />
										</div>
										{#if !getIsBusy()}
											<div class="flex gap-2 mt-3 pt-3 border-t border-primary-200-800">
												<button
													class="text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
													title="Copy message"
													onclick={() => handleCopy(message.id, message.content)}
													>{copiedId === message.id ? t('chat.copied') : t('chat.copy')}</button
												>
												{#if i === getMessages().length - 1 && isUserMessage(message)}
													<button
														class="text-xs text-error-500 hover:text-error-700 transition-colors"
														title="Delete message"
														onclick={() => handleDeleteOrphanedUserMessages()}>{t('chat.delete')}</button
													>
												{/if}
											</div>
										{/if}
									</div>
								</div>
							{:else if shouldShowStreamingCursor(message)}
								<span data-streaming-cursor class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm"></span>
							{:else}
								<div class="rounded-(--radius-container) bg-surface-50-950 p-3 md:p-5 shadow-message border border-surface-200-800">
									<!-- Pipeline phase accordions -->
									{#if message.phases && message.phases.length > 0}
										{#each message.phases as phase, pi (pi)}
											<ReasoningAccordion label={formatPhaseName(phase.phaseName)} value={phase.phaseName}>
												{#if phase.reasoning}
													<div class="mb-2 italic text-surface-400">{phase.reasoning}</div>
												{/if}
												<MarkdownContent content={phase.content} />
											</ReasoningAccordion>
										{/each}
									{/if}

									{#if message.reasoning}
										<ReasoningAccordion label={t('chat.reasoning')} value="reasoning">
											{message.reasoning}
										</ReasoningAccordion>
									{/if}

									<!-- Main content: Editor output -->
									{#if isEditingMessage(message.id)}
										<MessageEditForm
											mode="main"
											isTemplated={editingIsTemplated}
											messageId={message.id}
											initial={editingIsTemplated && message.variables
												? {
													variables: {
														sceneTitle: message.variables.sceneTitle ?? '',
														background: message.variables.background ?? '',
														narrativeBody: message.variables.narrativeBody ?? '',
														cg: message.variables.cg ?? '',
													}
												}
												: { content: message.content ?? '' }}
											onsave={(data) => saveEditMainChatMessage(message, data)}
											oncancel={cancelEdit}
										/>
									{:else if message.variables && hasTemplateMetadata(message.variables)}
										<div class="leading-relaxed text-surface-800-200">
											{#if storyMessageTemplate}
												<MarkdownContent
													content={renderTemplate(
														storyMessageTemplate,
														message.variables,
														message.sceneNumber != null ? { sceneNumber: String(message.sceneNumber) } : undefined
													)}
													{characterNames}
													importantPhrases={message.importantPhrases}
												/>
											{:else}
												<MarkdownContent content={message.content} {characterNames} importantPhrases={message.importantPhrases} />
											{/if}
										</div>
									{/if}

									{#if getIsStreaming() && message === getMessages().at(-1)}
										<span data-streaming-cursor class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm mt-2"></span>
									{/if}

									{#if message.metadata}
										<MetadataPanel metadata={message.metadata} />
									{/if}
									{#if !getIsBusy() && !isEditingMessage(message.id) && (message.content || i === lastMessageIdx)}
										<div class="hidden md:flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
											{#if message.content}
												<button
													class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
													title="Copy message"
													onclick={() => handleCopy(message.id, message.content)}
												>
													<Icon name="copy" class="w-3.5 h-3.5" />
													{copiedId === message.id ? t('chat.copied') : t('chat.copy')}
												</button>
											{/if}
											{#if message.variables && hasTemplateMetadata(message.variables) && i === lastMessageIdx}
												<button
													class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
													title="Edit message"
													onclick={() => startEditMessage(message, true)}
												>
													<Icon name="edit" class="w-3.5 h-3.5" />
													{t('chat.edit')}
												</button>
											{/if}
											{#if message.variables && hasTemplateMetadata(message.variables)}
												{#if forkChoiceIndex === i}
													<ForkChoicePanel
														variant="desktop"
														bind:forkPlotMode
														isForking={isForking}
														isBusy={getIsBusy()}
														actions={{
															onForkDirect: () => handleForkDirect(i),
															onForkWithInterview: () => handleForkWithInterview(i),
															onFork: () => handleFork(i),
															onCancel: cancelForkChoice,
														}}
													/>
												{:else}
													<button
														class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
														title="Fork from here"
														disabled={isForking || getIsBusy()}
														onclick={() => handleFork(i)}
													>
														<Icon name="fork" class="w-3.5 h-3.5" />
														{isForking ? t('chat.forking') : t('chat.fork')}
													</button>
												{/if}
											{/if}
											{#if i === lastMessageIdx}
												<button
													class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
													title="Regenerate response"
													onclick={() => handleRegenerate(message.id)}
												>
													<Icon name="regenerate" class="w-3.5 h-3.5" />
													{t('chat.regenerate')}
												</button>
												<button
													class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-error-500 transition-colors"
													title="Delete last exchange"
													onclick={handleDelete}
												>
													<Icon name="trash" class="w-3.5 h-3.5" />
													{t('chat.delete')}
												</button>
											{/if}
										</div>
									{/if}
									{#if !getIsBusy()}
										<div class="md:hidden">
											<MessageActions
												showCopy={!!message.content}
												showEdit={!!(message.variables && hasTemplateMetadata(message.variables) && i === lastMessageIdx)}
												showFork={!!(message.variables && hasTemplateMetadata(message.variables))}
												showRegenerate={i === lastMessageIdx}
												showDelete={i === lastMessageIdx}
												onCopy={() => handleCopy(message.id, message.content)}
												onEdit={message.variables && hasTemplateMetadata(message.variables) && i === lastMessageIdx
													? () => startEditMessage(message, true)
													: undefined}
												onFork={message.variables && hasTemplateMetadata(message.variables) ? () => handleFork(i) : undefined}
												onRegenerate={i === lastMessageIdx ? () => handleRegenerate(message.id) : undefined}
												onDelete={i === lastMessageIdx ? handleDelete : undefined}
											/>
												<ForkChoicePanel
													variant="mobile"
													bind:forkPlotMode
													isForking={isForking}
													isBusy={getIsBusy()}
													actions={{
														onForkDirect: () => handleForkDirect(i),
														onForkWithInterview: () => handleForkWithInterview(i),
														onFork: () => handleFork(i),
														onCancel: cancelForkChoice,
													}}
												/>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
					{/if}

					{#if getError()}
						<div class="rounded-(--radius-container) bg-error-100-900 p-4">
							<p class="text-sm text-error-700-300">{getError()}</p>
						</div>
					{/if}
				</div>
			</div>

			<ScrollToFAB {chatContainer} isStreaming={getIsStreaming()} />

			<!-- Pinned control section -->
			<div class="hidden md:block">
				<ChatControls
					decisions={latestDecisions}
					activePlotThreads={latestActivePlotThreads}
					decisionContext={latestDecisionContext}
					isStreaming={getIsStreaming()}
					isBusy={getIsBusy()}
					actEnded={getActEnded()}
					storyConcluded={getStoryConcluded()}
					onDecisionClick={handleDecisionClick}
					onContinueToNextAct={handleContinueToNextAct}
					onEndStory={handleEndStory}
					{chatContainer}
				/>
			</div>

			<!-- Mobile Choices Sheet -->
			<ChoicesSheet
				decisions={latestDecisions}
				activePlotThreads={latestActivePlotThreads}
				decisionContext={latestDecisionContext}
				actEnded={getActEnded()}
				storyConcluded={getStoryConcluded()}
				isBusy={getIsBusy()}
				onDecisionClick={handleDecisionClick}
				onContinueToNextAct={handleContinueToNextAct}
				onEndStory={handleEndStory}
			/>

			<!-- Mobile Input Sheet -->
			<div class="md:hidden">
				<MobileInputSheet
					bind:value={input}
					isStreaming={getIsStreaming()}
					isDisabled={getIsBusy() || getActEnded()}
					placeholder={t('chat.chatPlaceholder')}
					showDirectorNotes={isDirectorModeEnabled()}
					onSubmit={handleSubmit}
					onStop={stopStreaming}
					onKeydown={handleKeydown}
				/>
			</div>
		</div>

		<!-- Right-side input panel (tablet+ only, desktop side panel) -->
		<aside
			class="hidden md:flex lg:w-80 border-t lg:border-t-0 lg:border-l border-surface-200-800 flex-col bg-surface-50-950 shrink-0 {rightPanelExpanded
				? 'max-h-none'
				: 'lg:max-h-none max-h-10'}"
		>
			<!-- Mobile toggle bar -->
			<button
				class="lg:hidden flex w-full items-center justify-between px-3 py-2 text-xs text-surface-500 hover:bg-surface-100-900 transition-colors"
				type="button"
				aria-expanded={rightPanelExpanded}
				onclick={() => (rightPanelExpanded = !rightPanelExpanded)}
			>
				<span class="font-medium text-surface-500 uppercase tracking-wider">{t('chat.message')}</span>
				<Icon name="chevron-down" class="h-4 w-4 transition-transform {rightPanelExpanded ? 'rotate-180' : ''}" />
			</button>

			<div class="flex-1 flex flex-col min-h-0 p-3 lg:p-4">
				<div class="hidden lg:flex items-center justify-between mb-3">
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('chat.message')}</span>
				</div>
				{#if isDirectorModeEnabled()}
					<DirectorNotesPanel />
				{/if}

				<textarea
					class="input flex-1 resize-none text-sm leading-relaxed"
					placeholder={t('chat.chatPlaceholder')}
					aria-label="Message input"
					bind:value={input}
					onkeydown={handleKeydown}
					disabled={getIsBusy() || getActEnded()}
				></textarea>

				<div class="mt-3">
					{#if getIsStreaming()}
						<Button variant="filled-error" fullWidth onclick={stopStreaming}>{t('chat.stop')}</Button>
					{:else if getActEnded()}
						<Button fullWidth disabled>{t('chat.send')}</Button>
					{:else}
						<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> {t('chat.send')} </button>
					{/if}
				</div>
			</div>
		</aside>
	{/if}
</div>
