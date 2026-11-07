<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { log } from '#lib/logging/logger.ts';
	import { toaster } from '#lib/stores/toaster.svelte.ts';
	import { getIsBusy } from '#lib/ai/chat.svelte.ts';
	import { getStorySoFar, saveActShortSummary, type StorySoFarEntry } from '#lib/features/context-manager.ts';

	interface Props {
		actLineId: string;
	}

	let { actLineId }: Props = $props();

	let entries = $state<StorySoFarEntry[]>([]);
	let loading = $state(true);
	let loadError = $state(false);
	let editingEventId = $state<string | null>(null);
	let draft = $state('');
	let saving = $state(false);

	$effect(() => {
		const id = actLineId;
		loading = true;
		loadError = false;
		editingEventId = null;
		void load(id);
	});

	async function load(id: string): Promise<void> {
		try {
			entries = await getStorySoFar(id);
		} catch (err) {
			loadError = true;
			await log.error('context-manager', 'Failed to load Story So Far', err);
		} finally {
			loading = false;
		}
	}

	function startEdit(entry: StorySoFarEntry): void {
		if (getIsBusy()) return;
		editingEventId = entry.eventId;
		draft = entry.value;
	}

	function handleKeydown(e: KeyboardEvent, entry: StorySoFarEntry): void {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void save(entry);
		}
	}

	async function save(entry: StorySoFarEntry): Promise<void> {
		if (saving) return;
		const value = draft.trim();
		saving = true;
		try {
			await saveActShortSummary(entry.eventId, value);
			entries = entries.map((e) => (e.eventId === entry.eventId ? { ...e, value } : e));
			editingEventId = null;
		} catch (err) {
			await log.error('context-manager', 'Failed to save act short summary', err);
			toaster.error({ title: t('chat.context.saveFailed') });
		} finally {
			saving = false;
		}
	}
</script>

<div class="space-y-4">
	<div class="rounded-(--radius-container) border border-warning-500/50 bg-warning-100-900 p-4">
		<p class="text-sm font-medium text-warning-600-400">{t('chat.context.storySoFarWarning')}</p>
	</div>

	{#if loading}
		<p class="text-sm text-surface-500">{t('chat.context.loading')}</p>
	{:else if loadError}
		<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
	{:else if entries.length === 0}
		<p class="text-sm text-surface-500">{t('chat.context.noSummaries')}</p>
	{:else}
		{#each entries as entry (entry.eventId)}
			<div class="rounded-(--radius-container) border border-surface-200-800 p-4 space-y-2">
				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-medium">
						{t('common.actLabel', { n: entry.actNumber })}: {entry.lineName}
						{#if entry.isMainLine}
							<span class="text-xs text-primary-500 ml-1">{t('chat.context.mainLine')}</span>
						{/if}
					</h3>
					{#if editingEventId !== entry.eventId}
						<button
							class="btn preset-tonal text-xs py-1 px-3 shrink-0"
							type="button"
							disabled={getIsBusy() || saving}
							onclick={() => startEdit(entry)}
						>
							{t('chat.edit')}
						</button>
					{/if}
				</div>

				{#if editingEventId === entry.eventId}
					<textarea
						class="input w-full resize-y text-sm leading-relaxed min-h-32"
						rows="8"
						bind:value={draft}
						onkeydown={(e) => handleKeydown(e, entry)}></textarea>
					<div class="flex items-center gap-2 mt-3 pt-3 border-t border-surface-200-800">
						<button class="btn preset-filled-primary-500 text-xs py-1 px-3" type="button" disabled={saving} onclick={() => save(entry)}>
							{t('chat.save')}
						</button>
						<button class="btn preset-tonal text-xs py-1 px-3" type="button" disabled={saving} onclick={() => (editingEventId = null)}>
							{t('chat.cancel')}
						</button>
					</div>
				{:else}
					<p class="text-sm leading-relaxed whitespace-pre-wrap text-surface-800-200">{entry.value}</p>
				{/if}
			</div>
		{/each}
	{/if}
</div>
