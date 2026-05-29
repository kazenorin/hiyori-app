<script lang="ts">
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import { slide } from 'svelte/transition';
	import { t } from '$lib/i18n';
	import { scrollToBottom } from '$lib/utils/scroll';

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
