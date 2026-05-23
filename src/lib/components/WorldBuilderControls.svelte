<script lang="ts">
	import { slide } from 'svelte/transition';
	import { t } from '$lib/i18n';

	interface Props {
		isComplete: boolean;
		storyName: string | null;
		showCreateStoryOptions: boolean;
		isCreatingStory: boolean;
		createStoryError: string | null;
		worldBuilderError: string | null;
		isInterviewMode: boolean;
		isGameResumeMode: boolean;
		hasInterviewMessages: boolean;
		isStreaming: boolean;
		onCreateStory: () => void;
		onStartImmediate: () => void;
		onStartInterview: () => void;
		onStartGame: (isGameResumeMode: boolean) => void;
		onCancel: () => void;
		onDismissOptions: () => void;
		onRetry: () => void;
		chatContainer: HTMLDivElement | null;
	}

	let {
		isComplete,
		storyName,
		showCreateStoryOptions,
		isCreatingStory,
		createStoryError,
		worldBuilderError,
		isInterviewMode,
		isGameResumeMode,
		hasInterviewMessages,
		isStreaming,
		onCreateStory,
		onStartImmediate,
		onStartInterview,
		onStartGame,
		onCancel,
		onDismissOptions,
		onRetry,
		chatContainer,
	}: Props = $props();

	const SCROLL_BOTTOM_THRESHOLD_PX = 5;

	let isPinned = $state(false);
	let isUserExpanded = $state(false);
	let isNearBottom = $state(true);
	let isManuallyClosed = $state(false);
	let layoutTransitioning = $state(false);
	let layoutTimeout: ReturnType<typeof setTimeout> | undefined;

	let isMinimized = $derived(!isPinned && (!isNearBottom || isManuallyClosed) && !isUserExpanded);

	let hasContent = $derived(
		(isComplete && !isInterviewMode) || (isInterviewMode && !isStreaming) || createStoryError != null || worldBuilderError != null
	);

	let summaryText = $derived.by(() => {
		if (createStoryError) return t('components.worldBuilderControls.errorCreatingStory');
		if (worldBuilderError) return t('components.worldBuilderControls.worldBuilderError');
		if (isInterviewMode && !isStreaming) {
			if (hasInterviewMessages) return t('components.worldBuilderControls.readyToStartGame');
			return t('components.worldBuilderControls.interviewMode');
		}
		if (isComplete && !isInterviewMode) {
			if (showCreateStoryOptions) return t('components.worldBuilderControls.storyCreationOptions');
			return storyName
				? t('components.worldBuilderControls.createStoryPrompt', { name: storyName })
				: t('components.worldBuilderControls.createStoryDefault');
		}
		return '';
	});

	function startLayoutTransition(scrollToBottomAfter: boolean) {
		layoutTransitioning = true;
		clearTimeout(layoutTimeout);
		layoutTimeout = setTimeout(() => {
			if (scrollToBottomAfter && chatContainer) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
				isNearBottom = true;
			}
			layoutTransitioning = false;
		}, 300);
	}

	$effect(() => {
		const container = chatContainer;
		if (!container) return;

		isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;

		let rafId = 0;

		const onScroll = () => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				if (layoutTransitioning) return;
				const wasNearBottom = isNearBottom;
				isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
				if (isNearBottom && !wasNearBottom) {
					isUserExpanded = false;
					startLayoutTransition(true);
					isManuallyClosed = false;
				} else if (!isNearBottom && wasNearBottom) {
					startLayoutTransition(false);
				}
			});
		};

		const onClick = (e: MouseEvent) => {
			const target = e.target as HTMLElement;
			if (target.closest('button')) return;
			isUserExpanded = false;
			isPinned = false;
			isManuallyClosed = true;
		};

		container.addEventListener('scroll', onScroll, { passive: true });
		container.addEventListener('click', onClick);
		return () => {
			cancelAnimationFrame(rafId);
			clearTimeout(layoutTimeout);
			layoutTransitioning = false;
			container.removeEventListener('scroll', onScroll);
			container.removeEventListener('click', onClick);
		};
	});

	$effect(() => {
		if (isStreaming) {
			isUserExpanded = false;
			isManuallyClosed = false;
			layoutTransitioning = false;
			clearTimeout(layoutTimeout);
		}
	});

	$effect(() => {
		if (hasContent) {
			isUserExpanded = false;
			isManuallyClosed = false;
			if (chatContainer) {
				isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
			}
		}
	});
</script>

