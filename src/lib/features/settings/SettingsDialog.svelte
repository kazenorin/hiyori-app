<script lang="ts">
	import { Dialog } from '@skeletonlabs/skeleton-svelte';
	import { ArrowLeft, X } from '@lucide/svelte';
	import { t } from '$lib/i18n';
	import {
		closeSettingsDialog,
		getActiveSection,
		isSettingsDialogOpen,
		setActiveSection,
		type SectionId,
	} from './settings-dialog-state.svelte';
	import { getVisibleSections } from './settings-sections';

	const sections = $derived(getVisibleSections());
	const active = $derived(sections.find((s) => s.id === getActiveSection()) ?? sections[0]);

	function handleOpenChange(details: { open: boolean }): void {
		if (!details.open) closeSettingsDialog();
	}

	function select(id: SectionId): void {
		setActiveSection(id);
	}
</script>

<Dialog open={isSettingsDialogOpen()} onOpenChange={handleOpenChange}>
	<Dialog.Backdrop class="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
	<Dialog.Positioner class="fixed inset-0 z-50 flex items-center justify-center p-2 md:p-4">
		<Dialog.Content
			class="bg-surface-50-950 border border-surface-200-800 rounded-xl shadow-2xl w-[95vw] max-w-4xl h-[90dvh] md:h-[85dvh] flex flex-col overflow-hidden outline-none"
		>
			<!-- Mobile top bar: back button + horizontally scrollable pill tabs -->
			<div class="md:hidden flex items-center gap-2 p-2 border-b border-surface-200-800 shrink-0">
				<button
					class="btn btn-sm preset-tonal shrink-0 min-h-11 px-2"
					type="button"
					aria-label={t('settings.back')}
					onclick={closeSettingsDialog}
				>
					<ArrowLeft size={18} />
				</button>
				<div class="flex items-center gap-1 overflow-x-auto whitespace-nowrap">
					{#each sections as section (section.id)}
						<button
							class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm shrink-0 transition-colors {section.id === active?.id
								? 'bg-primary-500 text-white'
								: 'text-surface-500 hover:bg-surface-200-800'}"
							type="button"
							onclick={() => select(section.id)}
						>
							<section.icon size={16} />
							{t(section.labelKey)}
						</button>
					{/each}
				</div>
			</div>

			<div class="flex flex-1 min-h-0">
				<!-- Desktop left navigation -->
				<nav class="hidden md:flex flex-col w-56 shrink-0 border-r border-surface-200-800 p-3 gap-1 overflow-y-auto">
					{#each sections as section (section.id)}
						<button
							class="flex items-center gap-2 px-3 py-2 rounded-(--radius-base) text-sm text-left transition-colors {section.id === active?.id
								? 'bg-surface-200-800 text-primary-600-400 font-medium'
								: 'text-surface-500 hover:bg-surface-200-800'}"
							type="button"
							onclick={() => select(section.id)}
						>
							<section.icon size={16} class="shrink-0" />
							{t(section.labelKey)}
						</button>
					{/each}
					<p class="mt-auto px-3 pt-3 text-xs text-surface-500">{t('settings.settingsAutoSaved')}</p>
				</nav>

				<!-- Right content pane -->
				<div class="flex-1 flex flex-col min-w-0">
					<header class="flex items-start justify-between gap-4 p-4 border-b border-surface-200-800 shrink-0">
						<div>
							<Dialog.Title class="h4 font-display">{active ? t(active.labelKey) : ''}</Dialog.Title>
							{#if active?.descriptionKey}
								<Dialog.Description class="text-sm text-surface-500 mt-1">{t(active.descriptionKey)}</Dialog.Description>
							{/if}
						</div>
						<button class="hidden md:inline-flex btn btn-sm preset-tonal shrink-0" type="button" onclick={closeSettingsDialog}>
							<X size={16} />
						</button>
					</header>
					<p class="md:hidden px-4 pt-3 text-xs text-surface-500">{t('settings.settingsAutoSaved')}</p>
					<div class="flex-1 overflow-y-auto p-4 md:p-6">
						{#if active}
							{@const Section = active.component}
							<Section />
						{/if}
					</div>
				</div>
			</div>
		</Dialog.Content>
	</Dialog.Positioner>
</Dialog>
