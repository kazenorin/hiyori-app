<script lang="ts">
	import {
		deleteLastExchange,
		deleteOrphanedUserMessages,
		getError,
		getForkSequence,
		getIsStreaming,
		getLatestDecisions,
		getMessages,
		isUserMessage,
		isMemoryPipelineRunning,
		loadActLineMessages,
		regenerateLastResponse,
		sendInitialNarration,
		sendMessage,
		stopStreaming,
	} from '$lib/ai/chat.svelte';
	import {
		deleteLastWorldBuilderExchange,
		enterActPlotInterviewMode,
		exitWorldBuilderMode,
		getActPlotInterview,
		getError as getWorldBuilderError,
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
	} from '$lib/ai/world-builder.svelte';
	import {
		createStoryFromWorldBuilder,
		forkActLine,
		getActiveAct,
		getActiveActLineId,
		getActiveNarrationContext,
		getActiveStory,
		getActiveSystemPrompt,
		getActiveSystemPromptOrDefault,
		getIsSelectingStory,
	} from '$lib/stores/stories.svelte';
	import {Accordion} from '@skeletonlabs/skeleton-svelte';
	import {findLastIndex} from 'lodash';
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import {generateActPlot} from '$lib/ai/act-plot-generator';
	import {getActLine} from '$lib/db/act-lines';
	import {log} from '$lib/logging/logger';
	import type {Story} from "$lib/db/stories";

	let input = $state('');
	let chatContainer = $state<HTMLDivElement | null>(null);
	let wbChatContainer = $state<HTMLDivElement | null>(null);
	let copiedId = $state<string | null>(null);
	let latestDecisions = $derived(getLatestDecisions());
	let lastMessageIdx = $derived(findLastIndex(getMessages(), (m) => m.role === 'assistant'));
	let lastWbMessageIdx = $derived(findLastIndex(getWorldBuilderMessages(), (m) => m.role === 'assistant'));

	// World builder story creation state
	let showCreateStoryOptions = $state(false);
	let isCreatingStory = $state(false);
	let createStoryError = $state<string | null>(null);

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
		await regenerateLastResponse(actLineId, messageId, getActiveNarrationContext(), getActiveSystemPrompt() ?? undefined);
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
		if (!actLineId || !act || getIsStreaming()) return;
		const { branchSeq, name } = await getForkSequence(actLineId, messageIndex);
		const line = await forkActLine(actLineId, branchSeq, act.id, name);
		await loadActLineMessages(line.id);
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
		sendMessage(actLineId, {
			bodyText: text,
			systemPrompt: getActiveSystemPrompt() ?? undefined,
			narrationContent: getActiveNarrationContext(),
		});
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
			await createStoryFromWorldBuilder(name, worldContent);
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
			createStoryError = 'Story creation failed: missing act line or story reference';
			return null;
		}
		return { actLineId, story };
	}

	/**
	 * Generate act plot, exit world builder, and start the game.
	 */
	async function startGame(storyId: string, storyName: string, actLineId: string, worldContent: string): Promise<void> {
		const actLine = await getActLine(actLineId);
		const isMainLine = actLine?.isMainLine ?? true;
		await generateActPlot(storyId, storyName, worldContent, actLineId, isMainLine);

		exitWorldBuilderMode();

		sendInitialNarration(actLineId, getActiveNarrationContext(), getActiveSystemPrompt() ?? undefined)
			.then(() => log.debug('story-creation', 'initial narration sent'));
	}

	async function handleCreateStoryImmediate() {
		isCreatingStory = true;
		createStoryError = null;

		try {
			if (!await ensureStoryCreated()) return;

			const refs = getActLineAndStory();
			if (!refs) {
				isCreatingStory = false;
				return;
			}

			const worldContent = getWorldBuilderContent();
			if (!worldContent) return;

			await startGame(refs.story.id, refs.story.name, refs.actLineId, worldContent);
		} catch (err) {
			createStoryError = err instanceof Error ? err.message : 'Failed to create story';
		} finally {
			isCreatingStory = false;
		}
	}

	async function handleCreateActPlotInterview() {
		isCreatingStory = true;
		createStoryError = null;

		try {
			if (!await ensureStoryCreated()) return;

			const refs = getActLineAndStory();
			if (!refs) {
				isCreatingStory = false;
				return;
			}

			const systemPrompt = await getActiveSystemPromptOrDefault();
			const worldContent = getWorldBuilderContent();
			if (!worldContent) {
				createStoryError = 'World content not available';
				isCreatingStory = false;
				return;
			}
			await enterActPlotInterviewMode(refs.actLineId, systemPrompt, worldContent);
		} catch (err) {
			createStoryError = err instanceof Error ? err.message : 'Failed to start interview';
		} finally {
			isCreatingStory = false;
		}
	}

	async function handleStartGameAfterInterview() {
		const refs = getActLineAndStory();
		if (!refs) return;

		isCreatingStory = true;
		createStoryError = null;

		try {
			await removeLastInterviewAssistantMessage();

			const worldContent = getWorldBuilderContent();
			if (worldContent) {
				await startGame(refs.story.id, refs.story.name, refs.actLineId, worldContent);
			}
		} catch (err) {
			createStoryError = err instanceof Error ? err.message : 'Failed to start game';
		} finally {
			isCreatingStory = false;
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
		sendMessage(actLineId, {
			bodyText: decision,
			systemPrompt: getActiveSystemPrompt() ?? undefined,
			narrationContent: getActiveNarrationContext(),
		});
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
</script>

<div class="flex-1 flex min-h-0">
	{#if getIsSelectingStory()}
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<div class="text-surface-500 animate-pulse">Loading story...</div>
			</div>
		</div>
	{:else if getIsWorldBuilderActive()}
		<!-- World builder mode -->
		<div bind:this={wbChatContainer} class="flex-1 overflow-y-auto p-6">
			<div class="px-8 space-y-4">
				<div class="text-center py-4">
					<h2 class="h2 font-display text-surface-700-300 mb-2">World Builder</h2>
					<p class="text-xs text-surface-500">Answer questions to build your story's world. Say "let's start" when ready.</p>
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
											onclick={() => handleCopy(message.id, message.content)}>{copiedId === message.id ? 'Copied' : 'Copy'}</button
										>
									</div>
								{/if}
							</div>
						</div>
					{:else}
						<div class="rounded-(--radius-container) bg-surface-50-950 p-5 shadow-message">
							{#if message.content}
								<div class="leading-relaxed text-surface-950-50">
									<MarkdownContent content={message.content} />
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
										onclick={() => handleCopy(message.id, message.content)}>{copiedId === message.id ? 'Copied' : 'Copy'}</button
									>
									{#if i === lastWbMessageIdx}
										<button
											class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
											title="Regenerate response"
											onclick={handleWorldBuilderRegenerate}>Regenerate</button
										>
										<button
											class="text-xs text-surface-400-500 hover:text-error-500 transition-colors"
											title="Delete last exchange"
											onclick={handleWorldBuilderDelete}>Delete</button
										>
									{/if}
								</div>
							{/if}
						</div>
					{/if}
				{/each}

				{#if getIsWorldBuilderComplete() && !getActPlotInterview()}
					{#if showCreateStoryOptions}
						<div class="rounded-(--radius-container) bg-primary-100-900 p-6 space-y-4">
							<h3 class="h3 font-display text-primary-900-100 text-center">Create "{getWorldBuilderStoryName()}"?</h3>

							{#if isCreatingStory}
								<div class="flex items-center justify-center gap-3 py-4">
									<span class="inline-block w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"></span>
									<span class="text-sm text-primary-700-300">Creating story and generating plot...</span>
								</div>
							{:else if createStoryError}
								<div class="rounded-lg bg-error-100-900 p-4 mb-2">
									<p class="text-sm text-error-700-300">{createStoryError}</p>
								</div>
								<div class="flex gap-3 justify-center">
									<button class="btn preset-filled-primary-500" type="button" onclick={handleCreateStoryImmediate}> Try Again </button>
									<button class="btn preset-tonal" type="button" onclick={cancelCreateStoryOptions}> Cancel </button>
								</div>
							{:else}
								<div class="flex flex-col gap-3">
									<button
										class="w-full text-left p-4 rounded-lg border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
										type="button"
										onclick={handleCreateStoryImmediate}
									>
										<span class="font-medium text-primary-900-100 mb-1">Start immediately</span><br/>
										<span class="text-sm text-primary-700-300">Create the story and begin your adventure right away.</span>
									</button>
									<button
										class="w-full text-left p-4 rounded-lg border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
										type="button"
										onclick={handleCreateActPlotInterview}
									>
										<span class="font-medium text-primary-900-100 mb-1">Tell us about the story</span><br/>
										<span class="text-sm text-primary-700-300">Discuss the story's direction before starting your adventure.</span>
									</button>
								</div>
								<div class="flex justify-center mt-2">
									<button class="btn preset-tonal" type="button" onclick={cancelCreateStoryOptions}> Cancel </button>
								</div>
							{/if}
						</div>
					{:else}
						<div class="rounded-(--radius-container) bg-primary-100-900 p-6 text-center space-y-4">
							<h3 class="h3 font-display text-primary-900-100">Create "{getWorldBuilderStoryName()}"?</h3>
							<p class="text-sm text-primary-700-300">Your world document is ready. Create the story and start your adventure?</p>
							<div class="flex gap-3 justify-center">
								<button class="btn preset-filled-primary-500" type="button" onclick={handleCreateFromWorldBuilder}> Create Story </button>
								<button class="btn preset-tonal" type="button" onclick={exitWorldBuilderMode}> Cancel </button>
							</div>
						</div>
					{/if}
				{/if}

				{#if getActPlotInterview() && !getIsWorldBuilderStreaming()}
					{#if isCreatingStory}
						<div class="rounded-(--radius-container) bg-success-100-900 p-6 text-center space-y-3">
							<div class="flex items-center justify-center gap-3">
								<span class="inline-block w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"></span>
								<span class="text-sm text-success-700-300">Generating act plot and starting the game...</span>
							</div>
						</div>
					{:else if createStoryError}
						<div class="rounded-(--radius-container) bg-error-100-900 p-4">
							<p class="text-sm text-error-700-300">{createStoryError}</p>
						</div>
					{:else}
						<div class="flex justify-center">
							<button
								class="btn preset-filled-success-500"
								type="button"
								onclick={handleStartGameAfterInterview}
							> Start Game </button>
						</div>
					{/if}
				{/if}

				{#if getWorldBuilderError()}
					<div class="rounded-(--radius-container) bg-error-100-900 p-4">
						<p class="text-sm text-error-700-300">{getWorldBuilderError()}</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Right-side input panel -->
		<aside class="w-80 border-l border-surface-200-800 flex flex-col p-4 bg-surface-50-950">
			<div class="flex items-center justify-between mb-3">
				<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">World Builder</span>
				<button class="text-xs text-surface-500 hover:text-error-500 transition-colors" type="button" onclick={exitWorldBuilderMode}>
					Exit
				</button>
			</div>

			<textarea
				class="input flex-1 resize-none text-sm leading-relaxed"
				placeholder="Describe your world...&#10;&#10;Enter to send, Shift+Enter for new line."
				aria-label="World builder input"
				bind:value={input}
				onkeydown={handleKeydown}
				disabled={getIsWorldBuilderStreaming() || (getIsWorldBuilderComplete() && !getActPlotInterview())}
			></textarea>

			<div class="mt-3">
				{#if getIsWorldBuilderStreaming()}
					<button class="btn preset-filled-error-500 w-full" type="button" onclick={stopWorldBuilderStreaming}> Stop </button>
				{:else if !getIsWorldBuilderComplete() || getActPlotInterview()}
					<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> Send </button>
				{/if}
			</div>
		</aside>
	{:else if !getActiveActLineId()}
		<!-- Empty state — no act line selected -->
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<h2 class="h2 font-display text-surface-700-300">No Act Line Selected</h2>
				<p class="text-surface-400-500 max-w-lg">Create a story, add an act, then select or create an act line to start chatting.</p>
			</div>
		</div>
	{:else}
		<!-- Chat messages area -->
		<div bind:this={chatContainer} class="flex-1 overflow-y-auto p-6">
			<div class="px-8 space-y-4">
				{#if getMessages().length === 0}
					<div class="flex flex-col items-center justify-center py-24 text-center">
						<h2 class="h2 font-display text-surface-700-300 mb-3">Begin Your Adventure</h2>
						<p class="text-surface-400-500 max-w-lg">Type a message to start chatting with the AI.</p>
					</div>
				{:else}
					{#each getMessages() as message, i (message.id)}
						{#if message.role === 'user'}
							<div class="flex justify-end">
								<div class="max-w-[80%] rounded-(--radius-container) bg-primary-100-900 p-5">
									<div class="leading-relaxed text-primary-900-100">
										<MarkdownContent content={message.content} />
									</div>
									{#if !getIsStreaming()}
										<div class="flex gap-2 mt-3 pt-3 border-t border-primary-200-800">
											<button
												class="text-xs text-primary-400-500 hover:text-primary-700-300 transition-colors"
												title="Copy message"
												onclick={() => handleCopy(message.id, message.content)}>{copiedId === message.id ? 'Copied' : 'Copy'}</button
											>
											{#if i === getMessages().length - 1 && isUserMessage(message)}
												<button
													class="text-xs text-error-500 hover:text-error-700 transition-colors"
													title="Delete message"
													onclick={() => handleDeleteOrphanedUserMessages()}>Delete</button
												>
											{/if}
										</div>
									{/if}
								</div>
							</div>
						{:else}
							<div class="rounded-(--radius-container) bg-surface-50-950 p-5 shadow-message">
								{#if message.reasoning}
									<div class="mb-3">
										<Accordion collapsible>
											<Accordion.Item value="reasoning">
												<Accordion.ItemTrigger class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1">
													<span>Reasoning</span>
													<Accordion.ItemIndicator>
														<span class="transition-transform duration-150 text-surface-500">▼</span>
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

								{#if message.draftContent}
									<div class="mb-3">
										<Accordion collapsible>
											<Accordion.Item value="draft">
												<Accordion.ItemTrigger class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1">
													<span>Draft</span>
													<Accordion.ItemIndicator>
														<span class="transition-transform duration-150 text-surface-500">▼</span>
													</Accordion.ItemIndicator>
												</Accordion.ItemTrigger>
												<Accordion.ItemContent>
													{#snippet element(attributes)}
														{#if !attributes.hidden}
															<div
																{...attributes}
																class="text-xs text-surface-500 leading-relaxed border-l-2 border-surface-200-800 pl-3 mt-2"
															>
																<MarkdownContent content={message.draftContent ?? ''} />
															</div>
														{/if}
													{/snippet}
												</Accordion.ItemContent>
											</Accordion.Item>
										</Accordion>
									</div>
								{/if}

								{#if message.reviewScratchpad}
									<div class="mb-3">
										<Accordion collapsible>
											<Accordion.Item value="review">
												<Accordion.ItemTrigger class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1">
													<span>Review</span>
													<Accordion.ItemIndicator>
														<span class="transition-transform duration-150 text-surface-500">▼</span>
													</Accordion.ItemIndicator>
												</Accordion.ItemTrigger>
												<Accordion.ItemContent>
													{#snippet element(attributes)}
														{#if !attributes.hidden}
															<div
																{...attributes}
																class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap border-l-2 border-surface-200-800 pl-3 mt-2"
															>
																{message.reviewScratchpad}
															</div>
														{/if}
													{/snippet}
												</Accordion.ItemContent>
											</Accordion.Item>
										</Accordion>
									</div>
								{/if}

								{#if message.content}
									<div class="leading-relaxed text-surface-950-50">
										<MarkdownContent content={message.content} />
									</div>
								{/if}
								{#if getIsStreaming() && message === getMessages().at(-1)}
									<span
										data-streaming-cursor
										class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm {message.content ? 'mt-2' : ''}"
									></span>
								{/if}
								{#if message.metadata}
									<pre
										class="mt-4 pt-3 border-t border-surface-200-800 text-xs text-surface-500 font-mono leading-relaxed">model:       {message
											.metadata.model}
finish:      {message.metadata.finishReason}
tokens:      {message.metadata.promptTokens} prompt + {message.metadata.completionTokens} completion = {message.metadata.totalTokens} total
duration:    {message.metadata.durationMs}ms</pre>
								{/if}
								{#if !getIsStreaming()}
									<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
										{#if message.content}
											<button
												class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
												title="Copy message"
												onclick={() => handleCopy(message.id, message.content)}>{copiedId === message.id ? 'Copied' : 'Copy'}</button
											>
											<button
												class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
												title="Fork from here"
												onclick={() => handleFork(i)}>Fork</button
											>
										{/if}
										{#if i === lastMessageIdx}
											<button
												class="text-xs text-surface-400-500 hover:text-surface-700-300 transition-colors"
												title="Regenerate response"
												onclick={() => handleRegenerate(message.id)}>Regenerate</button
											>
											<button
												class="text-xs text-surface-400-500 hover:text-error-500 transition-colors"
												title="Delete last exchange"
												onclick={handleDelete}>Delete</button
											>
										{/if}
									</div>
								{/if}
							</div>
						{/if}
					{/each}
				{/if}

				{#if isMemoryPipelineRunning()}
					<div class="max-w-2xl mx-auto mt-4 text-sm text-surface-500 flex items-center gap-2">
						<span class="inline-block w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"></span>
						Processing memories...
					</div>
				{:else if latestDecisions.length > 0 && !getIsStreaming()}
					<div class="max-w-2xl mx-auto space-y-2 mt-4">
						{#each latestDecisions as decision, i (i)}
							<button
								class="btn preset-filled-primary-500 w-full text-left line-clamp-2 whitespace-normal"
								type="button"
								onclick={() => handleDecisionClick(decision)}
							>
								{i + 1}. {decision}
							</button>
						{/each}
					</div>
				{/if}

				{#if getError()}
					<div class="rounded-(--radius-container) bg-error-100-900 p-4">
						<p class="text-sm text-error-700-300">{getError()}</p>
					</div>
				{/if}
			</div>
		</div>

		<!-- Right-side input panel -->
		<aside class="w-80 border-l border-surface-200-800 flex flex-col p-4 bg-surface-50-950">
			<div class="flex items-center justify-between mb-3">
				<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">Message</span>
			</div>

			<textarea
				class="input flex-1 resize-none text-sm leading-relaxed"
				placeholder="Type your message...&#10;&#10;Enter to send, Shift+Enter for new line."
				aria-label="Message input"
				bind:value={input}
				onkeydown={handleKeydown}
				disabled={getIsStreaming() || isMemoryPipelineRunning()}
			></textarea>

			<div class="mt-3">
				{#if isMemoryPipelineRunning()}
					<button class="btn preset-filled-primary-500 w-full opacity-50 cursor-not-allowed" type="button" disabled>
						Processing memories...
					</button>
				{:else if getIsStreaming()}
					<button class="btn preset-filled-error-500 w-full" type="button" onclick={stopStreaming}> Stop </button>
				{:else}
					<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}> Send </button>
				{/if}
			</div>
		</aside>
	{/if}
</div>
