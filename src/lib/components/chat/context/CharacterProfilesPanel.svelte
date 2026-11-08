<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '#lib/i18n/index.ts';
	import { log } from '#lib/logging/logger.ts';
	import { toaster } from '#lib/stores/toaster.svelte.ts';
	import { getIsBusy, getMessages } from '#lib/ai/chat.svelte.ts';
	import { getActiveActLineId } from '#lib/stores/stories.svelte.ts';
	import { getLastSceneNumber } from '#lib/db/act-lines.ts';
	import {
		DuplicateProfileError,
		consolidateProfiles,
		loadProfileContext,
		removeProfile,
		saveProfile,
		type ProfileContext,
		type ProfileDraft,
	} from '#lib/features/character-profile-context.ts';
	import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
	import CharacterProfileForm from './CharacterProfileForm.svelte';
	import CharacterConsolidation from './CharacterConsolidation.svelte';

	interface Props {
		messageId: string;
	}

	let { messageId }: Props = $props();

	const actLineId = $derived(getActiveActLineId());
	const clicked = $derived(getMessages().find((m) => m.id === messageId));
	// Primitive projections: streaming replaces message objects but keeps these values stable,
	// so the load effect only reruns for a real target or message-set change.
	const clickedSceneNumber = $derived(getMessages().find((m) => m.id === messageId)?.sceneNumber);
	const messageSetLength = $derived(getMessages().length);
	const importanceLabelKey = (importance: CharacterProfileEntity['importance']): string => `chat.context.importance.${importance}`;
	const panelId = $props.id();

	let loading = $state(true);
	let loadError = $state(false);
	let profileContext = $state<ProfileContext | null>(null);

	let formMode = $state<'add' | 'edit' | null>(null);
	let editingProfile = $state<CharacterProfileEntity | null>(null);
	let saving = $state(false);
	let removeTarget = $state<CharacterProfileEntity | null>(null);
	let removing = $state(false);
	let consolidationOpen = $state(false);
	let consolidating = $state(false);
	let actionError = $state<string | null>(null);
	// Silent-refresh failures stay inline so an open form or removal dialog is never unmounted.
	let refreshError = $state<string | null>(null);
	let confirmPanel = $state<HTMLDivElement | null>(null);
	let addTrigger = $state<HTMLButtonElement | null>(null);
	let consolidateTrigger = $state<HTMLButtonElement | null>(null);

	const isEditable = $derived(profileContext?.editable === true);
	const canMutate = $derived(isEditable && !getIsBusy() && formMode === null && removeTarget === null && !saving && !removing);
	const canConsolidate = $derived(canMutate && profileContext !== null && profileContext.profiles.length >= 2);
	const removeEntryDisabled = $derived(removeTarget === null || clicked === undefined || removeTarget.sceneNumber !== clicked.sceneNumber);

	let disposed = false;
	$effect(() => () => {
		disposed = true;
	});

	// A newer request (message, line, message-set change or run settle) supersedes any in-flight load.
	let requestId = 0;
	let loadedLineId: string | null = null;
	let loadedSceneNumber: number | null = null;
	let loadedMessageCount = -1;
	let wasBusy = false;
	$effect(() => {
		const lineId = actLineId;
		const sceneNumber = clickedSceneNumber;
		const messageCount = messageSetLength;
		// A completed generation persists the assistant message at scene+1 without changing the message
		// set (that draft was appended at run start), so the busy flag must also refresh editability.
		const busy = getIsBusy();
		const busyChanged = busy !== wasBusy;
		wasBusy = busy;
		const targetChanged = lineId !== loadedLineId || (sceneNumber ?? null) !== loadedSceneNumber;
		const messageSetChanged = messageCount !== loadedMessageCount;
		if (!targetChanged && !messageSetChanged && !busyChanged) return;
		loadedMessageCount = messageCount;
		const token = ++requestId;
		if (targetChanged) {
			loadedLineId = lineId;
			loadedSceneNumber = sceneNumber ?? null;
			profileContext = null;
			loadError = false;
			refreshError = null;
			formMode = null;
			editingProfile = null;
			removeTarget = null;
			consolidationOpen = false;
			actionError = null;
		}
		if (lineId === null || sceneNumber === undefined) {
			loading = false;
			return;
		}
		// Only a target change shows the loading state; an appended message or a run settling refreshes
		// silently so an open draft survives (and so an in-flight target load keeps its spinner).
		if (targetChanged) loading = true;
		void load(token, lineId, sceneNumber, { silent: !targetChanged });
	});

	$effect(() => {
		if (removeTarget !== null && confirmPanel !== null) confirmPanel.focus();
	});

	function isCurrent(token: number, lineId: string, sceneNumber: number): boolean {
		if (disposed || token !== requestId) return false;
		return isCurrentTarget(lineId, sceneNumber);
	}

	function isCurrentTarget(lineId: string, sceneNumber: number): boolean {
		if (disposed) return false;
		if (getActiveActLineId() !== lineId) return false;
		return getMessages().find((m) => m.id === messageId)?.sceneNumber === sceneNumber;
	}

	async function load(token: number, lineId: string, sceneNumber: number, options: { silent?: boolean } = {}): Promise<void> {
		try {
			const result = await loadProfileContext(lineId, sceneNumber);
			if (!isCurrent(token, lineId, sceneNumber)) return;
			profileContext = result;
			refreshError = null;
			loading = false;
		} catch (err) {
			if (!isCurrent(token, lineId, sceneNumber)) return;
			loading = false;
			// A silent refresh must keep the last context (and any open form/dialog) instead of
			// swapping the whole panel for the error branch.
			if (options.silent && profileContext !== null) {
				refreshError = t('chat.context.loadFailed');
				await log.error('character-profile', 'Failed to refresh character profiles', err);
				return;
			}
			loadError = true;
			await log.error('character-profile', 'Failed to load character profiles', err);
		}
	}

	async function refresh(lineId: string, sceneNumber: number, options: { silent?: boolean } = {}): Promise<void> {
		const token = ++requestId;
		if (!options.silent) {
			loading = true;
			loadError = false;
		}
		await load(token, lineId, sceneNumber, { silent: options.silent });
	}

	function originLabel(sceneNumber: number | null): string {
		return sceneNumber === null ? t('chat.context.characterProfileBaseline') : t('chat.sceneLabel', { sceneNumber });
	}

	function profileFields(profile: CharacterProfileEntity): { labelKey: string; value: string }[] {
		const aliases = profile.aliases.filter((alias) => alias !== profile.preferredName).join(', ');
		return [
			{ labelKey: 'chat.context.aliases', value: aliases },
			{ labelKey: 'chat.context.state', value: profile.state?.trim() ?? '' },
			{ labelKey: 'chat.context.goal', value: profile.goal?.trim() ?? '' },
			{ labelKey: 'chat.context.relationships', value: profile.relationships?.trim() ?? '' },
			{ labelKey: 'chat.context.voice', value: profile.voice?.trim() ?? '' },
			{ labelKey: 'chat.context.traits', value: profile.traits.join(', ') },
			{ labelKey: 'chat.context.sceneDetails', value: profile.sceneDetails.trim() },
		];
	}

	function closeForm(): void {
		formMode = null;
		editingProfile = null;
		actionError = null;
	}

	function startAdd(): void {
		if (!canMutate) return;
		editingProfile = null;
		actionError = null;
		formMode = 'add';
	}

	function startEdit(profile: CharacterProfileEntity): void {
		if (!canMutate) return;
		editingProfile = profile;
		actionError = null;
		formMode = 'edit';
	}

	function startRemove(profile: CharacterProfileEntity): void {
		if (!canMutate) return;
		closeForm();
		removeTarget = profile;
	}

	function cancelRemove(): void {
		if (removing) return;
		removeTarget = null;
		actionError = null;
	}

	/**
	 * Every mutation must land on the still-latest scene. Returns false when the selected
	 * target went stale during the check or the scene is no longer editable. The form or
	 * removal dialog stays open with an inline error so a failed save never discards the draft.
	 */
	async function ensureLatestScene(lineId: string, sceneNumber: number): Promise<boolean> {
		const lastSceneNumber = await getLastSceneNumber(lineId);
		if (!isCurrentTarget(lineId, sceneNumber)) return false;
		if (lastSceneNumber === sceneNumber) return true;
		actionError = t('chat.context.characterProfilesReadOnly');
		void refresh(lineId, sceneNumber, { silent: true });
		return false;
	}

	async function handleSave(draft: ProfileDraft, previous: CharacterProfileEntity | null): Promise<void> {
		if (saving || getIsBusy()) return;
		const lineId = actLineId;
		const sceneNumber = clicked?.sceneNumber;
		if (lineId === null || sceneNumber === undefined) return;
		saving = true;
		try {
			if (!(await ensureLatestScene(lineId, sceneNumber))) return;
			await saveProfile(lineId, sceneNumber, previous, draft);
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			closeForm();
			void refresh(lineId, sceneNumber);
		} catch (err) {
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			const duplicate = err instanceof DuplicateProfileError;
			const message = t(duplicate ? 'chat.context.addProfileDuplicate' : 'chat.context.saveFailed');
			actionError = message;
			toaster.error({ title: message });
			await log.error('character-profile', 'Failed to save character profile', err);
		} finally {
			saving = false;
		}
	}

	async function handleRemove(mode: 'entry' | 'context'): Promise<void> {
		const target = removeTarget;
		const lineId = actLineId;
		const sceneNumber = clicked?.sceneNumber;
		if (removing || getIsBusy() || target === null || lineId === null || sceneNumber === undefined) return;
		if (mode === 'entry' && target.sceneNumber !== sceneNumber) return;
		removing = true;
		try {
			if (!(await ensureLatestScene(lineId, sceneNumber))) return;
			await removeProfile(lineId, sceneNumber, target, mode);
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			removeTarget = null;
			actionError = null;
			void refresh(lineId, sceneNumber);
		} catch (err) {
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			actionError = t('chat.context.removeFailed');
			toaster.error({ title: t('chat.context.removeFailed') });
			await log.error('character-profile', 'Failed to remove character profile', err);
		} finally {
			removing = false;
		}
	}

	function startConsolidate(): void {
		if (!canConsolidate) return;
		closeForm();
		removeTarget = null;
		actionError = null;
		consolidationOpen = true;
	}

	async function cancelConsolidate(): Promise<void> {
		if (consolidating) return;
		consolidationOpen = false;
		actionError = null;
		await restoreActionFocus();
	}

	/**
	 * Focus returns to the remounted Consolidate trigger; consolidation can drop the list below two
	 * profiles (unmounting the trigger), so the Add button is the fallback.
	 */
	async function restoreActionFocus(): Promise<void> {
		await tick();
		(consolidateTrigger ?? addTrigger)?.focus();
	}

	async function handleConsolidate(destination: CharacterProfileEntity, sources: CharacterProfileEntity[]): Promise<void> {
		const lineId = actLineId;
		const sceneNumber = clicked?.sceneNumber;
		if (consolidating || getIsBusy() || lineId === null || sceneNumber === undefined || sources.length === 0) return;
		consolidating = true;
		try {
			if (!(await ensureLatestScene(lineId, sceneNumber))) return;
			await consolidateProfiles(lineId, sceneNumber, destination, sources);
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			consolidationOpen = false;
			actionError = null;
			await refresh(lineId, sceneNumber);
			await restoreActionFocus();
		} catch (err) {
			if (!isCurrentTarget(lineId, sceneNumber)) return;
			actionError = t('chat.context.consolidateFailed');
			toaster.error({ title: t('chat.context.consolidateFailed') });
			await log.error('character-profile', 'Failed to consolidate character profiles', err);
		} finally {
			consolidating = false;
		}
	}
