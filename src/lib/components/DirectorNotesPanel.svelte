<script lang="ts">
	import { slide } from 'svelte/transition';
	import {
		getActiveDirectorNotes,
		addDirectorNote,
		updateDirectorNote,
		deleteDirectorNote,
	} from '$lib/stores/stories.svelte';
	import { t } from '$lib/i18n';
	import type { DirectorNote } from '$lib/db/director-notes';

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
		<div class="flex items-center gap-2">
			<span>{t('chat.directorNotes')}</span>
			{#if activeCount > 0}
				<span class="badge preset-filled-primary-500 text-[10px] px-1.5 py-0.5">
					{activeCount}
				</span>
			{/if}
		</div>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			class="h-4 w-4 transition-transform {isExpanded ? 'rotate-180' : ''}"
			viewBox="0 0 20 20"
			fill="currentColor"
			aria-hidden="true"
		>
			<path
				fill-rule="evenodd"
				d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
				clip-rule="evenodd"
			/>
		</svg>
	</button>

	{#if isExpanded}
		<div transition:slide={{ duration: 200 }} class="mt-2 space-y-2">
			{#if notes.length === 0}
				<p class="text-xs text-surface-500 italic">{t('chat.directorNotesEmpty')}</p>
			{:else}
				{#each notes as note (note.id)}
					<div
						class="group flex items-start gap-2 rounded-(--radius-container) p-2 {note.isActive ? 'bg-surface-100-900' : 'bg-surface-50-950 opacity-60'}"
					>
						<button
							class="mt-0.5 shrink-0"
							type="button"
							onclick={() => handleToggleActive(note)}
							aria-label={note.isActive ? 'Deactivate note' : 'Activate note'}
						>
							{#if note.isActive}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-primary-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />
								</svg>
							{:else}
								<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-surface-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
									<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />
								</svg>
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
							<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
								<path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022 1.015 11.08A2.75 2.75 0 007.774 19h4.452a2.75 2.75 0 002.745-2.519l1.015-11.08.149.022a.75.75 0 10.23-1.482A41.197 41.197 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd" />
							</svg>
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
					onkeydown={(e) => { if (e.key === 'Enter') handleAdd(); }}
				/>
				<div class="flex items-center gap-2">
					<input
						class="input text-xs w-20"
						type="number"
						min="1"
						max="999"
						placeholder={t('chat.effectiveFrom')}
						bind:value={newFromScene}
					/>
					<span class="text-xs text-surface-500">-</span>
					<input
						class="input text-xs w-20"
						type="number"
						min="1"
						max="999"
						placeholder={t('chat.effectiveTo')}
						bind:value={newToScene}
					/>
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
