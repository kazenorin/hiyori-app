<script lang="ts">
	import { untrack } from 'svelte';
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/ui/Icon.svelte';
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';
	import ReasoningAccordion from '$lib/components/chat/ReasoningAccordion.svelte';
	import { PHASE_ICONS, PHASE_LABEL_KEYS } from '$lib/components/chat/PhaseStrip.svelte';
	import {
		closePhaseDialog,
		getPhaseDialogMessageId,
		getPhaseDialogOpen,
		getPhaseDialogPhase,
		setPhaseDialogPhase,
	} from './phase-dialog-state.svelte';
	import { findDisplayedMessage, getCharacterNames, getIsStreaming, getMessages } from '$lib/ai/chat.svelte';
	import { getActiveActLineId, getActiveStory } from '$lib/stores/stories.svelte';
	import type { PhaseName, UIScenePhase } from '$lib/ai/narrative-types';

	const message = $derived.by(() => {
		const id = getPhaseDialogMessageId();
		return id ? findDisplayedMessage(id) : undefined;
	});
	const phases = $derived(message?.phases ?? []);
	const activeIdx = $derived.by(() => {
		const selected = getPhaseDialogPhase();
		const idx = phases.findIndex((p) => p.phaseName === selected);
		return idx >= 0 ? idx : 0;
	});
	const active = $derived(phases[activeIdx]);
	const phaseMeta = $derived(active ? message?.metadata?.phases?.find((m) => m.phaseName === active.phaseName) : undefined);
	const characterNames = $derived(getCharacterNames());
	// While the run is live, the bound message is the mirrored session view and its last phase
	// entry is the one currently streaming (until the run-manager exposes session.streamingPhase).
	const streamingPhase = $derived(
		getIsStreaming() && message !== undefined && message === getMessages().at(-1) ? (phases.at(-1)?.phaseName ?? null) : null
	);
	const cacheReadPct = $derived(
		phaseMeta?.cacheReadTokens && phaseMeta.inputTokens > 0 ? Math.round((phaseMeta.cacheReadTokens / phaseMeta.inputTokens) * 100) : null
	);

	function handleOpenChange(details: { open: boolean }): void {
		if (!details.open) closePhaseDialog();
	}

	function select(phase: PhaseName): void {
		setPhaseDialogPhase(phase);
	}

	function isNotStarted(phase: UIScenePhase): boolean {
		return phase.content === '' && !phase.reasoning;
	}

	function formatTokens(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
		return String(n);
	}

	function formatDuration(ms: number): string {
		if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
		return ms + 'ms';
	}

	// --- Auto-scroll: pin to bottom only while the user is at the bottom ---

	let contentEl = $state<HTMLDivElement | null>(null);
	let pinnedToBottom = false;

	function handleContentScroll(): void {
		if (!contentEl) return;
		pinnedToBottom = contentEl.scrollHeight - contentEl.scrollTop - contentEl.clientHeight < 48;
	}

	// On dialog open / pane switch: a streaming pane starts pinned to the bottom, a settled pane
	// starts at the top. streamingPhase is read untracked so phase progression elsewhere in the
	// run does not reset the current pane's scroll position.
	$effect(() => {
		const el = contentEl;
		const idx = activeIdx;
		if (!el || idx < 0) return;
		const phaseName = untrack(() => phases[idx]?.phaseName);
		const streaming = untrack(() => streamingPhase);
		requestAnimationFrame(() => {
			pinnedToBottom = phaseName !== undefined && phaseName === streaming;
			el.scrollTop = pinnedToBottom ? el.scrollHeight : 0;
		});
	});

	// Follow output/reasoning deltas while pinned.
	$effect(() => {
		// Dependency reads: re-run this effect on every streaming delta of the active pane.
		void active?.content;
		void active?.reasoning;
		requestAnimationFrame(() => {
			if (pinnedToBottom && contentEl) contentEl.scrollTop = contentEl.scrollHeight;
		});
	});

	// Close on act-line or story switch: the bound message id may not exist in the new line.
	let prevActLineId: string | null | undefined;
	let prevStoryId: string | null | undefined;
	$effect(() => {
		const actLineId = getActiveActLineId();
		const storyId = getActiveStory()?.id ?? null;
		if (prevActLineId === undefined) {
			prevActLineId = actLineId;
			prevStoryId = storyId;
			return;
		}
		if (actLineId !== prevActLineId || storyId !== prevStoryId) closePhaseDialog();
	});
</script>

