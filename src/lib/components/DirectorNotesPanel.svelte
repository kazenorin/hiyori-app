<script lang="ts">
	import { slide } from 'svelte/transition';
	import { getActiveDirectorNotes, addDirectorNote, updateDirectorNote, deleteDirectorNote } from '$lib/stores/stories.svelte';
	import { t } from '$lib/i18n';
	import type { DirectorNote } from '$lib/db/director-notes';
	import Icon from '$lib/components/ui/Icon.svelte';

	let isExpanded = $state(false);
	let newText = $state('');
	let newFromScene = $state<string>('');
	let newToScene = $state<string>('');

	let notes = $derived(getActiveDirectorNotes());
	let activeCount = $derived(notes.filter((n) => n.isActive).length);

	function handleAdd() {
		const text = newText.trim();
		if (!text) return;
		const from = newFromScene ? parseInt(newFromScene, 10) : null;
		const to = newToScene ? parseInt(newToScene, 10) : null;
		addDirectorNote(text, Number.isNaN(from) ? null : from, Number.isNaN(to) ? null : to);
		newText = '';
		newFromScene = '';
		newToScene = '';
	}

	function handleToggleActive(note: DirectorNote) {
		updateDirectorNote(note.id, { isActive: !note.isActive });
	}

	function handleDelete(id: string) {
		deleteDirectorNote(id);
	}

	function formatSceneRange(note: DirectorNote): string {
		if (note.effectiveFromScene === null && note.effectiveToScene === null) {
			return t('chat.sceneRangeUnset');
		}
		const from = note.effectiveFromScene !== null ? String(note.effectiveFromScene) : '...';
		const to = note.effectiveToScene !== null ? String(note.effectiveToScene) : '...';
		return `${t('chat.effectiveFrom')} ${from} - ${t('chat.effectiveTo')} ${to}`;
	}
</script>

<div class="border-b border-surface-200-800 pb-3 mb-3">
	<button
		class="flex w-full items-center justify-between text-xs font-medium text-surface-500 uppercase tracking-wider"
		type="button"
		onclick={() => (isExpanded = !isExpanded)}
		aria-expanded={isExpanded}
	>
		<div class="flex flex-wrap items-center gap-2">
			<span>{t('chat.directorNotes')}</span>
			{#if activeCount > 0}
				<span class="badge preset-filled-primary-500 text-[10px] px-1.5 py-0.5">
					{activeCount}
				</span>
			{/if}
		</div>
		<Icon name="chevron-down" class="h-4 w-4 transition-transform {isExpanded ? 'rotate-180' : ''}" />
	</button>

	{#if isExpanded}
		<div transition:slide={{ duration: 200 }} class="mt-2 space-y-2">
			{#if notes.length === 0}
				<p class="text-xs text-surface-500 italic">{t('chat.directorNotesEmpty')}</p>
			{:else}
				{#each notes as note (note.id)}
					<div
						class="group flex items-start gap-2 rounded-(--radius-container) p-2 {note.isActive
							? 'bg-surface-100-900'
							: 'bg-surface-50-950 opacity-60'}"
					>
						<button
							class="mt-0.5 shrink-0"
							type="button"
							onclick={() => handleToggleActive(note)}
							aria-label={note.isActive ? 'Deactivate note' : 'Activate note'}
						>
							{#if note.isActive}
								<Icon name="check-circle" class="h-4 w-4 text-primary-500" />
							{:else}
								<Icon name="x-circle" class="h-4 w-4 text-surface-400" />
							{/if}
						</button>
						<div class="flex-1 min-w-0">
							<p class="text-sm text-surface-950-50 break-words">{note.text}</p>
							<p class="text-[10px] text-surface-500 mt-0.5">{formatSceneRange(note)}</p>
						</div>
						<button
							class="mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-surface-500 hover:text-error-500"
							type="button"
							onclick={() => handleDelete(note.id)}
							aria-label="Delete note"
						>
							<Icon name="trash-alt" class="h-4 w-4" />
						</button>
					</div>
				{/each}
			{/if}

			<div class="flex flex-col gap-1.5 mt-2">
				<input
					class="input text-sm"
					type="text"
					placeholder={t('chat.directorNotesPlaceholder')}
					bind:value={newText}
					onkeydown={(e) => {
						if (e.key === 'Enter') handleAdd();
					}}
				/>
				<div class="flex flex-wrap items-center gap-2">
					<input
						class="input text-xs w-20"
						type="number"
						min="1"
						max="999"
						placeholder={t('chat.effectiveFrom')}
						bind:value={newFromScene}
					/>
					<span class="text-xs text-surface-500">-</span>
					<input class="input text-xs w-20" type="number" min="1" max="999" placeholder={t('chat.effectiveTo')} bind:value={newToScene} />
					<button
						class="btn preset-filled-primary-500 text-xs px-3 py-1 ml-auto"
						type="button"
						onclick={handleAdd}
						disabled={!newText.trim()}
					>
						{t('chat.addNote')}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
