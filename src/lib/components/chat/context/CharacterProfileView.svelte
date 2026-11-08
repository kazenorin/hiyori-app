<script lang="ts">
	import { onMount } from 'svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { t } from '#lib/i18n/index.ts';
	import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
	import { formatSceneDetailsAscending } from './character-profile-panel-state.ts';

	interface Props {
		profile: CharacterProfileEntity;
		editable: boolean;
		onBack: () => void;
		onEdit: () => void;
		onRemove: () => void;
	}

	let { profile, editable, onBack, onEdit, onRemove }: Props = $props();

	let backButton = $state<HTMLButtonElement | null>(null);

	const importanceLabelKey = (importance: CharacterProfileEntity['importance']): string => `chat.context.importance.${importance}`;
	const originLabel = (sceneNumber: number | null): string =>
		sceneNumber === null ? t('chat.context.characterProfileBaseline') : t('chat.sceneLabel', { sceneNumber });

	// The view replaces the list inside the same scroll container; bring it into view when opened.
	onMount(() => {
		backButton?.scrollIntoView({ block: 'start' });
		backButton?.focus();
	});

	const fields = $derived([
		{ labelKey: 'chat.context.aliases', value: profile.aliases.filter((alias) => alias !== profile.preferredName).join(', ') },
		{ labelKey: 'chat.context.state', value: profile.state?.trim() ?? '' },
		{ labelKey: 'chat.context.goal', value: profile.goal?.trim() ?? '' },
		{ labelKey: 'chat.context.relationships', value: profile.relationships?.trim() ?? '' },
		{ labelKey: 'chat.context.voice', value: profile.voice?.trim() ?? '' },
		{ labelKey: 'chat.context.traits', value: profile.traits.join(', ') },
		{ labelKey: 'chat.context.sceneDetails', value: formatSceneDetailsAscending(profile.sceneDetails) },
	]);
</script>

<article class="rounded-(--radius-container) border border-surface-200-800 p-4 space-y-3">
	<header class="flex items-start gap-2">
		<button
			bind:this={backButton}
			class="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900"
			type="button"
			aria-label={t('chat.context.backToProfiles')}
			title={t('chat.context.backToProfiles')}
			onclick={onBack}
		>
			<Icon name="chevron-left" class="h-5 w-5" />
		</button>
		<div class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
			<h3 class="text-base font-medium">{profile.preferredName}</h3>
			<span class="text-xs text-primary-500">{t(importanceLabelKey(profile.importance))}</span>
		</div>
	</header>

	<p class="text-xs text-surface-500">{originLabel(profile.sceneNumber)}</p>

	{#if editable}
		<div class="flex flex-wrap gap-2">
			<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={onEdit}>{t('chat.edit')}</button>
			<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={onRemove}>{t('chat.remove')}</button>
		</div>
	{/if}

	{#if profile.logline.trim()}
		<p class="text-sm leading-relaxed text-surface-800-200">{profile.logline}</p>
	{/if}

	<dl class="space-y-2 text-sm">
		{#each fields as field (field.labelKey)}
			{#if field.value.length > 0}
				<div>
					<dt class="text-xs text-surface-500">{t(field.labelKey)}</dt>
					<dd class="whitespace-pre-line leading-relaxed text-surface-800-200">{field.value}</dd>
				</div>
			{/if}
		{/each}
	</dl>
</article>