</script>

{#if !clicked || !actLineId || loadError}
	<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
{:else if loading}
	<p class="text-sm text-surface-500">{t('chat.context.loading')}</p>
{:else if !profileContext}
	<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
{:else}
	<div class="space-y-4">
		{#if !profileContext.editable}
			<div class="rounded-(--radius-container) border border-warning-500/50 bg-warning-100-900 p-4">
				<p class="text-sm font-medium text-warning-600-400">{t('chat.context.characterProfilesReadOnly')}</p>
			</div>
		{/if}

		{#if actionError !== null}
			<p class="text-sm text-error-500" role="alert">{actionError}</p>
		{/if}

		{#if refreshError !== null}
			<p class="text-sm text-error-500" role="alert">{refreshError}</p>
		{/if}

		{#if formMode !== null}
			<CharacterProfileForm
				initial={formMode === 'edit' ? editingProfile : null}
				sceneNumber={clicked.sceneNumber}
				saving={saving || getIsBusy()}
				editable={profileContext.editable}
				onSave={handleSave}
				onCancel={closeForm}
			/>
		{/if}

		{#if removeTarget !== null}
			<div
				class="rounded-(--radius-container) border border-error-500/50 bg-error-50-950 p-4 space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
				role="alertdialog"
				aria-labelledby="{panelId}-remove-title"
				aria-describedby="{panelId}-remove-description"
				tabindex="-1"
				bind:this={confirmPanel}
			>
				<div class="space-y-1">
					<h3 id="{panelId}-remove-title" class="text-base font-medium">
						{t('chat.context.removeProfileTitle', { name: removeTarget.preferredName })}
					</h3>
					<p id="{panelId}-remove-description" class="text-sm text-surface-500">
						{t('chat.context.removeProfileExplanation')}
					</p>
				</div>

				<div class="space-y-2">
					<div>
						<button
							class="btn preset-tonal text-sm py-1.5 px-4"
							type="button"
							disabled={!isEditable || removeEntryDisabled || removing || getIsBusy()}
							onclick={() => void handleRemove('entry')}
						>
							{t('chat.context.removeEntry')}
						</button>
						<p class="text-xs text-surface-500 mt-1">{t('chat.context.removeEntryHint')}</p>
						{#if removeEntryDisabled}
							<p class="text-xs text-warning-600-400 mt-1">
								{t('chat.context.removeEntryUnavailable', { origin: originLabel(removeTarget.sceneNumber) })}
							</p>
						{/if}
					</div>
					<div>
						<button
							class="btn preset-tonal text-sm py-1.5 px-4"
							type="button"
							disabled={!isEditable || removing || getIsBusy()}
							onclick={() => void handleRemove('context')}
						>
							{t('chat.context.eraseFromContext')}
						</button>
						<p class="text-xs text-surface-500 mt-1">{t('chat.context.eraseFromContextHint')}</p>
					</div>
				</div>

				<div class="flex justify-end">
					<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" disabled={removing} onclick={cancelRemove}>
						{t('chat.cancel')}
					</button>
				</div>
			</div>
		{/if}

		{#if consolidationOpen}
			<CharacterConsolidation
				profiles={profileContext.profiles}
				saving={consolidating || getIsBusy() || !profileContext.editable}
				onConfirm={handleConsolidate}
				onCancel={cancelConsolidate}
			/>
		{:else}
			{#if canMutate}
				<div class="flex flex-wrap gap-2">
					<button class="btn preset-filled-primary-500 text-sm py-1.5 px-4" type="button" bind:this={addTrigger} onclick={startAdd}>
						{t('chat.context.addProfile')}
					</button>
					{#if canConsolidate}
						<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" bind:this={consolidateTrigger} onclick={startConsolidate}>
							{t('chat.context.consolidateProfiles')}
						</button>
					{/if}
				</div>
			{/if}

			{#if profileContext.profiles.length === 0}
				<p class="text-sm text-surface-500">{t('chat.context.characterProfilesEmpty')}</p>
			{:else}
				{#each profileContext.profiles as profile (profile.id)}
					<article class="rounded-(--radius-container) border border-surface-200-800 p-4 space-y-3">
						<header class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
							<h3 class="text-base font-medium">{profile.preferredName}</h3>
							<span class="text-xs text-primary-500">{t(importanceLabelKey(profile.importance))}</span>
						</header>
						<p class="text-xs text-surface-500">{originLabel(profile.sceneNumber)}</p>

						{#if canMutate}
							<div class="flex flex-wrap gap-2">
								<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={() => startEdit(profile)}>
									{t('chat.edit')}
								</button>
								<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={() => startRemove(profile)}>
									{t('chat.remove')}
								</button>
							</div>
						{/if}

						{#if profile.logline.trim()}
							<p class="text-sm leading-relaxed text-surface-800-200">{profile.logline}</p>
						{/if}

						<dl class="space-y-2 text-sm">
							{#each profileFields(profile) as field (field.labelKey)}
								{#if field.value.length > 0}
									<div>
										<dt class="text-xs text-surface-500">{t(field.labelKey)}</dt>
										<dd class="whitespace-pre-line leading-relaxed text-surface-800-200">{field.value}</dd>
									</div>
								{/if}
							{/each}
						</dl>
					</article>
				{/each}
			{/if}
		{/if}
	</div>
{/if}
