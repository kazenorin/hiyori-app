<script lang="ts">
	import { tick } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { t } from '#lib/i18n/index.ts';
	import type { SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';
	import {
		buildSceneDetailRows,
		inspectSceneDetailEntries,
		type SceneDetailRange,
		type SceneDetailRow,
	} from './character-profile-form-state.ts';

	interface Props {
		entries: SceneDetailEntry[];
		latestScene: number;
		onChange: (entries: SceneDetailEntry[]) => void;
	}

	let { entries, latestScene, onChange }: Props = $props();

	const editorId = $props.id();

	const issues = $derived(inspectSceneDetailEntries(entries));
	const rows = $derived(buildSceneDetailRows(entries, latestScene));

	let addChoices = $state<Record<string, number>>({});

	function addChoice(row: Extract<SceneDetailRow, { kind: 'add' }>): number {
		const chosen = addChoices[row.key];
		return chosen !== undefined && chosen >= row.range.min && chosen <= row.range.max ? chosen : row.range.max;
	}

	function clampScene(value: number, range: SceneDetailRange): number | null {
		if (!Number.isFinite(value)) return null;
		return Math.min(range.max, Math.max(range.min, Math.round(value)));
	}

	function updateEntry(index: number, patch: Partial<SceneDetailEntry>): void {
		onChange(entries.map((entry, current) => (current === index ? { ...entry, ...patch } : entry)));
	}

	function handleSceneChange(index: number, event: Event, range: SceneDetailRange): void {
		const clamped = clampScene((event.currentTarget as HTMLInputElement).valueAsNumber, range);
		if (clamped !== null) updateEntry(index, { sceneNumber: clamped });
	}

	function handleAddSceneChange(key: string, event: Event, range: SceneDetailRange): void {
		const clamped = clampScene((event.currentTarget as HTMLInputElement).valueAsNumber, range);
		if (clamped !== null) addChoices = { ...addChoices, [key]: clamped };
	}

	function handleDetailsInput(index: number, event: Event): void {
		updateEntry(index, { details: (event.currentTarget as HTMLInputElement).value });
	}

	async function addRow(row: Extract<SceneDetailRow, { kind: 'add' }>): Promise<void> {
		const newIndex = entries.length;
		const sceneNumber = addChoice(row);
		onChange([...entries, { sceneNumber, details: '' }]);
		await tick();
		document.getElementById(`${editorId}-details-${newIndex}`)?.focus();
	}

	function removeRow(index: number): void {
		onChange(entries.filter((_, current) => current !== index));
	}
</script>

<div class="space-y-3">
	{#if issues.duplicateNumbers.length > 0}
		<p class="text-xs text-error-500">
			{t('chat.context.duplicateSceneNumbers', { sceneNumbers: issues.duplicateNumbers.join(', ') })}
		</p>
	{/if}

	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-xs text-surface-500">
					<th class="w-16 pb-2 font-medium">{t('chat.context.sceneNumber')}</th>
					<th class="pb-2 font-medium">{t('chat.context.sceneDetail')}</th>
					<th class="w-10 pb-2 text-right font-medium">{t('chat.remove')}</th>
				</tr>
			</thead>
			<tbody>
				{#each rows as row (row.kind === 'entry' ? `entry-${row.index}` : `add-${row.key}`)}
					{#if row.kind === 'entry'}
						<tr class="border-t border-surface-200-800 align-top">
							<td class="py-2 pr-2">
								{#if row.range.min < row.range.max}
									<input
										class="input w-16 text-sm"
										type="number"
										min={row.range.min}
										max={row.range.max}
										step="1"
										value={row.sceneNumber}
										aria-label={t('chat.context.sceneNumber')}
										onchange={(event) => handleSceneChange(row.index, event, row.range)}
									/>
								{:else}
									<span class="inline-block py-1.5 text-surface-700-300">{row.sceneNumber}</span>
								{/if}
							</td>
							<td class="py-2 pr-2">
								<input
									id="{editorId}-details-{row.index}"
									class="input w-full text-sm"
									type="text"
									placeholder={t('chat.context.sceneDetailPlaceholder')}
									value={entries[row.index].details}
									oninput={(event) => handleDetailsInput(row.index, event)}
								/>
								{#if issues.invalidRows.includes(row.index)}
									<p class="mt-1 text-xs text-error-500">{t('chat.context.sceneNumberInvalid')}</p>
								{:else if issues.duplicateNumbers.includes(row.sceneNumber)}
									<p class="mt-1 text-xs text-error-500">{t('chat.context.sceneNumberDuplicate')}</p>
								{/if}
							</td>
							<td class="py-2 text-right">
								<button
									class="flex h-9 w-9 items-center justify-center rounded-lg text-error-500 transition-colors hover:bg-surface-100-900"
									type="button"
									aria-label={t('chat.context.removeSceneDetail')}
									title={t('chat.context.removeSceneDetail')}
									onclick={() => removeRow(row.index)}
								>
									<Icon name="trash" class="h-4 w-4" />
								</button>
							</td>
						</tr>
					{:else}
						<tr class="border-t border-surface-200-800">
							<td class="py-2 pr-2">
								{#if row.range.min < row.range.max}
									<input
										class="input w-16 text-sm"
										type="number"
										min={row.range.min}
										max={row.range.max}
										step="1"
										value={addChoice(row)}
										aria-label={t('chat.context.sceneNumber')}
										onchange={(event) => handleAddSceneChange(row.key, event, row.range)}
									/>
								{:else}
									<span class="inline-block py-1.5 text-surface-500">{row.range.min}</span>
								{/if}
							</td>
							<td class="py-2 pr-2" colspan="2">
								<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={() => void addRow(row)}>
									{t('chat.context.addSceneDetail')}
								</button>
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
</div>
