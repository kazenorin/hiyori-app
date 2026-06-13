<script lang="ts">
	import {
		deleteLastExchange,
		deleteOrphanedUserMessages,
		getActEnded,
		getCharacterNames,
		getError,
		getIsBusy,
		getIsStreaming,
		getLatestActivePlotThreads,
		getLatestDecisionContext,
		getLatestDecisions,
		getMessages,
		getStoryConcluded,
		isUserMessage,
		regenerateLastResponse,
		sendMessage,
		stopStreaming,
		type UIMessage,
	} from '$lib/ai/chat.svelte';
	import MetadataPanel from '$lib/components/MetadataPanel.svelte';
	import {
		deleteLastWorldBuilderExchange,
		exitWorldBuilderMode,
		getError as getWorldBuilderError,
		getGameResumeInterview,
		getHasInterviewMessages,
		getIsActive as getIsWorldBuilderActive,
		getIsCompilingWorld,
		getIsNextActInterview,
		getIsStreaming as getIsWorldBuilderStreaming,
		getMessages as getWorldBuilderMessages,
		getActPlotInterview,
		getStoryName as getWorldBuilderStoryName,
		getReadyToCreate,
		regenerateLastWorldBuilderResponse,
		sendWorldBuilderMessage,
		stopStreaming as stopWorldBuilderStreaming,
		type WorldBuilderMessage,
		getWbPhase,
	} from '$lib/features/world-builder/world-builder.svelte';
	import {
		getIsCreatingStory,
		getCreateStoryError,
		cancelCreateStoryOptions,
		handleCreateStoryImmediate,
		handleCreateActPlotInterview,
		handleStartFromWorldBuilder,
		handleStartGameAfterInterview,
	} from '$lib/features/world-builder/story-creation.svelte';
	import {
		getIsForking,
		getForkChoiceIndex,
		handleFork,
		handleForkDirect,
		handleForkWithInterview,
		cancelForkChoice,
	} from '$lib/features/fork-controller.svelte';
	import { getRegenerateChoiceIndex, handleRegenerateChoice, cancelRegenerateChoice } from '$lib/features/regenerate-controller.svelte';
	import {
		getEditingIsTemplated,
		isEditingMessage,
		shouldShowStreamingCursor,
		startEditMessage,
		cancelEdit,
		saveEditMainChatMessage,
		saveEditWorldBuilderMessage,
	} from '$lib/features/message-editor.svelte';
	import { getActiveActLineId, getActiveStory, getIsSelectingStory } from '$lib/stores/stories.svelte';
	import { isDirectorModeEnabled, isTTSEnabled, getTTSVoice, getTTSSpeed } from '$lib/stores/settings.svelte';
	import { ttsPlayer } from '$lib/kokoro/player.svelte';
	import { buildTTSPassage } from '$lib/kokoro/passage';
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import ChatControls from '$lib/components/ChatControls.svelte';
	import DirectorNotesPanel from '$lib/components/DirectorNotesPanel.svelte';
	import WorldBuilderControls from '$lib/components/WorldBuilderControls.svelte';
	import { hasTemplateMetadata, renderTemplate } from '$lib/ai/template-renderer';
	import { formatPhaseName } from '$lib/ai/narrative-types';
	import { loadStoryMessageTemplate, loadStoryMessageTemplateForStory } from '$lib/fs/view-templates';

	import { t } from '$lib/i18n';

	import ScrollToFAB from '$lib/components/ScrollToFAB.svelte';
	import MobileInputSheet from '$lib/components/MobileInputSheet.svelte';
	import ChoicesSheet from '$lib/components/ChoicesSheet.svelte';
	import ReasoningAccordion from '$lib/components/chat/ReasoningAccordion.svelte';
	import MessageActions from '$lib/components/chat/MessageActions.svelte';
	import ForkChoicePanel from '$lib/components/chat/ForkChoicePanel.svelte';
	import RegenerateChoicePanel from '$lib/components/chat/RegenerateChoicePanel.svelte';
	import MessageEditForm from '$lib/components/chat/MessageEditForm.svelte';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import { mobileNav } from '$lib/stores/mobile-nav.svelte';
	import { scrollToBottom } from '$lib/utils/scroll';
	import { setupScrollObservers, handleStreamEndScroll } from '$lib/features/auto-scroller.svelte';
	import { handleContinueToNextAct, handleEndStory } from '$lib/features/act-transition.svelte';
	import { toaster } from '$lib/stores/toaster.svelte';

	let input = $state('');
	let chatContainer = $state<HTMLDivElement | null>(null);
	let wbChatContainer = $state<HTMLDivElement | null>(null);
	let copiedId = $state<string | null>(null);
	// eslint-disable-next-line svelte/prefer-writable-derived -- wasChatStreaming depends on its own previous value (stateful observer)
	let wasChatStreaming = $state(false);
	// eslint-disable-next-line svelte/prefer-writable-derived -- wasWbStreaming depends on its own previous value (stateful observer)
	let wasWbStreaming = $state(false);
	let rightPanelExpanded = $state(false);
	let latestDecisions = $derived(getLatestDecisions());
	let latestActivePlotThreads = $derived(getLatestActivePlotThreads());
	let latestDecisionContext = $derived(getLatestDecisionContext());
	let lastMessageIdx = $derived(getMessages().findLastIndex((m: UIMessage) => m.role === 'assistant'));
	let characterNames = $derived(getCharacterNames());
	let storyMessageTemplate = $state<string>('');

	$effect(() => {
		const story = getActiveStory();
		if (story?.locale !== 'en' && ttsPlayer.playingMessageId) {
			ttsPlayer.stop();
		}
	});

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

	let updateWorldCardChecked = $state(false);
	let worldBuilderStoryNameDraft = $state('');

	let forkPlotMode = $state<'guidance' | 'phaseEvent' | null>(null);
	const wbShowPreStartBar = $derived(
		!getReadyToCreate() &&
			!getActPlotInterview() &&
			!(getIsCompilingWorld() || getIsWorldBuilderStreaming()) &&
			getWbPhase() === 'post-template'
	);

	const wbHideMobileInput = $derived(
		(getReadyToCreate() || (getActPlotInterview() && !getIsWorldBuilderStreaming())) && !wbShowPreStartBar
	);

	async function handleCopy(messageId: string, content: string) {
		try {
			await navigator.clipboard.writeText(content);
			copiedId = messageId;
			setTimeout(() => {
				copiedId = null;
			}, 1500);
			toaster.success({ title: t('chat.copied') });
		} catch {
			toaster.error({ title: t('chat.copyFailed') });
		}
	}

	function handleTTS(message: UIMessage): void {
		const passage = buildTTSPassage(message.variables, message.content);
		if (!passage) return;
		const voice = getTTSVoice();
		const speed = getTTSSpeed();
		ttsPlayer.play(passage, message.id, voice, speed);
	}

	const ttsVisible = $derived(getActiveStory()?.locale === 'en');

	async function handleRegenerate(messageId: string) {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		await regenerateLastResponse(actLineId, messageId);
	}

	async function handleRegenerateWithDirection(messageId: string, direction: string) {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		await regenerateLastResponse(actLineId, messageId, direction);
	}

	function openRegenerateChoice(messageIndex: number) {
		cancelForkChoice(() => {
			forkPlotMode = null;
		});
		handleRegenerateChoice(messageIndex);
	}

	function openForkChoice(messageIndex: number) {
		cancelRegenerateChoice();
		handleFork(messageIndex);
	}

	async function handleDelete() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		try {
			await deleteLastExchange(actLineId);
			toaster.success({ title: t('chat.deleteSuccess') });
		} catch {
			toaster.error({ title: t('chat.deleteFailed') });
		}
	}

	async function handleDeleteOrphanedUserMessages() {
		const actLineId = getActiveActLineId();
		if (!actLineId || getIsBusy()) return;
		try {
			await deleteOrphanedUserMessages(actLineId);
			toaster.success({ title: t('chat.deleteSuccess') });
		} catch {
			toaster.error({ title: t('chat.deleteFailed') });
		}
	}

	async function handleWorldBuilderRegenerate() {
		if (getIsWorldBuilderStreaming()) return;
		await regenerateLastWorldBuilderResponse();
	}

	async function handleWorldBuilderDelete() {
		if (getIsWorldBuilderStreaming()) return;
		try {
			await deleteLastWorldBuilderExchange();
			toaster.success({ title: t('chat.deleteSuccess') });
		} catch {
			toaster.error({ title: t('chat.deleteFailed') });
		}
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

	$effect(() => {
		if (!chatContainer) return;
		return setupScrollObservers(chatContainer);
	});

	$effect(() => {
		if (!wbChatContainer) return;
		return setupScrollObservers(wbChatContainer);
	});

	$effect(() => {
		wasChatStreaming = handleStreamEndScroll(chatContainer, wasChatStreaming, getIsStreaming());
	});

	$effect(() => {
		wasWbStreaming = handleStreamEndScroll(wbChatContainer, wasWbStreaming, getIsWorldBuilderStreaming());
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

			<!-- Pinned control section: desktop always, mobile when controls or pre-start bar needed -->
			<div class="{wbShowPreStartBar || wbHideMobileInput ? 'block' : 'hidden'} md:block">
				<WorldBuilderControls
					isReadyToStart={getReadyToCreate()}
					isCompiling={getIsCompilingWorld() || getIsWorldBuilderStreaming()}
					storyName={getWorldBuilderStoryName()}
					bind:storyNameDraft={worldBuilderStoryNameDraft}
					isCreatingStory={getIsCreatingStory()}
					createStoryError={getCreateStoryError()}
					worldBuilderError={getWorldBuilderError()}
					isInterviewMode={getActPlotInterview()}
					isGameResumeMode={getGameResumeInterview()}
					hasInterviewMessages={getHasInterviewMessages()}
					isStreaming={getIsWorldBuilderStreaming()}
					isPreTemplatePhase={getWbPhase() === 'pre-template'}
					showUpdateWorldCardOption={getIsNextActInterview()}
					bind:updateWorldCard={updateWorldCardChecked}
					onStart={() => handleStartFromWorldBuilder(worldBuilderStoryNameDraft)}
					onStartImmediate={() => handleCreateStoryImmediate()}
					onStartInterview={handleCreateActPlotInterview}
					onStartGame={handleStartGameAfterInterview}
					onCancel={exitWorldBuilderMode}
					onDismissOptions={cancelCreateStoryOptions}
					onRetry={getReadyToCreate() ? () => handleCreateStoryImmediate() : () => handleStartFromWorldBuilder(worldBuilderStoryNameDraft)}
					chatContainer={wbChatContainer}
				/>
			</div>

			<!-- Mobile Input Sheet -->
			<div class="md:hidden {wbHideMobileInput ? 'hidden' : ''}">
				<MobileInputSheet
					bind:value={input}
					isStreaming={getIsWorldBuilderStreaming()}
					isDisabled={getIsWorldBuilderStreaming() || (getReadyToCreate() && !getActPlotInterview())}
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
					disabled={getIsWorldBuilderStreaming() || (getReadyToCreate() && !getActPlotInterview())}
				></textarea>

				<div class="mt-3">
					{#if getIsWorldBuilderStreaming()}
						<Button variant="filled-error" fullWidth onclick={stopWorldBuilderStreaming}>{t('chat.stop')}</Button>
					{:else if !getReadyToCreate() || getActPlotInterview()}
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
											isTemplated={getEditingIsTemplated()}
											messageId={message.id}
											initial={getEditingIsTemplated() && message.variables
												? {
														variables: {
															sceneTitle: message.variables.sceneTitle ?? '',
															background: message.variables.background ?? '',
															narrativeBody: message.variables.narrativeBody ?? '',
															cg: message.variables.cg ?? '',
														},
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
											{#if ttsVisible && message.role === 'assistant' && message.content}
												{#if ttsPlayer.playingMessageId === message.id}
													<button
														class="flex items-center gap-1 text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
														title={t('tts.stopReading')}
														onclick={() => ttsPlayer.stop()}
													>
														<Icon name="volume-x" class="w-3.5 h-3.5" />
														{t('tts.stop')}
													</button>
												{:else if isTTSEnabled()}
													<button
														class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
														title={t('tts.readAloud')}
														onclick={() => handleTTS(message)}
													>
														<Icon name="volume-2" class="w-3.5 h-3.5" />
														{t('tts.read')}
													</button>
												{:else}
													<button
														class="flex items-center gap-1 text-xs text-surface-300-600 cursor-not-allowed"
														title={t('tts.enableTtsInSettings')}
														disabled
													>
														<Icon name="volume-2" class="w-3.5 h-3.5" />
														{t('tts.read')}
													</button>
												{/if}
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
												{#if getForkChoiceIndex() === i}
													<ForkChoicePanel
														variant="desktop"
														bind:forkPlotMode
														isForking={getIsForking()}
														isBusy={getIsBusy()}
														actions={{
															onForkDirect: () => handleForkDirect(i),
															onForkWithInterview: () => handleForkWithInterview(i, forkPlotMode),
															onCancel: () =>
																cancelForkChoice(() => {
																	forkPlotMode = null;
																}),
														}}
													/>
												{:else}
													<button
														class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
														title="Fork from here"
														disabled={getIsForking() || getIsBusy()}
														onclick={() => openForkChoice(i)}
													>
														<Icon name="fork" class="w-3.5 h-3.5" />
														{getIsForking() ? t('chat.forking') : t('chat.fork')}
													</button>
												{/if}
											{/if}
											{#if i === lastMessageIdx}
												{#if getRegenerateChoiceIndex() === i}
													<RegenerateChoicePanel
														variant="desktop"
														isBusy={getIsBusy()}
														actions={{
															onTryAgain: () => {
																cancelRegenerateChoice();
																handleRegenerate(message.id);
															},
															onDescribeChanges: (text) => {
																cancelRegenerateChoice();
																handleRegenerateWithDirection(message.id, text);
															},
															onCancel: cancelRegenerateChoice,
														}}
													/>
												{:else}
													<button
														class="flex items-center gap-1 text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
														title="Regenerate response"
														onclick={() => openRegenerateChoice(i)}
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
											{/if}
										</div>
									{/if}
									{#if !getIsBusy()}
										<div class="md:hidden">
											<MessageActions
												showCopy={!!message.content}
												showRead={!!(ttsVisible && message.role === 'assistant' && message.content)}
												isPlaying={ttsPlayer.playingMessageId === message.id}
												ttsEnabled={isTTSEnabled()}
												showEdit={!!(message.variables && hasTemplateMetadata(message.variables) && i === lastMessageIdx)}
												showFork={!!(message.variables && hasTemplateMetadata(message.variables))}
												showRegenerate={i === lastMessageIdx}
												showDelete={i === lastMessageIdx}
												onCopy={() => handleCopy(message.id, message.content)}
												onRead={() => handleTTS(message)}
												onStop={() => ttsPlayer.stop()}
												onEdit={message.variables && hasTemplateMetadata(message.variables) && i === lastMessageIdx
													? () => startEditMessage(message, true)
													: undefined}
												onFork={message.variables && hasTemplateMetadata(message.variables) ? () => openForkChoice(i) : undefined}
												onRegenerate={i === lastMessageIdx && getRegenerateChoiceIndex() !== i ? () => openRegenerateChoice(i) : undefined}
												onDelete={i === lastMessageIdx ? handleDelete : undefined}
											/>
											{#if getForkChoiceIndex() === i}
												<ForkChoicePanel
													variant="mobile"
													bind:forkPlotMode
													isForking={getIsForking()}
													isBusy={getIsBusy()}
													actions={{
														onForkDirect: () => handleForkDirect(i),
														onForkWithInterview: () => handleForkWithInterview(i, forkPlotMode),
														onCancel: () =>
															cancelForkChoice(() => {
																forkPlotMode = null;
															}),
													}}
												/>
											{/if}
											{#if getRegenerateChoiceIndex() === i}
												<RegenerateChoicePanel
													variant="mobile"
													isBusy={getIsBusy()}
													actions={{
														onTryAgain: () => {
															cancelRegenerateChoice();
															handleRegenerate(message.id);
														},
														onDescribeChanges: (text) => {
															cancelRegenerateChoice();
															handleRegenerateWithDirection(message.id, text);
														},
														onCancel: cancelRegenerateChoice,
													}}
												/>
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
