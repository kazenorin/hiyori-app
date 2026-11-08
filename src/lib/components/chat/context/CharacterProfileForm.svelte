<script lang="ts">
	import { Tabs, TagsInput } from '@skeletonlabs/skeleton-svelte';
	import { t } from '#lib/i18n/index.ts';
	import ThemedSelect from '#lib/components/ThemedSelect.svelte';
	import SceneDetailsEditor from './SceneDetailsEditor.svelte';
	import { MAX_CHARACTER_TRAITS, type CharacterImportance, type CharacterProfileEntity } from '#lib/db/character-profiles.ts';
	import type { SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';
	import type { ProfileDraft } from '#lib/features/character-profile-context.ts';
	import { buildProfileDraft, initialAliasesText, initialSceneEntries, inspectSceneDetailEntries } from './character-profile-form-state.ts';

	interface Props {
		initial: CharacterProfileEntity | null;
		sceneNumber: number;
		saving: boolean;
		editable: boolean;
		onSave: (draft: ProfileDraft, previous: CharacterProfileEntity | null) => void;
		onCancel: () => void;
	}

	let { initial, sceneNumber, saving, editable, onSave, onCancel }: Props = $props();

	const formId = $props.id();

	type FormTab = 'details' | 'sceneDetails';
	let tab = $state<FormTab>('details');

	// svelte-ignore state_referenced_locally
	let formPreferredName = $state(initial?.preferredName ?? '');
	// svelte-ignore state_referenced_locally
	let formAliases = $state(initialAliasesText(initial));
	// svelte-ignore state_referenced_locally
	let formLogline = $state(initial?.logline ?? '');
	// svelte-ignore state_referenced_locally
	let formState = $state(initial?.state ?? '');
	// svelte-ignore state_referenced_locally
	let formGoal = $state(initial?.goal ?? '');
	// svelte-ignore state_referenced_locally
	let formRelationships = $state(initial?.relationships ?? '');
	// svelte-ignore state_referenced_locally
	let formVoice = $state(initial?.voice ?? '');
	// svelte-ignore state_referenced_locally
	let formTraits = $state<string[]>(initial?.traits ?? []);
	// svelte-ignore state_referenced_locally
	let formImportance = $state<CharacterImportance>(initial?.importance ?? 4);
	// svelte-ignore state_referenced_locally
	let formSceneEntries = $state<SceneDetailEntry[]>(initialSceneEntries(initial));

	const importanceItems = [1, 2, 3, 4].map((level) => ({ value: String(level), label: t(`chat.context.importance.${level}`) }));

	const preferredNameMissing = $derived(formPreferredName.trim().length === 0);
	const sceneDetailsInvalid = $derived(!inspectSceneDetailEntries(formSceneEntries).valid);
	const saveDisabled = $derived(saving || !editable || preferredNameMissing || sceneDetailsInvalid);

	function handleTabChange(details: { value: string | null }): void {
		if (details.value === 'details' || details.value === 'sceneDetails') tab = details.value;
	}

	function handleImportanceChange(value: string): void {
		const level = Number(value);
		if (level === 1 || level === 2 || level === 3 || level === 4) formImportance = level;
	}

	function submit(): void {
		if (saveDisabled) return;
		const result = buildProfileDraft({
			initial,
			preferredName: formPreferredName,
			aliasesText: formAliases,
			logline: formLogline,
			state: formState,
			goal: formGoal,
			relationships: formRelationships,
			voice: formVoice,
			traitsText: formTraits.join(', '),
			importance: formImportance,
			sceneEntries: formSceneEntries,
		});
		if (result.error !== null) return;
		onSave(result.draft, initial);
	}
</script>

<div class="rounded-(--radius-container) border border-primary-500/40 bg-primary-50-950 p-4 space-y-4">
	<header class="space-y-1">
		<h3 class="text-base font-medium">{initial ? t('chat.context.editProfile') : t('chat.context.addProfile')}</h3>
		<p class="text-xs text-surface-500">{t('chat.sceneLabel', { sceneNumber })}</p>
	</header>

	<Tabs value={tab} onValueChange={handleTabChange}>
		<Tabs.List class="flex gap-1 border-b border-surface-200-800">
			<Tabs.Trigger
				value="details"
				class="px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {tab === 'details'
					? 'border-primary-500 text-primary-500'
					: 'border-transparent text-surface-500 hover:text-surface-800-200'}"
			>
				{t('chat.context.detailsTab')}
			</Tabs.Trigger>
			<Tabs.Trigger
				value="sceneDetails"
				class="px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors {tab === 'sceneDetails'
					? 'border-primary-500 text-primary-500'
					: 'border-transparent text-surface-500 hover:text-surface-800-200'}"
			>
				{t('chat.context.sceneDetails')}
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="details" class="pt-4">
			<div class="grid gap-3 sm:grid-cols-2">
				<label class="block sm:col-span-2" for="{formId}-preferred-name">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.preferredName')}</span>
					<input
						id="{formId}-preferred-name"
						class="input mt-1 w-full text-sm"
						type="text"
						bind:value={formPreferredName}
						aria-invalid={preferredNameMissing}
						aria-describedby={preferredNameMissing ? `${formId}-preferred-name-error` : undefined}
					/>
					{#if preferredNameMissing}
						<span id="{formId}-preferred-name-error" class="text-xs text-error-500 mt-1 block">
							{t('chat.context.preferredNameRequired')}
						</span>
					{/if}
				</label>

				<label class="block" for="{formId}-aliases">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.aliases')}</span>
					<input id="{formId}-aliases" class="input mt-1 w-full text-sm" type="text" bind:value={formAliases} />
				</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.importanceField')}</span>
					<ThemedSelect items={importanceItems} value={String(formImportance)} onValueChange={handleImportanceChange} />
				</label>

				<label class="block sm:col-span-2" for="{formId}-logline">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.logline')}</span>
					<input id="{formId}-logline" class="input mt-1 w-full text-sm" type="text" bind:value={formLogline} />
				</label>

				<label class="block" for="{formId}-state">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.state')}</span>
					<textarea id="{formId}-state" class="input mt-1 w-full resize-y text-sm leading-relaxed" rows="2" bind:value={formState}
					></textarea>
				</label>

				<label class="block" for="{formId}-goal">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.goal')}</span>
					<textarea id="{formId}-goal" class="input mt-1 w-full resize-y text-sm leading-relaxed" rows="2" bind:value={formGoal}></textarea>
				</label>

				<label class="block" for="{formId}-relationships">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.relationships')}</span>
					<textarea
						id="{formId}-relationships"
						class="input mt-1 w-full resize-y text-sm leading-relaxed"
						rows="2"
						bind:value={formRelationships}></textarea>
				</label>

				<label class="block" for="{formId}-voice">
					<span class="text-sm font-medium text-surface-700-300">{t('chat.context.voice')}</span>
					<textarea id="{formId}-voice" class="input mt-1 w-full resize-y text-sm leading-relaxed" rows="2" bind:value={formVoice}
					></textarea>
				</label>

				<div class="block sm:col-span-2">
					<TagsInput value={formTraits} onValueChange={(details) => (formTraits = details.value)} max={MAX_CHARACTER_TRAITS}>
						<TagsInput.Label class="text-sm font-medium text-surface-700-300">{t('chat.context.traits')}</TagsInput.Label>
						<TagsInput.Control class="text-sm">
							<!-- Index keys stay stable while a tag's text is edited; value keys would remount the item and drop focus. -->
							{#each formTraits as trait, index (index)}
								<TagsInput.Item value={trait} {index}>
									<TagsInput.ItemPreview>
										<TagsInput.ItemText>{trait}</TagsInput.ItemText>
										<TagsInput.ItemDeleteTrigger aria-label={`${t('chat.context.removeTrait')}: ${trait}`}>
											<span aria-hidden="true">×</span>
										</TagsInput.ItemDeleteTrigger>
									</TagsInput.ItemPreview>
									<TagsInput.ItemInput />
								</TagsInput.Item>
							{/each}
							<TagsInput.Input placeholder={t('chat.context.traitsPlaceholder')} />
						</TagsInput.Control>
						<p class="text-xs text-surface-500">{t('chat.context.traitsHint', { max: MAX_CHARACTER_TRAITS })}</p>
					</TagsInput>
				</div>
			</div>
		</Tabs.Content>

		<Tabs.Content value="sceneDetails" class="pt-4">
			<SceneDetailsEditor entries={formSceneEntries} onChange={(entries) => (formSceneEntries = entries)} />
		</Tabs.Content>
	</Tabs>

	<div class="pt-3 border-t border-surface-200-800 space-y-2">
		{#if sceneDetailsInvalid}
			<p class="text-xs text-error-500">{t('chat.context.sceneDetailsInvalid')}</p>
		{/if}
		<div class="flex flex-wrap gap-2">
			<button class="btn preset-filled-primary-500 text-sm py-1.5 px-4" type="button" disabled={saveDisabled} onclick={submit}>
				{t('chat.save')}
			</button>
			<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" onclick={onCancel}>
				{t('chat.cancel')}
			</button>
		</div>
	</div>
</div>
