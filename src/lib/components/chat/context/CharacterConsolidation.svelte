<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import { mergeProfileContent, type ProfileDraft } from '#lib/features/character-profile-context.ts';
	import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';

	interface Props {
		profiles: CharacterProfileEntity[];
		saving: boolean;
		onConfirm: (destination: CharacterProfileEntity, sources: CharacterProfileEntity[]) => void;
		onCancel: () => void;
	}

	let { profiles, saving, onConfirm, onCancel }: Props = $props();

	const groupId = $props.id();
	const titleId = `${groupId}-title`;

	let root = $state<HTMLDivElement | null>(null);
	let destinationId = $state<string | null>(null);
	let selectedSourceIds = $state<string[]>([]);

	// The view replaces the focused action button; move focus here so the change is announced.
	$effect(() => {
		root?.focus();
	});

	const destination = $derived(profiles.find((profile) => profile.id === destinationId) ?? null);
	// The selected destination never appears as a selectable source.
	const sourceCandidates = $derived(profiles.filter((profile) => profile.id !== destinationId));
	const sources = $derived(profiles.filter((profile) => profile.id !== destinationId && selectedSourceIds.includes(profile.id)));

	// The feature owns precedence and merge rules; this view only renders its result.
	const preview = $derived.by((): ProfileDraft | null => {
		if (destination === null || sources.length === 0) return null;
		try {
			return mergeProfileContent(destination, sources);
		} catch {
			return null;
		}
	});

	const confirmDisabled = $derived(saving || destination === null || sources.length === 0 || preview === null);

	function originLabel(sceneNumber: number | null): string {
		return sceneNumber === null ? t('chat.context.characterProfileBaseline') : t('chat.sceneLabel', { sceneNumber });
	}

	function selectDestination(id: string): void {
		if (saving) return;
		destinationId = id;
		// A profile cannot be both the destination and a source.
		if (selectedSourceIds.includes(id)) selectedSourceIds = selectedSourceIds.filter((sourceId) => sourceId !== id);
	}

	function toggleSource(id: string): void {
		if (saving || id === destinationId) return;
		selectedSourceIds = selectedSourceIds.includes(id)
			? selectedSourceIds.filter((sourceId) => sourceId !== id)
			: [...selectedSourceIds, id];
	}

	function confirm(): void {
		if (confirmDisabled || destination === null) return;
		onConfirm(destination, sources);
	}

	function previewFields(draft: ProfileDraft): { labelKey: string; value: string; wide: boolean }[] {
		const aliases = draft.aliases.filter((alias) => alias !== draft.preferredName).join(', ');
		return [
			{ labelKey: 'chat.context.aliases', value: aliases, wide: true },
			{ labelKey: 'chat.context.logline', value: draft.logline, wide: true },
			{ labelKey: 'chat.context.state', value: draft.state ?? '', wide: false },
			{ labelKey: 'chat.context.goal', value: draft.goal ?? '', wide: false },
			{ labelKey: 'chat.context.relationships', value: draft.relationships ?? '', wide: false },
			{ labelKey: 'chat.context.voice', value: draft.voice ?? '', wide: false },
			{ labelKey: 'chat.context.importanceField', value: t(`chat.context.importance.${draft.importance}`), wide: false },
			{ labelKey: 'chat.context.traits', value: draft.traits.join(', '), wide: true },
			{ labelKey: 'chat.context.sceneDetails', value: draft.sceneDetails, wide: true },
		];
	}

	function displayValue(value: string): string {
		const trimmed = value.trim();
		return trimmed.length === 0 ? '—' : trimmed;
	}
</script>

<div
	class="rounded-(--radius-container) border border-primary-500/40 bg-primary-50-950 p-4 space-y-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
	role="group"
	aria-labelledby={titleId}
	tabindex="-1"
	bind:this={root}
