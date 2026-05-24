<script lang="ts">
	import {
		clearMessages,
		deleteLastExchange,
		deleteOrphanedUserMessages,
		getActEnded,
		getCharacterNames,
		getError,
		getForkSequence,
		getIsStreaming,
		getLatestActivePlotThreads,
		getLatestDecisionContext,
		getLatestDecisions,
		getMessages,
		getStoryConcluded,
		isUserMessage,
		loadActLineMessages,
		regenerateLastResponse,
		resetActEnded,
		runEpilogueFlow,
		sendInitialNarration,
		sendMessage,
		stopStreaming,
		type UIMessage,
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
		getIsStreaming as getIsWorldBuilderStreaming,
		getMessages as getWorldBuilderMessages,
		getStoryName as getWorldBuilderStoryName,
		getWorldContent as getWorldBuilderContent,
		regenerateLastWorldBuilderResponse,
		removeLastInterviewAssistantMessage,
		sendWorldBuilderMessage,
		stopStreaming as stopWorldBuilderStreaming,
		type WorldBuilderMessage,
		type NewActInterviewContext,
	} from '$lib/features/world-builder/world-builder.svelte';
	import {
		createAct,
		createActLine,
		createStoryFromWorldBuilder,
		forkActLine,
		forkActLineForInterview,
		getActiveAct,
		getActiveActLineId,
		getActiveStory,
		getActiveDirectorNotesText,
		getIsSelectingStory,
		setActPlotGenerationPhase,
		selectActLine,
	} from '$lib/stores/stories.svelte';
	import { settings, isDirectorModeEnabled } from '$lib/stores/settings.svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import ChatControls from '$lib/components/ChatControls.svelte';
	import DirectorNotesPanel from '$lib/components/DirectorNotesPanel.svelte';
	import WorldBuilderControls from '$lib/components/WorldBuilderControls.svelte';
	import { hasTemplateMetadata, renderTemplate } from '$lib/ai/template-renderer';
	import { emptyVariables, type NarrativeVariables } from '$lib/ai/narrative-types';
	import { formatPhaseName } from '$lib/ai/narrative-types';
	import { loadStoryMessageTemplate } from '$lib/fs/view-templates';
	import { ensureActPlot } from '$lib/ai/act-plot';
	import { getActLine, getMessagesForLine } from '$lib/db/act-lines';
	import { log } from '$lib/logging/logger';
	import { generateTurnOfEvents } from '$lib/features/turn-of-events-generator';
	import { type Message, updateMessageFields } from '$lib/db/messages';
	import { type GameDataRegenerationContext, regenerateGameData } from '$lib/ai/game-data-regenerator';
	import type { Story } from '$lib/db/stories';
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import {loadStoryWorldContent} from "$lib/fs/story-folders";

	let input = $state('');
	let chatContainer = $state<HTMLDivElement | null>(null);
	let wbChatContainer = $state<HTMLDivElement | null>(null);
	let copiedId = $state<string | null>(null);
	let wasChatStreaming = $state(false);
	let wasWbStreaming = $state(false);
	let latestDecisions = $derived(getLatestDecisions());
	let latestActivePlotThreads = $derived(getLatestActivePlotThreads());
	let latestDecisionContext = $derived(getLatestDecisionContext());
	let lastMessageIdx = $derived(getMessages().findLastIndex((m: UIMessage) => m.role === 'assistant'));
	let characterNames = $derived(getCharacterNames());
	let storyMessageTemplate = $state<string>('');

	// Preload template on mount
	onMount(() => {
		loadStoryMessageTemplate()
			.then((tmpl) => {
				storyMessageTemplate = tmpl;
			})
			.catch(() => {});
	});
	let lastWbMessageIdx = $derived(getWorldBuilderMessages().findLastIndex((m: WorldBuilderMessage) => m.role === 'assistant'));

	// World builder story creation state
	let showCreateStoryOptions = $state(false);
	let isCreatingStory = $state(false);
	let createStoryError = $state<string | null>(null);
	let isForking = $state(false);
	let forkChoiceIndex = $state<number | null>(null);
	let forkPlotMode = $state<'guidance' | 'phaseEvent' | null>(null);

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

	async function handleRegenerate(messageId: string) {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsStreaming()) return;
		await regenerateLastResponse(actLineId, messageId);
	}

	async function handleDelete() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsStreaming()) return;
		await deleteLastExchange(actLineId);
	}

	async function handleDeleteOrphanedUserMessages() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsStreaming()) return;
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
		if (!actLineId || !act || getIsStreaming() || isForking) return;
		forkChoiceIndex = messageIndex;
	}

	async function handleForkDirect(messageIndex: number) {
		const actLineId = getActiveActLineId();
		const act = getActiveAct();
		if (!actLineId || !act || getIsStreaming() || isForking) return;
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
		if (!actLineId || !act || !story || getIsStreaming() || isForking) return;

		const worldContent = await loadStoryWorldContent(story.id, story.name);
		if (!worldContent) return;

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

			await enterActPlotInterviewMode(line.id, worldContent, { actSummary, narrativeBody, sceneNumber, sceneTitle });
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
		if (!text || getIsStreaming() || getIsWorldBuilderStreaming()) return;

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
			await enterActPlotInterviewMode(refs.actLineId, worldContent);
		} catch (err) {
			createStoryError = err instanceof Error ? err.message : t('errors.failedToStartInterview');
		} finally {
			isCreatingStory = false;
		}
	}

	async function handleStartGameAfterInterview(isGameResumeMode: boolean, actNumber: number = 1) {
		const refs = getActLineAndStory();
		if (!refs) return;
		createStoryError = null;
		const actLine = await getActLine(refs.actLineId);
		if (!actLine) {
			createStoryError = t('errors.storyCreationFailed');
			return;
		}

		isCreatingStory = true;
		try {
			await removeLastInterviewAssistantMessage();

			const worldContent = getWorldBuilderContent();
			if (worldContent) {
				let forkedMessage: Message | undefined = undefined;
				if (isGameResumeMode) {
					forkedMessage = await enrichForkedMessageWithTurnOfEvents(refs.actLineId);
				}

				const actPlotContent = await ensureActPlot({
					worldContent,
					story: refs.story,
					actNumber,
					actLine,
					isResumeGame: isGameResumeMode,
					onPhaseChange: setActPlotGenerationPhase,
					onGenerationComplete: () => setActPlotGenerationPhase(null),
				});

				if (forkedMessage) {
					await regenerateGameDataForForkedMessage(forkedMessage.id, {
						worldContent,
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

	async function enrichForkedMessageWithTurnOfEvents(actLineId: string): Promise<Message | undefined> {
		const lineMessages = await getMessagesForLine(actLineId);
		const lastAssistant = lineMessages.findLast((m) => m.role === 'assistant');
		if (!lastAssistant || !lastAssistant.variables?.narrativeBody) return undefined;

		const interviewMessages = getWorldBuilderMessages();
		if (interviewMessages.length === 0) return undefined;

		const turnOfEventsText = await generateTurnOfEvents({
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

	function handleDecisionClick(decision: string) {
		if (getIsStreaming()) return;
		const actLineId = getActiveActLineId();
		if (!actLineId) return;
		sendMessage(actLineId, decision);
	}

	async function handleContinueToNextAct() {
		if (getIsStreaming()) return;
		const actLineId = getActiveActLineId();
		if (!actLineId) return;

		const story = getActiveStory();
		const actLine = await getActLine(actLineId);
		if (!story || !actLine || !actLine.endingType) return;

		const act = getActiveAct();
		if (!act) return;

		const actSummary = getMessages().findLast((m) => m.role === 'assistant')?.actSummary ?? '';
		const worldContent = (await loadStoryWorldContent(story.id, story.name)) ?? '';
		const actPlot = await ensureActPlot({
			worldContent,
			story,
			actNumber: act.actNumber,
			actLine,
		});

		try {
			resetActEnded();
			await clearMessages();
			const newAct = await createAct(story.id, t('common.actLabel', { n: act.actNumber + 1 }), actLineId);
			const newLine = await createActLine(newAct.id, 'Main');
			await selectActLine(newLine.id);

			const newActContext: NewActInterviewContext = {
				endingType: actLine.endingType,
				actSummary,
				actPlot,
			};

			await enterActPlotInterviewMode(newLine.id, worldContent, undefined, undefined, newActContext);
		} catch (err) {
			await log.error('continue-to-next-act', 'Failed to start next act', err);
		}
	}

	function handleEndStory() {
		if (getIsStreaming()) return;
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
				container.scrollTop = container.scrollHeight;
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
				container.scrollTop = container.scrollHeight;
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
				chatContainer!.scrollTop = chatContainer!.scrollHeight;
			});
		}
		wasChatStreaming = isStreaming;
	});

	$effect(() => {
		const isStreaming = getIsWorldBuilderStreaming();
		if (wasWbStreaming && !isStreaming && wbChatContainer) {
			requestAnimationFrame(() => {
				wbChatContainer!.scrollTop = wbChatContainer!.scrollHeight;
			});
		}
		wasWbStreaming = isStreaming;
	});
</script>

<div class="flex-1 flex min-h-0">
	{#if getIsSelectingStory()}
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<div class="text-surface-500 animate-pulse">{t('chat.loadingStory')}</div>
			</div>
		</div>
	{:else if getIsWorldBuilderActive()}
		<!-- World builder mode -->
		<div class="flex-1 flex flex-col min-h-0 min-w-0">
			<div bind:this={wbChatContainer} class="flex-1 overflow-y-auto p-6 min-w-0">
				<div class="px-8 space-y-4">
					<div class="text-center py-4">
						<h2 class="h2 font-display text-surface-700-300 mb-2">{t('chat.worldBuilder')}</h2>
						<p class="text-xs text-surface-500">{t('chat.worldBuilderPrompt')}</p>
					</div>

					{#each getWorldBuilderMessages() as message, i (message.id)}
						{#if message.role === 'user'}
							<div class="flex justify-end">
								<div class="max-w-[80%] rounded-(--radius-container) bg-primary-100-900 p-5">
									<div class="leading-relaxed text-primary-900-100">
										<MarkdownContent content={message.content} />
									</div>
									{#if !getIsWorldBuilderStreaming()}
										<div class="flex gap-2 mt-3 pt-3 border-t border-primary-200-800">
											<button
												class="text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
												title="Copy message"
												onclick={() => handleCopy(message.id, message.content)}
												>{copiedId === message.id ? t('chat.copied') : t('chat.copy')}</button
											>
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<div class="rounded-(--radius-container) bg-surface-50-950 p-5 shadow-message border border-surface-200-800">
								{#if message.content}
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
								{#if !getIsWorldBuilderStreaming() && message.content}
									<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
										<button
											class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
											title="Copy message"
											onclick={() => handleCopy(message.id, message.content)}
											>{copiedId === message.id ? t('chat.copied') : t('chat.copy')}</button
										>
										{#if i === lastWbMessageIdx}
											<button
												class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
												title="Regenerate response"
												onclick={handleWorldBuilderRegenerate}>{t('chat.regenerate')}</button
											>
											<button
												class="text-xs text-surface-400-500 hover:text-error-500 transition-colors"
												title="Delete last exchange"
												onclick={handleWorldBuilderDelete}>{t('chat.delete')}</button
											>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>

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

		<!-- Right-side input panel -->
		<aside class="w-80 border-l border-surface-200-800 flex flex-col p-4 bg-surface-50-950">
			<div class="flex items-center justify-between mb-3">
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
					<button class="btn preset-filled-error-500 w-full" type="button" onclick={stopWorldBuilderStreaming}> {t('chat.stop')} </button>
				{:else if !getIsWorldBuilderComplete() || getActPlotInterview()}
					<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> {t('chat.send')} </button>
				{/if}
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
			<div bind:this={chatContainer} class="flex-1 overflow-y-auto p-6 min-w-0">
				<div class="px-8 space-y-4">
					{#if getMessages().length === 0}
						<div class="flex flex-col items-center justify-center py-24 text-center">
							<h2 class="h2 font-display text-surface-700-300 mb-3">{t('chat.beginAdventure')}</h2>
							<p class="text-surface-400-500 max-w-lg">{t('chat.emptyChat')}</p>
						</div>
					{:else}
						{#each getMessages() as message, i (message.id)}
							{#if message.role === 'user'}
								<div class="flex justify-end">
									<div class="max-w-[80%] min-w-0 rounded-(--radius-container) bg-primary-100-900 p-5">
										<div class="leading-relaxed text-primary-900-100 min-w-0">
											<MarkdownContent content={message.content} />
										</div>
										{#if !getIsStreaming()}
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
							{:else}
								<div class="rounded-(--radius-container) bg-surface-50-950 p-5 shadow-message border border-surface-200-800">
									<!-- Pipeline phase accordions -->
									{#if message.phases && message.phases.length > 0}
										{#each message.phases as phase, pi (pi)}
											<div class="mb-3">
												<Accordion collapsible>
													<Accordion.Item value={phase.phaseName}>
														<Accordion.ItemTrigger
															class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1"
														>
															<span>{formatPhaseName(phase.phaseName)}</span>
															<Accordion.ItemIndicator>
																<span class="transition-transform duration-150 text-surface-500">&#9660;</span>
															</Accordion.ItemIndicator>
														</Accordion.ItemTrigger>
														<Accordion.ItemContent>
															{#snippet element(attributes)}
																{#if !attributes.hidden}
																	<div
																		{...attributes}
																		class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap border-l-2 border-surface-200-800 pl-3 mt-2"
																	>
																		{#if phase.reasoning}
																			<div class="mb-2 italic text-surface-400">{phase.reasoning}</div>
																		{/if}
																		<MarkdownContent content={phase.content} />
																	</div>
																{/if}
															{/snippet}
														</Accordion.ItemContent>
													</Accordion.Item>
												</Accordion>
											</div>
										{/each}
									{/if}

									<!-- Editor reasoning -->
									{#if message.reasoning}
										<div class="mb-3">
											<Accordion collapsible>
												<Accordion.Item value="reasoning">
													<Accordion.ItemTrigger class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1">
														<span>{t('chat.reasoning')}</span>
														<Accordion.ItemIndicator>
															<span class="transition-transform duration-150 text-surface-500">&#9660;</span>
														</Accordion.ItemIndicator>
													</Accordion.ItemTrigger>
													<Accordion.ItemContent>
														{#snippet element(attributes)}
															{#if !attributes.hidden}
																<div
																	{...attributes}
																	class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap border-l-2 border-surface-200-800 pl-3 mt-2"
																>
																	{message.reasoning}
																</div>
															{/if}
														{/snippet}
													</Accordion.ItemContent>
												</Accordion.Item>
											</Accordion>
										</div>
									{/if}

									<!-- Main content: Editor output -->
									{#if message.variables && hasTemplateMetadata(message.variables)}
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
										<span
											data-streaming-cursor
											class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm {message.content ||
											hasTemplateMetadata(message.variables)
												? 'mt-2'
												: ''}"
										></span>
									{/if}

									{#if message.metadata}
										<MetadataPanel metadata={message.metadata} />
									{/if}
									{#if !getIsStreaming()}
										<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
											{#if message.content}
												<button
													class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
													title="Copy message"
													onclick={() => handleCopy(message.id, message.content)}
													>{copiedId === message.id ? t('chat.copied') : t('chat.copy')}</button
												>
												{#if forkChoiceIndex === i}
													<div class="flex gap-2 items-center">
														<button
															class="text-xs bg-surface-100-800 hover:bg-surface-200-700 text-primary-500 px-2 py-1 rounded transition-colors"
															onclick={() => handleForkDirect(i)}>{t('chat.keepCurrentPlot')}</button
														>
														<button
															class="text-xs bg-surface-100-800 hover:bg-surface-200-700 text-primary-500 px-2 py-1 rounded transition-colors"
															onclick={() => handleForkWithInterview(i)}>{t('chat.tellUsWhatsDifferent')}</button
														>
														<button
															class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
															onclick={cancelForkChoice}>{t('chat.cancel')}</button
														>
													</div>
													<div class="flex gap-2 items-center mt-1">
														<span class="text-xs text-surface-400-500">{t('chat.plotMode')}:</span>
														<button
															class="text-xs {forkPlotMode === null
																? 'bg-primary-500 text-white'
																: 'bg-surface-100-800 text-surface-700-300 hover:bg-surface-200-700'} px-2 py-0.5 rounded transition-colors"
															onclick={() => (forkPlotMode = null)}>{t('chat.keepCurrentMode')}</button
														>
														<button
															class="text-xs {forkPlotMode === 'guidance'
																? 'bg-primary-500 text-white'
																: 'bg-surface-100-800 text-surface-700-300 hover:bg-surface-200-700'} px-2 py-0.5 rounded transition-colors"
															onclick={() => (forkPlotMode = 'guidance')}>{t('chat.switchToGuidance')}</button
														>
														<button
															class="text-xs {forkPlotMode === 'phaseEvent'
																? 'bg-primary-500 text-white'
																: 'bg-surface-100-800 text-surface-700-300 hover:bg-surface-200-700'} px-2 py-0.5 rounded transition-colors"
															onclick={() => (forkPlotMode = 'phaseEvent')}>{t('chat.switchToPhaseEvent')}</button
														>
													</div>
												{:else}
													<button
														class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
														title="Fork from here"
														disabled={isForking || getIsStreaming()}
														onclick={() => handleFork(i)}>{isForking ? t('chat.forking') : t('chat.fork')}</button
													>
												{/if}
											{/if}
											{#if i === lastMessageIdx}
												<button
													class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
													title="Regenerate response"
													onclick={() => handleRegenerate(message.id)}>{t('chat.regenerate')}</button
												>
												<button
													class="text-xs text-surface-400-500 hover:text-error-500 transition-colors"
													title="Delete last exchange"
													onclick={handleDelete}>{t('chat.delete')}</button
												>
											{/if}
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

			<!-- Pinned control section -->
			<ChatControls
				decisions={latestDecisions}
				activePlotThreads={latestActivePlotThreads}
				decisionContext={latestDecisionContext}
				isStreaming={getIsStreaming()}
				actEnded={getActEnded()}
				storyConcluded={getStoryConcluded()}
				onDecisionClick={handleDecisionClick}
				onContinueToNextAct={handleContinueToNextAct}
				onEndStory={handleEndStory}
				{chatContainer}
			/>
		</div>

		<!-- Right-side input panel -->
		<aside class="w-80 border-l border-surface-200-800 flex flex-col p-4 bg-surface-50-950">
			{#if isDirectorModeEnabled()}
				<DirectorNotesPanel />
			{/if}
			<div class="flex items-center justify-between mb-3">
				<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('chat.message')}</span>
			</div>

			<textarea
				class="input flex-1 resize-none text-sm leading-relaxed"
				placeholder={t('chat.chatPlaceholder')}
				aria-label="Message input"
				bind:value={input}
				onkeydown={handleKeydown}
				disabled={getIsStreaming() || getActEnded()}
			></textarea>

			<div class="mt-3">
				{#if getIsStreaming()}
					<button class="btn preset-filled-error-500 w-full" type="button" onclick={stopStreaming}> {t('chat.stop')} </button>
				{:else if getActEnded()}
					<button class="btn preset-tonal w-full" type="button" disabled> {t('chat.send')} </button>
				{:else}
					<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> {t('chat.send')} </button>
				{/if}
			</div>
		</aside>
	{/if}
</div>
