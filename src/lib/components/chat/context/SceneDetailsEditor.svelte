<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import type { SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';
	import {
		inspectSceneDetailEntries,
		isValidSceneNumber,
		nextSceneNumber,
		removeDisplayIndex,
		sceneDetailDisplayOrder,
	} from './character-profile-form-state.ts';

	interface Props {
		entries: SceneDetailEntry[];
		onChange: (entries: SceneDetailEntry[]) => void;
	}

	let { entries, onChange }: Props = $props();

	const editorId = $props.id();

	const issues = $derived(inspectSceneDetailEntries(entries));

	// svelte-ignore state_referenced_locally
	let displayOrder = $state<number[]>(sceneDetailDisplayOrder(entries));

	const rows = $derived(displayOrder.map((index) => ({ entry: entries[index], index })));

	function updateEntry(index: number, patch: Partial<SceneDetailEntry>): void {
		onChange(entries.map((entry, current) => (current === index ? { ...entry, ...patch } : entry)));
	}

	function handleSceneNumberInput(index: number, event: Event): void {
		const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
		updateEntry(index, { sceneNumber: value });
	}

	function handleDetailsInput(index: number, event: Event): void {
		updateEntry(index, { details: (event.currentTarget as HTMLInputElement).value });
	}

	function addRow(): void {
		const newIndex = entries.length;
		onChange([...entries, { sceneNumber: nextSceneNumber(entries), details: '' }]);
		// The new row is the highest valid scene number, so it belongs at the top of the descending order.
		displayOrder = [newIndex, ...displayOrder];
	}

	function removeRow(index: number): void {
		onChange(entries.filter((_, current) => current !== index));
		displayOrder = removeDisplayIndex(displayOrder, index);
	}
</script>

<div class="space-y-3">
	{#if issues.duplicateNumbers.length > 0}
		<p class="text-xs text-error-500">
			{t('chat.context.duplicateSceneNumbers', { sceneNumbers: issues.duplicateNumbers.join(', ') })}
		</p>
	{/if}

	{#if entries.length === 0}
		<p class="text-sm text-surface-500">{t('chat.context.noSceneDetails')}</p>
	{/if}

	{#each rows as row (row.index)}
		<div class="rounded-(--radius-container) border border-surface-200-800 p-3 space-y-2">
			<div class="flex flex-wrap items-end gap-2">
				<label class="block w-28" for="{editorId}-scene-{row.index}">
					<span class="text-xs text-surface-500">{t('chat.context.sceneNumber')}</span>
					<input
						id="{editorId}-scene-{row.index}"
						class="input mt-1 w-full text-sm"
						type="number"
						min="1"
						step="1"
						value={isValidSceneNumber(row.entry.sceneNumber) ? row.entry.sceneNumber : ''}
						aria-invalid={issues.invalidRows.includes(row.index) || issues.duplicateNumbers.includes(row.entry.sceneNumber)}
						oninput={(event) => handleSceneNumberInput(row.index, event)}
					/>
				</label>
				<button
					class="btn preset-tonal text-xs py-1 px-3"
					type="button"
					aria-label={t('chat.context.removeSceneDetail')}
					onclick={() => removeRow(row.index)}
				>
					{t('chat.remove')}
				</button>
			</div>

			<label class="block" for="{editorId}-details-{row.index}">
				<span class="text-xs text-surface-500">{t('chat.context.sceneDetail')}</span>
				<input
					id="{editorId}-details-{row.index}"
					class="input mt-1 w-full text-sm"
					type="text"
					placeholder={t('chat.context.sceneDetailPlaceholder')}
					value={row.entry.details}
					oninput={(event) => handleDetailsInput(row.index, event)}
				/>
			</label>

			{#if issues.invalidRows.includes(row.index)}
				<p class="text-xs text-error-500">{t('chat.context.sceneNumberInvalid')}</p>
			{:else if issues.duplicateNumbers.includes(row.entry.sceneNumber)}
				<p class="text-xs text-error-500">{t('chat.context.sceneNumberDuplicate')}</p>
			{/if}
		</div>
	{/each}

	<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={addRow}>
		{t('chat.context.addSceneDetail')}
	</button>
</div>