>
	<header class="space-y-1">
		<h3 id={titleId} class="text-base font-medium">{t('chat.context.consolidateProfiles')}</h3>
		<p class="text-sm text-surface-500">{t('chat.context.consolidateIntro')}</p>
	</header>

	<fieldset class="space-y-2" disabled={saving}>
		<legend class="text-sm font-medium text-surface-700-300">{t('chat.context.consolidateDestination')}</legend>
		<p class="text-xs text-surface-500">{t('chat.context.consolidateDestinationHint')}</p>
		<div class="grid gap-2 sm:grid-cols-2">
			{#each profiles as profile (profile.id)}
				<label
					class="flex items-start gap-2 rounded-(--radius-container) border border-surface-200-800 p-3 text-sm has-checked:border-primary-500 has-checked:bg-primary-100-900"
				>
					<input
						class="mt-1 accent-primary-500"
						type="radio"
						name="{groupId}-destination"
						value={profile.id}
						checked={destinationId === profile.id}
						onchange={() => selectDestination(profile.id)}
					/>
					<span class="min-w-0">
						<span class="block font-medium break-words">{profile.preferredName}</span>
						<span class="block text-xs text-surface-500">{originLabel(profile.sceneNumber)}</span>
					</span>
				</label>
			{/each}
		</div>
	</fieldset>

	<fieldset class="space-y-2" disabled={saving}>
		<legend class="text-sm font-medium text-surface-700-300">{t('chat.context.consolidateSources')}</legend>
		<p class="text-xs text-surface-500">{t('chat.context.consolidateSourcesHint')}</p>
		{#if sourceCandidates.length === 0}
			<p class="text-xs text-warning-600-400">{t('chat.context.consolidateDestinationExcluded')}</p>
		{:else}
			<div class="grid gap-2 sm:grid-cols-2">
				{#each sourceCandidates as profile (profile.id)}
					<label
						class="flex items-start gap-2 rounded-(--radius-container) border border-surface-200-800 p-3 text-sm has-checked:border-primary-500 has-checked:bg-primary-100-900"
					>
						<input
							class="mt-1 accent-primary-500"
							type="checkbox"
							checked={selectedSourceIds.includes(profile.id)}
							onchange={() => toggleSource(profile.id)}
						/>
						<span class="min-w-0">
							<span class="block font-medium break-words">{profile.preferredName}</span>
							<span class="block text-xs text-surface-500">{originLabel(profile.sceneNumber)}</span>
						</span>
					</label>
				{/each}
			</div>
		{/if}
		{#if destination === null}
			<p class="text-xs text-surface-500">{t('chat.context.consolidateChooseDestination')}</p>
		{:else if sources.length === 0}
			<p class="text-xs text-surface-500">{t('chat.context.consolidateChooseSource')}</p>
		{/if}
	</fieldset>

	{#if preview !== null}
		<section class="space-y-3 border-t border-surface-200-800 pt-4" aria-labelledby="{groupId}-preview-title">
			<h4 id="{groupId}-preview-title" class="text-sm font-medium">{t('chat.context.consolidatePreview')}</h4>
			<dl class="grid gap-3 text-sm sm:grid-cols-2">
				<div class="sm:col-span-2">
					<dt class="text-xs text-surface-500">{t('chat.context.preferredName')}</dt>
					<dd class="whitespace-pre-line break-words leading-relaxed text-surface-800-200">{preview.preferredName}</dd>
				</div>
				{#each previewFields(preview) as field (field.labelKey)}
					<div class={field.wide ? 'sm:col-span-2' : ''}>
						<dt class="text-xs text-surface-500">{t(field.labelKey)}</dt>
						<dd class="whitespace-pre-line break-words leading-relaxed text-surface-800-200">{displayValue(field.value)}</dd>
					</div>
				{/each}
			</dl>

			<div class="space-y-1 border-t border-surface-200-800 pt-3">
				<h4 class="text-sm font-medium text-warning-600-400">{t('chat.context.consolidateErasedTitle')}</h4>
				<ul class="list-disc pl-5 text-sm text-surface-800-200">
					{#each sources as source (source.id)}
						<li class="break-words">
							{source.preferredName}
							<span class="text-xs text-surface-500">({originLabel(source.sceneNumber)})</span>
						</li>
					{/each}
				</ul>
				<p class="text-xs text-surface-500">{t('chat.context.consolidateErasedNote')}</p>
			</div>
		</section>
	{/if}

	<div class="flex flex-wrap gap-2 border-t border-surface-200-800 pt-3">
		<button class="btn preset-filled-primary-500 text-sm py-1.5 px-4" type="button" disabled={confirmDisabled} onclick={confirm}>
			{t('chat.context.consolidateConfirm')}
		</button>
		<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" onclick={onCancel}>
			{t('chat.cancel')}
		</button>
	</div>
</div>
