<script lang="ts">
	import { slide as svelteSlide } from 'svelte/transition';
	import { t } from '$lib/i18n';
	import { scrollToBottom } from '$lib/utils/scroll';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	interface Props {
		isReadyToStart: boolean;
		isCompiling: boolean;
		storyName: string | null;
		storyNameDraft: string;
		isCreatingStory: boolean;
		createStoryError: string | null;
		worldBuilderError: string | null;
		isInterviewMode: boolean;
		isGameResumeMode: boolean;
		hasInterviewMessages: boolean;
		isStreaming: boolean;
		isPreTemplatePhase: boolean;
		showUpdateWorldCardOption: boolean;
		updateWorldCard: boolean;
		onStart: () => void;
		onStartImmediate: () => void;
		onStartInterview: () => void;
		onStartGame: (isGameResumeMode: boolean, updateWorld: boolean) => void;
		onCancel: () => void;
		onDismissOptions: () => void;
		onRetry: () => void;
		chatContainer: HTMLDivElement | null;
	}

	let {
		isReadyToStart,
		isCompiling,
		storyName,
		storyNameDraft = $bindable(''),
		isCreatingStory,
		createStoryError,
		worldBuilderError,
		isInterviewMode,
		isGameResumeMode,
		hasInterviewMessages,
		isStreaming,
		isPreTemplatePhase,
		showUpdateWorldCardOption,
		updateWorldCard = $bindable(false),
		onStart,
		onStartImmediate,
		onStartInterview,
		onStartGame,
		onCancel,
		onDismissOptions,
		onRetry,
		chatContainer,
	}: Props = $props();

	const SCROLL_BOTTOM_THRESHOLD_PX = 5;

	function slide(node: Element, opts: { duration?: number } = {}) {
		const result = svelteSlide(node, opts);
		const origCss = result.css;
		if (origCss) {
			result.css = (t, u, ...args) => {
				const css = origCss(t, u, ...args);
				return css.replace(/height:\s*NaNpx/g, 'height: 0px');
			};
		}
		return result;
	}

	let isPinned = $state(false);
	let isUserExpanded = $state(false);
	let isNearBottom = $state(true);
	let isManuallyClosed = $state(false);
	let layoutTransitioning = $state(false);
	let layoutTimeout: ReturnType<typeof setTimeout> | undefined;

	let isMinimized = $derived(!isPinned && (!isNearBottom || isManuallyClosed) && !isUserExpanded);

	const canStart = $derived(storyNameDraft.trim().length > 0 && !isCompiling && !isStreaming);

	let hasContent = $derived(
		isReadyToStart || isCompiling || (isInterviewMode && !isStreaming) || createStoryError != null || worldBuilderError != null
	);

	let summaryText = $derived.by(() => {
		if (createStoryError) return t('components.worldBuilderControls.errorCreatingStory');
		if (worldBuilderError) return t('components.worldBuilderControls.worldBuilderError');
		if (isCompiling) return t('components.worldBuilderControls.compilingWorld');
		if (isReadyToStart && !isInterviewMode) return t('components.worldBuilderControls.worldReadyPrompt');
		if (isInterviewMode && !isStreaming) {
			if (hasInterviewMessages) return t('components.worldBuilderControls.readyToStartGame');
			return t('components.worldBuilderControls.interviewMode');
		}
		return '';
	});

	function startLayoutTransition(scrollToBottomAfter: boolean) {
		layoutTransitioning = true;
		clearTimeout(layoutTimeout);
		layoutTimeout = setTimeout(() => {
			if (scrollToBottomAfter && chatContainer) {
				scrollToBottom(chatContainer);
				isNearBottom = true;
			}
			layoutTransitioning = false;
		}, 300);
	}

	$effect(() => {
		const container = chatContainer;
		if (!container) return;

		isNearBottom = container.isConnected
			? container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX
			: true;

		let rafId = 0;

		const onScroll = () => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				if (layoutTransitioning) return;
				if (!container.isConnected) return;
				const wasNearBottom = isNearBottom;
				isNearBottom = container.isConnected
					? container.scrollHeight - container.scrollTop - container.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX
					: true;
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
			if (chatContainer?.isConnected) {
				isNearBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight < SCROLL_BOTTOM_THRESHOLD_PX;
			}
		}
	});
