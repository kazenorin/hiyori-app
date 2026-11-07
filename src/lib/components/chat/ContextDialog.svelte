<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft } from '@lucide/svelte';
	import { t } from '#lib/i18n/index.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { mobileFeatures } from '#lib/stores/mobile-nav.svelte.ts';
	import { findDisplayedMessage } from '#lib/ai/chat.svelte.ts';
	import { getActiveActLineId, getActiveStory } from '#lib/stores/stories.svelte.ts';
	import { getAvailableContexts } from '#lib/features/context-availability.svelte.ts';
	import { CONTEXT_ICONS, CONTEXT_LABEL_KEYS } from './context/context-registry';
	import StorySoFarPanel from './context/StorySoFarPanel.svelte';
	import ScenePlotPanel from './context/ScenePlotPanel.svelte';
	import {
		closeContextDialog,
		getContextDialogMessageId,
		getContextDialogOpen,
		getContextDialogSelection,
		setContextDialogSelection,
	} from './phase-dialog-state.svelte';

	const message = $derived.by(() => {
		const id = getContextDialogMessageId();
		return id ? findDisplayedMessage(id) : undefined;
	});
	const contexts = $derived(getAvailableContexts());
	const selected = $derived(getContextDialogSelection());
	// Availability can shrink while the dialog is open (e.g. the planner was turned off).
	const active = $derived(contexts.includes(selected) ? selected : contexts[0]);
	const actLineId = $derived(getActiveActLineId());

	function handleOpenChange(details: { open: boolean }): void {
		if (!details.open) closeContextDialog();
	}

	// Close on act-line or story switch: the bound message id may not exist in the new line.
	// Duplicated from PhaseDialog rather than extracted — two call sites do not warrant a helper.
	let prevActLineId: string | null | undefined;
	let prevStoryId: string | null | undefined;
	$effect(() => {
		const currentActLineId = getActiveActLineId();
		const storyId = getActiveStory()?.id ?? null;
		if (prevActLineId === undefined) {
			prevActLineId = currentActLineId;
			prevStoryId = storyId;
			return;
		}
		if (currentActLineId !== prevActLineId || storyId !== prevStoryId) closeContextDialog();
	});

	// The open flag must not outlive the viewport condition that owns it: Zag's CONTROLLED.CLOSE
	// does not fire onOpenChange, so hiding via the isPhone prop term alone would leak the flag.
	$effect(() => {
		if (!mobileFeatures.isPhone) closeContextDialog();
	});
</script>

<Dialog
	open={getContextDialogOpen() && mobileFeatures.isPhone && message !== undefined && contexts.length > 0}
	onOpenChange={handleOpenChange}
>
	<Dialog.Backdrop class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
		<Dialog.Content
			class="bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-2xl w-[95vw] max-w-4xl h-[90dvh] md:h-[85dvh] flex flex-col overflow-hidden outline-none"
		>
			{#if message && active}
				<div class="md:hidden flex items-center gap-2 p-2 border-b border-surface-200-800 shrink-0">
					<button
						class="btn btn-sm preset-tonal shrink-0 min-h-11 px-2"
						type="button"
						aria-label={t('settings.back')}
						onclick={closeContextDialog}
					>
						<ArrowLeft size={18} />
					</button>
					<div class="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
						{#each contexts as context (context)}
							<button
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm shrink-0 transition-colors {context === active
									? 'bg-primary-500 text-white'
									: 'text-surface-500 hover:bg-surface-200-800'}"
								type="button"
								aria-current={context === active ? 'true' : undefined}
								onclick={() => setContextDialogSelection(context)}
							>
								<Icon name={CONTEXT_ICONS[context]} class="size-4 shrink-0" aria-hidden="true" />
								{t(CONTEXT_LABEL_KEYS[context])}
							</button>
						{/each}
					</div>
				</div>

				<div class="flex flex-1 min-h-0 flex-col">
					<header class="flex items-start justify-between gap-4 p-4 border-b border-surface-200-800 shrink-0">
						<div>
							<Dialog.Title class="h4 font-display">{t(CONTEXT_LABEL_KEYS[active])}</Dialog.Title>
							<Dialog.Description class="text-sm text-surface-500 mt-1">
								{t('chat.sceneLabel', { sceneNumber: message.sceneNumber })}
							</Dialog.Description>
						</div>
					</header>
					<div class="flex-1 overflow-y-auto p-4 md:p-6">
						{#key active}
							{#if active === 'storySoFar' && actLineId}
								<StorySoFarPanel {actLineId} />
							{:else if active === 'scenePlot'}
								<ScenePlotPanel messageId={message.id} />
							{/if}
						{/key}
					</div>
				</div>
			{/if}
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
