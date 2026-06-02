<script lang="ts">
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import { slide } from 'svelte/transition';
	import { t } from '$lib/i18n';
	import { scrollToBottom } from '$lib/utils/scroll';
	import Icon from '$lib/components/ui/Icon.svelte';

	interface Props {
		decisions: string[];
		activePlotThreads: string[];
		decisionContext: string | null;
		isStreaming: boolean;
		isBusy: boolean;
		actEnded: boolean;
		storyConcluded: boolean;
		onDecisionClick: (decision: string) => void;
		onContinueToNextAct?: () => void;
		onEndStory?: () => void;
		chatContainer: HTMLDivElement | null;
	}

	let {
		decisions,
		activePlotThreads,
		decisionContext,
		isStreaming,
		isBusy,
		actEnded,
		storyConcluded,
		onDecisionClick,
		onContinueToNextAct,
		onEndStory,
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
	let hasContent = $derived(decisions.length > 0 || activePlotThreads.length > 0 || decisionContext !== null || actEnded || storyConcluded);

	let summaryText = $derived.by(() => {
		const parts: string[] = [];
		if (decisionContext !== null) parts.push(t('components.chatControls.decisionPoint'));
		if (decisions.length > 0)
			parts.push(
				t(decisions.length === 1 ? 'components.chatControls.decision_one' : 'components.chatControls.decision_other', {
					count: decisions.length,
				})
			);
		if (activePlotThreads.length > 0)
			parts.push(
				t(activePlotThreads.length === 1 ? 'components.chatControls.thread_one' : 'components.chatControls.thread_other', {
					count: activePlotThreads.length,
				})
			);
		return parts.join(' · ');
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

		const onClick = () => {
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
			layoutTransitioning = false;
			clearTimeout(layoutTimeout);
		}
	});
</script>

{#if hasContent && !isStreaming}
	<div class="border-t border-surface-200-800 bg-surface-50-950">
		{#if isBusy}
			<div class="h-1 overflow-hidden bg-surface-200-800">
				<div class="h-full w-1/3 bg-primary-500 animate-indeterminate-bar"></div>
			</div>
		{/if}
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
				<button
					class="w-full flex items-start justify-between px-4 md:px-8 pt-3 text-left"
					type="button"
					onclick={() => {
						if (isPinned) {
							isPinned = false;
						}
						isUserExpanded = false;
						isManuallyClosed = true;
					}}
				>
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.chatControls.controls')}</span>
					<span
						class="btn btn-sm variant-ghost text-surface-500"
						role="button"
						aria-label={isPinned ? 'Unpin controls' : 'Pin controls'}
						onclick={(e) => {
							e.stopPropagation();
							isPinned = !isPinned;
						}}
					>
						{#if isPinned}
							<Icon name="pin" class="h-4 w-4" />
						{:else}
							<Icon name="pin-outline" class="h-4 w-4" />
						{/if}
					</span>
				</button>
				<div class="space-y-2 px-4 md:px-8 pb-3 max-h-[50vh] lg:max-h-none overflow-y-auto">
					{#if storyConcluded}
						<div class="text-center py-2">
							<span class="text-sm font-medium text-surface-400-600">{t('components.chatControls.storyConcluded')}</span>
						</div>
					{:else if actEnded}
						<div class="mb-1">
							<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.chatControls.decisionPoint')}</span
							>
							<div class="text-surface-950-50"><MarkdownContent content={t('components.chatControls.actEndDecisionContext')} /></div>
						</div>
						<div class="grid grid-cols-1 md:grid-cols-2 gap-2">
							<button
								class="btn preset-filled-primary-500 w-full text-left"
								type="button"
								onclick={() => onContinueToNextAct?.()}
								disabled={isBusy}
							>
								{t('components.chatControls.continueToNextAct')}
							</button>
							<button class="btn preset-tonal w-full text-left" type="button" onclick={() => onEndStory?.()} disabled={isBusy}>
								{t('components.chatControls.endTheStory')}
							</button>
						</div>
					{:else}
						{#if decisionContext}
							<div class="mb-1">
								<span class="text-xs font-medium text-surface-500 uppercase tracking-wider"
									>{t('components.chatControls.decisionPoint')}</span
								>
								<div class="text-surface-950-50"><MarkdownContent content={decisionContext} /></div>
							</div>
						{/if}
						<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
							{#if activePlotThreads.length > 0}
								<div>
									<div class="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">
										{t('components.chatControls.activePlotThreads')}
									</div>
									<MarkdownContent content={activePlotThreads.map((thread) => `- ${thread}`).join('\n')} />
								</div>
							{/if}
							{#if decisions.length > 0}
								<div>
									<div class="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">
										{t('components.chatControls.decisions')}
									</div>
									<div class="space-y-1">
										{#each decisions as decision, i (i)}
											<button
												class="btn preset-filled-primary-500 w-full text-left line-clamp-2 whitespace-normal"
												type="button"
												onclick={() => onDecisionClick(decision)}
												disabled={isBusy}
											>
												{i + 1}. {decision}
											</button>
										{/each}
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/if}
	</div>
{/if}