{#if hasContent && !isStreaming}
	<div class="border-t border-surface-200-800 bg-surface-50-950">
		{#if isMinimized}
			<button
				transition:slide={{ duration: 200 }}
				class="flex w-full items-center justify-center gap-2 px-4 py-2 text-sm text-surface-500 hover:bg-surface-100-900 transition-colors"
				type="button"
				aria-expanded="false"
				onclick={() => {
					isUserExpanded = true;
					isManuallyClosed = false;
					startLayoutTransition(true);
				}}
			>
				<span class="truncate">{summaryText}</span>
				<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
					<path
						fill-rule="evenodd"
						d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
						clip-rule="evenodd"
					/>
				</svg>
			</button>
		{:else}
			<div transition:slide={{ duration: 200 }} aria-expanded="true">
				<div class="flex items-start justify-between px-8 pt-3">
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.worldBuilderControls.controls')}</span>
					<button
						class="btn btn-sm variant-ghost text-surface-500"
						type="button"
						onclick={() => (isPinned = !isPinned)}
						aria-label={isPinned ? 'Unpin controls' : 'Pin controls'}
					>
						{#if isPinned}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
								<path
									d="M9.854 2.354a.5.5 0 00-.708 0l-1.5 1.5a.5.5 0 000 .708L9.5 6.914l-5.354 5.354a.5.5 0 000 .708l2 2a.5.5 0 00.708 0L12.086 9.5l2.352 2.354a.5.5 0 00.708 0l1.5-1.5a.5.5 0 000-.708L14.414 7.5l2.352-2.354a.5.5 0 000-.708l-2-2a.5.5 0 00-.708 0L11.5 4.586 9.854 2.354z"
								/>
							</svg>
						{:else}
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
								<path
									d="M10 2a.75.75 0 01.75.75v1.5h3.5a.75.75 0 010 1.5h-.444l-.5 6h.444a.75.75 0 010 1.5h-3v5.25a.75.75 0 01-1.5 0V13.25h-3a.75.75 0 010-1.5h.444l-.5-6H5.75a.75.75 0 010-1.5h3.5v-1.5A.75.75 0 0110 2z"
								/>
							</svg>
						{/if}
					</button>
				</div>
				<div class="space-y-2 px-8 pb-3">
					{#if worldBuilderError}
						<div class="rounded-(--radius-container) bg-error-100-900 p-4 mb-2">
							<p class="text-sm text-error-700-300">{worldBuilderError}</p>
						</div>
					{/if}
					{#if createStoryError}
						<div class="rounded-(--radius-container) bg-error-100-900 p-4 mb-2">
							<p class="text-sm text-error-700-300">{createStoryError}</p>
						</div>
						<div class="flex gap-3 justify-center">
							<button class="btn preset-filled-primary-500" type="button" onclick={onRetry}>
								{t('components.worldBuilderControls.tryAgain')}
							</button>
							<button class="btn preset-tonal" type="button" onclick={onDismissOptions}>
								{t('components.worldBuilderControls.cancel')}
							</button>
						</div>
					{:else if isInterviewMode}
						{#if isCreatingStory}
							<div class="rounded-(--radius-container) bg-success-100-900 p-6 text-center space-y-3">
								<div class="flex items-center justify-center gap-3">
									<span class="inline-block w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"></span>
									<span class="text-sm text-success-700-300">{t('components.worldBuilderControls.generatingPlot')}</span>
								</div>
							</div>
						{:else}
							<div class="flex justify-center">
								<button class="btn preset-filled-success-500" type="button" onclick={() => onStartGame(isGameResumeMode)}>
									{t('components.worldBuilderControls.startGame')}
								</button>
							</div>
						{/if}
					{:else if isComplete && !isInterviewMode}
						{#if showCreateStoryOptions}
							<div class="rounded-(--radius-container) bg-primary-100-900 p-6 space-y-4">
								<h3 class="h3 font-display text-primary-900-100 text-center">Create "{storyName ?? 'Story'}"?</h3>
								{#if isCreatingStory}
									<div class="flex items-center justify-center gap-3 py-4">
										<span class="inline-block w-4 h-4 border-2 border-surface-400 border-t-transparent rounded-full animate-spin"></span>
										<span class="text-sm text-primary-700-300">{t('components.worldBuilderControls.creatingStory')}</span>
									</div>
								{:else}
									<div class="flex flex-col gap-3">
										<button
											class="w-full text-left p-4 rounded-(--radius-container) border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
											type="button"
											onclick={onStartImmediate}
										>
											<span class="font-medium text-primary-900-100 mb-1">{t('components.worldBuilderControls.startImmediately')}</span><br
											/>
											<span class="text-sm text-primary-700-300">{t('components.worldBuilderControls.createStoryDescription')}</span>
										</button>
										<button
											class="w-full text-left p-4 rounded-(--radius-container) border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
											type="button"
											onclick={onStartInterview}
										>
											<span class="font-medium text-primary-900-100 mb-1">{t('components.worldBuilderControls.tellUsAboutStory')}</span><br
											/>
											<span class="text-sm text-primary-700-300">{t('components.worldBuilderControls.discussDirectionDescription')}</span>
										</button>
									</div>
									<div class="flex justify-center mt-2">
										<button class="btn preset-tonal" type="button" onclick={onDismissOptions}>
											{t('components.worldBuilderControls.cancel')}
										</button>
									</div>
								{/if}
							</div>
						{:else}
							<div class="rounded-(--radius-container) bg-primary-100-900 p-6 text-center space-y-4">
								<h3 class="h3 font-display text-primary-900-100">
									{t('components.worldBuilderControls.createStoryPrompt', {
										name: storyName ?? t('components.worldBuilderControls.createStoryDefault'),
									})}
								</h3>
								<p class="text-sm text-primary-700-300">{t('components.worldBuilderControls.worldReadyPrompt')}</p>
								<div class="flex gap-3 justify-center">
									<button class="btn preset-filled-primary-500" type="button" onclick={onCreateStory}>
										{t('components.worldBuilderControls.createStory')}
									</button>
									<button class="btn preset-tonal" type="button" onclick={onCancel}> {t('components.worldBuilderControls.cancel')}</button>
								</div>
							</div>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
