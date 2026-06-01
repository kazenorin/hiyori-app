<script lang="ts">
	import { t } from '$lib/i18n';
	import { mobileNav, mobileFeatures } from '$lib/stores/mobile-nav.svelte';
	import MarkdownContent from './MarkdownContent.svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';

	interface Props {
		decisions: string[];
		activePlotThreads: string[];
		decisionContext: string | null;
		actEnded: boolean;
		storyConcluded: boolean;
		isBusy: boolean;
		onDecisionClick: (decision: string) => void;
		onContinueToNextAct?: () => void;
		onEndStory?: () => void;
	}

	let {
		decisions,
		activePlotThreads,
		decisionContext,
		actEnded,
		storyConcluded,
		isBusy,
		onDecisionClick,
		onContinueToNextAct,
		onEndStory,
	}: Props = $props();

	let isOpen = $derived(mobileFeatures.isPhone && mobileNav.activeTab === 'choices');

	function closeSheet() {
		mobileNav.activeTab = 'chat';
	}

	function handleDecision(decision: string) {
		onDecisionClick(decision);
		mobileNav.activeTab = 'chat';
	}
	function handleContinue() {
		onContinueToNextAct?.();
		mobileNav.activeTab = 'chat';
	}
	function handleEnd() {
		onEndStory?.();
		mobileNav.activeTab = 'chat';
	}
</script>

{#if isOpen}
	<!-- Backdrop: only covers viewport above the tab bar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="fixed inset-x-0 top-0 z-40 bg-black/50" style="bottom: 52px;" onclick={closeSheet} role="presentation"></div>

	<!-- Sheet content: sits above backdrop, bottom-aligned above tab bar -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-x-0 bottom-[52px] z-50 bg-surface-50-950 border-t border-surface-200-800 rounded-t-2xl p-4 max-h-[75vh] overflow-y-auto"
		role="dialog"
		aria-modal="true"
		aria-label={t('choicesSheet.title')}
		tabindex="0"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => {
			if (e.key === 'Escape') {
				closeSheet();
			}
		}}
	>
		<!-- Drag handle -->
		<button
			type="button"
			class="w-full flex justify-center py-1 cursor-grab active:cursor-grabbing"
			onclick={closeSheet}
			aria-label={t('choicesSheet.close')}
		>
			<div class="w-8 h-1 rounded-full bg-surface-400-600"></div>
		</button>

		<!-- Content -->
		<div class="space-y-4 mt-2">
			{#if storyConcluded}
				<div class="text-center py-4">
					<span class="text-sm font-medium text-surface-400-600">{t('components.chatControls.storyConcluded')}</span>
				</div>
			{:else if actEnded}
				<div class="space-y-3">
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.chatControls.decisionPoint')}</span>
					<div class="text-surface-950-50 text-sm">
						<MarkdownContent content={t('components.chatControls.actEndDecisionContext')} />
					</div>
					<button class="btn preset-filled-primary-500 w-full h-11" type="button" onclick={handleContinue} disabled={isBusy}>
						{t('components.chatControls.continueToNextAct')}
					</button>
					<button class="btn preset-tonal w-full h-11" type="button" onclick={handleEnd} disabled={isBusy}>
						{t('components.chatControls.endTheStory')}
					</button>
				</div>
			{:else}
				{#if decisionContext}
					<div class="mb-2">
						<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.chatControls.decisionPoint')}</span>
						<div class="text-surface-950-50 text-sm mt-1">
							<MarkdownContent content={decisionContext} />
						</div>
					</div>
				{/if}

				{#if activePlotThreads.length > 0}
					<Accordion collapsible>
						<Accordion.Item value="plot-threads">
							<Accordion.ItemTrigger
								class="flex items-center justify-between w-full text-xs font-medium text-surface-500 uppercase tracking-wider py-2"
							>
								<span>{t('components.chatControls.activePlotThreads')}</span>
								<Accordion.ItemIndicator>
									<svg class="h-4 w-4 transition-transform" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
										<path
											fill-rule="evenodd"
											d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
											clip-rule="evenodd"
										/>
									</svg>
								</Accordion.ItemIndicator>
							</Accordion.ItemTrigger>
							<Accordion.ItemContent>
								<div class="text-sm text-surface-700-300 mt-1 space-y-1 pb-2">
									{#each activePlotThreads as thread}
										<div class="flex items-center gap-1.5">
											<span class="w-1.5 h-1.5 rounded-full bg-primary-500"></span>
											<span>{thread}</span>
										</div>
									{/each}
								</div>
							</Accordion.ItemContent>
						</Accordion.Item>
					</Accordion>
				{/if}

				{#if decisions.length > 0}
					<div class="space-y-1">
						<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">{t('components.chatControls.decisions')}</span>
						<div class="mt-1 space-y-2">
							{#each decisions as decision, i (i)}
								<button
									class="btn preset-filled-primary-500 w-full h-11 text-left whitespace-normal line-clamp-2"
									type="button"
									onclick={() => handleDecision(decision)}
									disabled={isBusy}
								>
									{decision}
								</button>
							{/each}
						</div>
					</div>
				{:else if !decisionContext && activePlotThreads.length === 0}
					<div class="text-center py-8 text-surface-500 text-sm">
						{t('choicesSheet.noDecisions')}
					</div>
				{/if}
			{/if}
		</div>
	</div>
{/if}