<Dialog open={getPhaseDialogOpen() && message !== undefined && active !== undefined} onOpenChange={handleOpenChange}>
	<Dialog.Backdrop class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
		<Dialog.Content
			class="bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-2xl w-[95vw] max-w-4xl h-[90dvh] md:h-[85dvh] flex flex-col overflow-hidden outline-none"
		>
			{#if message && active}
				<!-- Mobile top bar: back button + horizontally scrollable pill tabs -->
				<div class="md:hidden flex items-center gap-2 p-2 border-b border-surface-200-800 shrink-0">
					<button
						class="btn btn-sm preset-tonal shrink-0 min-h-11 px-2"
						type="button"
						aria-label={t('settings.back')}
						onclick={closePhaseDialog}
					>
						<ArrowLeft size={18} />
					</button>
					<div class="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
						{#each phases as phase, pi (pi)}
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm shrink-0 transition-colors {pi === activeIdx
									? 'bg-primary-500 text-white'
									: 'text-surface-500 hover:bg-surface-200-800'} {phase.phaseName !== streamingPhase && isNotStarted(phase)
									? 'opacity-45'
									: ''}"
								type="button"
								aria-current={pi === activeIdx ? 'true' : undefined}
								onclick={() => select(phase.phaseName)}
							>
								{#if phase.phaseName === streamingPhase}
									<Icon name="loader-circle" class="size-4 animate-spin shrink-0" aria-hidden="true" />
								{:else}
									<Icon name={PHASE_ICONS[phase.phaseName]} class="size-4 shrink-0" aria-hidden="true" />
								{/if}
								{t(PHASE_LABEL_KEYS[phase.phaseName])}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-1 min-h-0">
					<!-- Desktop left navigation -->
					<nav class="hidden md:flex flex-col w-56 shrink-0 border-r border-surface-200-800 p-3 gap-1 overflow-y-auto">
						{#each phases as phase, pi (pi)}
							<button
								class="flex items-center gap-2 px-3 py-2 rounded-(--radius-base) text-sm text-left transition-colors {pi === activeIdx
									? 'bg-surface-200-800 text-primary-600-400 font-medium'
									: 'text-surface-500 hover:bg-surface-200-800'} {phase.phaseName !== streamingPhase && isNotStarted(phase)
									? 'opacity-45'
									: ''}"
								type="button"
								aria-current={pi === activeIdx ? 'true' : undefined}
								onclick={() => select(phase.phaseName)}
							>
								{#if phase.phaseName === streamingPhase}
									<Icon name="loader-circle" class="size-4 shrink-0 animate-spin" aria-hidden="true" />
								{:else}
									<Icon name={PHASE_ICONS[phase.phaseName]} class="size-4 shrink-0" aria-hidden="true" />
								{/if}
								{t(PHASE_LABEL_KEYS[phase.phaseName])}
							</button>
						{/each}
					</nav>

					<!-- Right content pane -->
					<div class="flex-1 flex flex-col min-w-0">
						<header class="flex items-start justify-between gap-4 p-4 border-b border-surface-200-800 shrink-0">
							<div>
								<Dialog.Title class="h4 font-display">{t(PHASE_LABEL_KEYS[active.phaseName])}</Dialog.Title>
								<Dialog.Description class="text-sm text-surface-500 mt-1">
									{t('chat.sceneLabel', { sceneNumber: message.sceneNumber })}
								</Dialog.Description>
							</div>
							<button
								class="hidden md:inline-flex btn btn-sm preset-tonal shrink-0"
								type="button"
								aria-label={t('settings.close')}
								onclick={closePhaseDialog}
							>
								<X size={16} />
							</button>
						</header>
						<div class="flex-1 overflow-y-auto p-4 md:p-6" bind:this={contentEl} onscroll={handleContentScroll}>
							{#key activeIdx}
								<!-- Meta line -->
								{#if phaseMeta}
									<div
										class="flex flex-wrap items-center gap-x-3 gap-y-1 pb-2.5 mb-3 border-b border-surface-200-800 text-[11px] font-mono text-surface-400-500"
									>
										<span class="truncate">{phaseMeta.model}</span>
										<span class="opacity-30">&middot;</span>
										<span>{formatTokens(phaseMeta.inputTokens)} in / {formatTokens(phaseMeta.outputTokens)} out</span>
										<span class="opacity-30">&middot;</span>
										<span>{formatDuration(phaseMeta.durationMs)}</span>
										{#if cacheReadPct !== null}
											<span class="opacity-30">&middot;</span>
											<span>cache {cacheReadPct}%</span>
										{/if}
									</div>
								{/if}

								<!-- Reasoning (collapsed by default, live while streaming) -->
								{#if active.reasoning}
									<ReasoningAccordion label={t('chat.reasoning')} value="reasoning">
										{active.reasoning}
									</ReasoningAccordion>
								{/if}

								<!-- Output: same MarkdownContent invocation as the main chat body -->
								<div class="leading-relaxed text-surface-800-200">
									<MarkdownContent content={active.content} {characterNames} importantPhrases={message.importantPhrases} />
								</div>
							{/key}
						</div>
					</div>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