</script>

{#snippet spinnerCard(variant: 'primary' | 'success', message: string)}
	<div class="rounded-(--radius-container) bg-{variant}-100-900 p-6 text-center space-y-3">
		<div class="flex items-center justify-center gap-3">
			<Spinner size="xs" />
			<span class="text-sm text-{variant}-700-300">{message}</span>
		</div>
	</div>
{/snippet}

{#if !isReadyToStart && !isInterviewMode && !isCompiling && !isPreTemplatePhase}
	<!-- Pre-start bar: name input + Start button -->
	<div class="border-t border-surface-200-800 bg-surface-50-950 px-4 md:px-8 py-3">
		<div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
			<label class="flex-1 flex items-center gap-2">
				<span class="text-xs font-medium text-surface-500 uppercase tracking-wider whitespace-nowrap">
					{t('components.worldBuilderControls.storyNameLabel')}
				</span>
				<input
					type="text"
					class="input flex-1 text-sm"
					placeholder={t('components.worldBuilderControls.storyNamePlaceholder')}
					bind:value={storyNameDraft}
					disabled={isStreaming}
				/>
			</label>
			<button class="btn preset-filled-primary-500 sm:px-6" type="button" onclick={onStart} disabled={!canStart}>
				{t('components.worldBuilderControls.startButton')}
			</button>
		</div>
	</div>
{:else if hasContent && !isStreaming}
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
				<Icon name="chevron-down" class="h-4 w-4" />
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
							<Icon name="pin" class="h-4 w-4" />
						{:else}
							<Icon name="pin-outline" class="h-4 w-4" />
						{/if}
					</button>
				</div>
				<div class="space-y-2 px-4 md:px-8 pb-3 max-h-[50vh] lg:max-h-none overflow-y-auto">
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
							{@render spinnerCard('success', t('components.worldBuilderControls.generatingPlot'))}
						{:else}
							{#if showUpdateWorldCardOption}
								<label class="flex items-center justify-center gap-2 text-sm text-surface-500">
									<input type="checkbox" class="checkbox" bind:checked={updateWorldCard} />
									{t('components.worldBuilderControls.updateWorldCard')}
								</label>
							{/if}
							<div class="flex justify-center">
								<button class="btn preset-filled-success-500" type="button" onclick={() => onStartGame(isGameResumeMode, updateWorldCard)}>
									{t('components.worldBuilderControls.startGame')}
								</button>
							</div>
						{/if}
					{:else if isCompiling}
						{@render spinnerCard('primary', t('components.worldBuilderControls.compilingWorld'))}
					{:else if isReadyToStart}
						<div class="rounded-(--radius-container) bg-primary-100-900 p-6 space-y-4">
							<h3 class="h3 font-display text-primary-900-100 text-center">
								{storyName ?? t('components.worldBuilderControls.createStoryDefault')}
							</h3>
							{#if isCreatingStory}
								{@render spinnerCard('primary', t('components.worldBuilderControls.creatingStory'))}
							{:else}
								<div class="flex flex-col gap-3">
									<button
										class="w-full text-left p-4 rounded-(--radius-container) border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
										type="button"
										onclick={onStartImmediate}
									>
										<span class="font-medium text-primary-900-100 mb-1">{t('components.worldBuilderControls.startImmediately')}</span><br />
										<span class="text-sm text-primary-700-300">{t('components.worldBuilderControls.createStoryDescription')}</span>
									</button>
									<button
										class="w-full text-left p-4 rounded-(--radius-container) border border-primary-200-800 hover:bg-primary-200-800 transition-colors duration-150"
										type="button"
										onclick={onStartInterview}
									>
										<span class="font-medium text-primary-900-100 mb-1">{t('components.worldBuilderControls.tellUsAboutStory')}</span><br />
										<span class="text-sm text-primary-700-300">{t('components.worldBuilderControls.discussDirectionDescription')}</span>
									</button>
								</div>
								<div class="flex justify-center mt-2">
									<button class="btn preset-tonal" type="button" onclick={onCancel}>
										{t('components.worldBuilderControls.cancel')}
									</button>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
