<script lang="ts">
	import { tick } from 'svelte';
	import { t } from '#lib/i18n/index.ts';
	import { log } from '#lib/logging/logger.ts';
	import { toaster } from '#lib/stores/toaster.svelte.ts';
	import { getIsBusy, getMessages } from '#lib/ai/chat.svelte.ts';
	import { getActiveActLineId, getActiveStoryId } from '#lib/stores/stories.svelte.ts';
	import { getLastSceneNumber } from '#lib/db/act-lines.ts';
	import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
	import type { EquipStatus, InventoryCategory, InventoryEventType } from '#lib/db/inventory.ts';
	import {
		DuplicateInventoryItemError,
		addInventoryEntry,
		loadInventoryContext,
		removeInventoryEntry,
		updateInventoryEntry,
		type InventoryContext,
		type InventoryEntry,
		type InventoryEntryDraft,
		type InventoryItem,
	} from '#lib/features/inventory-context.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import InventoryEntryForm from './InventoryEntryForm.svelte';

	interface Props {
		messageId: string;
		profile: CharacterProfileEntity;
		onBack: () => void;
	}

	let { messageId, profile, onBack }: Props = $props();

	const actLineId = $derived(getActiveActLineId());
	const clickedSceneNumber = $derived(getMessages().find((message) => message.id === messageId)?.sceneNumber);
	const messageSetLength = $derived(getMessages().length);
	const characterKey = $derived(`${profile.canonicalName}|${profile.aliases.join('|')}`);
	const panelId = $props.id();

	let loading = $state(true);
	let loadError = $state(false);
	let inventoryContext = $state<InventoryContext | null>(null);
	let viewedItemName = $state<string | null>(null);
	let formMode = $state<'addItem' | 'addEntry' | 'editEntry' | null>(null);
	let formItem = $state<InventoryItem | null>(null);
	let formEntry = $state<InventoryEntry | null>(null);
	let removeTarget = $state<{ item: InventoryItem; entry: InventoryEntry | null } | null>(null);
	let saving = $state(false);
	let removing = $state(false);
	let actionError = $state<string | null>(null);
	let refreshError = $state<string | null>(null);
	let confirmPanel = $state<HTMLDivElement | null>(null);
	let panelBackButton = $state<HTMLButtonElement | null>(null);
	let detailBackButton = $state<HTMLButtonElement | null>(null);
	let removeFocus = $state<HTMLElement | null>(null);

	const viewedItem = $derived(
		inventoryContext === null || viewedItemName === null
			? null
			: ([...inventoryContext.items, ...inventoryContext.inactiveItems].find((item) => item.itemName === viewedItemName) ?? null)
	);
	const canMutate = $derived(
		inventoryContext?.editable === true && !getIsBusy() && formMode === null && removeTarget === null && !saving && !removing
	);
	const removeEntryDisabled = $derived(
		removeTarget === null || removeTarget.entry === null || removeTarget.entry.sceneNumber !== clickedSceneNumber
	);

	let disposed = false;
	$effect(() => () => {
		disposed = true;
	});

	$effect(() => {
		if (removeTarget !== null && confirmPanel !== null) confirmPanel.focus();
	});

	let lastViewedItemName: string | null = null;
	$effect(() => {
		const name = viewedItemName;
		if (name === lastViewedItemName) return;
		lastViewedItemName = name;
		if (name === null) return;
		void tick().then(() => detailBackButton?.scrollIntoView({ block: 'start' }));
	});

	function characterRef(): { canonicalName: string; aliases: string[] } {
		return { canonicalName: profile.canonicalName, aliases: profile.aliases };
	}

	function resetSubViews(): void {
		formMode = null;
		formItem = null;
		formEntry = null;
		viewedItemName = null;
		removeTarget = null;
		actionError = null;
		refreshError = null;
	}

	let requestId = 0;
	let loadedLineId: string | null = null;
	let loadedMessageId: string | null = null;
	let loadedSceneNumber: number | null = null;
	let loadedCharacterKey: string | null = null;
	let loadedMessageCount = -1;
	let wasBusy = false;
	$effect(() => {
		const lineId = actLineId;
		const currentMessageId = messageId;
		const sceneNumber = clickedSceneNumber;
		const currentCharacterKey = characterKey;
		const messageCount = messageSetLength;
		const busy = getIsBusy();
		const busyChanged = busy !== wasBusy;
		wasBusy = busy;
		const targetChanged =
			lineId !== loadedLineId ||
			currentMessageId !== loadedMessageId ||
			(sceneNumber ?? null) !== loadedSceneNumber ||
			currentCharacterKey !== loadedCharacterKey;
		const messageSetChanged = messageCount !== loadedMessageCount;
		if (!targetChanged && !messageSetChanged && !busyChanged) return;
		loadedMessageCount = messageCount;
		const token = ++requestId;
		if (targetChanged) {
			loadedLineId = lineId;
			loadedMessageId = currentMessageId;
			loadedSceneNumber = sceneNumber ?? null;
			loadedCharacterKey = currentCharacterKey;
			inventoryContext = null;
			loadError = false;
			resetSubViews();
		}
		if (lineId === null || sceneNumber === undefined) {
			loading = false;
			return;
		}
		if (targetChanged) loading = true;
		void load(token, lineId, sceneNumber, currentMessageId, currentCharacterKey, { silent: !targetChanged });
	});

	function isCurrentTarget(lineId: string, targetMessageId: string, sceneNumber: number, targetCharacterKey: string): boolean {
		if (disposed) return false;
		if (getActiveActLineId() !== lineId) return false;
		if (targetMessageId !== messageId) return false;
		if (targetCharacterKey !== characterKey) return false;
		return getMessages().find((message) => message.id === messageId)?.sceneNumber === sceneNumber;
	}

	function isCurrent(token: number, lineId: string, sceneNumber: number, targetMessageId: string, targetCharacterKey: string): boolean {
		if (disposed || token !== requestId) return false;
		return isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey);
	}

	async function load(
		token: number,
		lineId: string,
		sceneNumber: number,
		targetMessageId: string,
		targetCharacterKey: string,
		options: { silent?: boolean } = {}
	): Promise<InventoryContext | null> {
		try {
			const result = await loadInventoryContext(lineId, characterRef(), sceneNumber);
			if (!isCurrent(token, lineId, sceneNumber, targetMessageId, targetCharacterKey)) return null;
			inventoryContext = result;
			refreshError = null;
			loading = false;
			return result;
		} catch (err) {
			if (!isCurrent(token, lineId, sceneNumber, targetMessageId, targetCharacterKey)) return null;
			loading = false;
			if (options.silent && inventoryContext !== null) {
				refreshError = t('chat.context.loadFailed');
				await log.error('inventory', 'Failed to refresh inventory context', err);
				return null;
			}
			loadError = true;
			await log.error('inventory', 'Failed to load inventory context', err);
			return null;
		}
	}

	async function refresh(lineId: string, sceneNumber: number, options: { silent?: boolean } = {}): Promise<InventoryContext | null> {
		const token = ++requestId;
		const targetMessageId = messageId;
		const targetCharacterKey = characterKey;
		if (!options.silent) {
			loading = true;
			loadError = false;
		}
		return load(token, lineId, sceneNumber, targetMessageId, targetCharacterKey, { silent: options.silent });
	}

	async function ensureLatestScene(
		lineId: string,
		sceneNumber: number,
		targetMessageId: string,
		targetCharacterKey: string
	): Promise<boolean> {
		const lastSceneNumber = await getLastSceneNumber(lineId);
		if (!isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey)) return false;
		if (lastSceneNumber === sceneNumber) return true;
		actionError = t('chat.context.inventory.readOnly');
		void refresh(lineId, sceneNumber, { silent: true });
		return false;
	}

	function originLabel(sceneNumber: number | null): string {
		return sceneNumber === null ? t('chat.context.characterProfileBaseline') : t('chat.sceneLabel', { sceneNumber });
	}

	function categoryLabel(category: InventoryCategory | null): string {
		return category === null ? '—' : t(`chat.context.inventory.categories.${category}`);
	}

	function statusLabel(status: EquipStatus): string {
		return t(`chat.context.inventory.statuses.${status}`);
	}

	function eventLabel(eventType: InventoryEventType): string {
		return t(`chat.context.inventory.events.${eventType}`);
	}

	function startAddItem(): void {
		if (!canMutate) return;
		formMode = 'addItem';
		formItem = null;
		formEntry = null;
		actionError = null;
	}

	function startAddEntry(item: InventoryItem): void {
		if (!canMutate) return;
		formMode = 'addEntry';
		formItem = item;
		formEntry = null;
		actionError = null;
	}

	function startEditEntry(item: InventoryItem, entry: InventoryEntry): void {
		if (!canMutate || entry.sceneNumber !== clickedSceneNumber) return;
		formMode = 'editEntry';
		formItem = item;
		formEntry = entry;
		actionError = null;
	}

	function closeForm(): void {
		formMode = null;
		formItem = null;
		formEntry = null;
		actionError = null;
	}

	function startRemove(item: InventoryItem, entry: InventoryEntry | null, event: MouseEvent): void {
		if (!canMutate) return;
		closeForm();
		removeFocus = event.currentTarget as HTMLElement;
		removeTarget = { item, entry };
		actionError = null;
	}

	async function restoreRemoveFocus(): Promise<void> {
		await tick();
		(removeFocus?.isConnected ? removeFocus : panelBackButton)?.focus();
	}

	async function cancelRemove(): Promise<void> {
		if (removing) return;
		removeTarget = null;
		actionError = null;
		await restoreRemoveFocus();
	}

	async function handleSave(entryDraft: InventoryEntryDraft): Promise<void> {
		const lineId = actLineId;
		const sceneNumber = clickedSceneNumber;
		const storyId = getActiveStoryId();
		const mode = formMode;
		const item = formItem;
		const entry = formEntry;
		const targetMessageId = messageId;
		const targetCharacterKey = characterKey;
		if (saving || getIsBusy() || lineId === null || sceneNumber === undefined || mode === null || storyId === null) return;
		saving = true;
		try {
			if (!(await ensureLatestScene(lineId, sceneNumber, targetMessageId, targetCharacterKey))) return;
			if (mode === 'addItem') {
				await addInventoryEntry(storyId, lineId, targetMessageId, sceneNumber, characterRef(), entryDraft, 'item');
			} else if (mode === 'addEntry') {
				if (item === null) return;
				await addInventoryEntry(storyId, lineId, targetMessageId, sceneNumber, characterRef(), entryDraft, 'entry', item.ownerName);
			} else {
				if (entry === null) return;
				await updateInventoryEntry(lineId, sceneNumber, entry, entryDraft);
			}
			if (!isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey)) return;
			closeForm();
			const next = await refresh(lineId, sceneNumber);
			if (next !== null && mode !== 'addItem' && item !== null) viewedItemName = item.itemName;
		} catch (err) {
			if (!isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey)) return;
			const duplicate = err instanceof DuplicateInventoryItemError;
			const message = t(duplicate ? 'chat.context.inventory.duplicateItem' : 'chat.context.saveFailed');
			actionError = message;
			toaster.error({ title: message });
			await log.error('inventory', 'Failed to save inventory entry', err);
		} finally {
			saving = false;
		}
	}

	async function handleRemove(mode: 'entry' | 'history'): Promise<void> {
		const target = removeTarget;
		const lineId = actLineId;
		const sceneNumber = clickedSceneNumber;
		const targetMessageId = messageId;
		const targetCharacterKey = characterKey;
		if (removing || getIsBusy() || target === null || lineId === null || sceneNumber === undefined) return;
		const entry = mode === 'entry' ? target.entry : (target.entry ?? target.item.entries[target.item.entries.length - 1]);
		if (entry === null) return;
		if (mode === 'entry' && target.entry?.sceneNumber !== sceneNumber) return;
		removing = true;
		try {
			if (!(await ensureLatestScene(lineId, sceneNumber, targetMessageId, targetCharacterKey))) return;
			await removeInventoryEntry(lineId, sceneNumber, characterRef(), entry, mode);
			if (!isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey)) return;
			removeTarget = null;
			if (mode === 'history') viewedItemName = null;
			actionError = null;
			void refresh(lineId, sceneNumber);
			await restoreRemoveFocus();
		} catch (err) {
			if (!isCurrentTarget(lineId, targetMessageId, sceneNumber, targetCharacterKey)) return;
			actionError = t('chat.context.removeFailed');
			toaster.error({ title: t('chat.context.removeFailed') });
			await log.error('inventory', 'Failed to remove inventory entry', err);
		} finally {
			removing = false;
		}
	}
</script>

{#snippet itemsTable(items: InventoryItem[])}
	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr class="text-left text-xs text-surface-500">
					<th class="pb-2 font-medium">{t('chat.context.inventory.itemColumn')}</th>
					<th class="pb-2 font-medium">{t('chat.context.inventory.categoryColumn')}</th>
					<th class="pb-2 font-medium">{t('chat.context.inventory.statusColumn')}</th>
					<th class="pb-2 font-medium">{t('chat.context.inventory.lastChangeColumn')}</th>
					<th class="w-16 pb-2 text-right font-medium">{t('chat.context.inventory.actionsColumn')}</th>
				</tr>
			</thead>
			<tbody>
				{#each items as item (item.itemName)}
					{@const latest = item.entries[item.entries.length - 1]}
					<tr class="border-t border-surface-200-800">
						<td class="py-2 pr-2">
							<button
								class="text-left font-medium text-primary-500 hover:underline"
								type="button"
								onclick={() => (viewedItemName = item.itemName)}
							>
								{item.itemName}
							</button>
						</td>
						<td class="py-2 pr-2 text-surface-500">{categoryLabel(latest.category)}</td>
						<td class="py-2 pr-2">{statusLabel(latest.equipStatus)}</td>
						<td class="py-2 pr-2 text-surface-500">{originLabel(latest.sceneNumber)}</td>
						<td class="py-2">
							<div class="flex justify-end">
								<button
									class="flex h-9 w-9 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900"
									type="button"
									aria-label={t('chat.context.inventory.viewItem')}
									title={t('chat.context.inventory.viewItem')}
									onclick={() => (viewedItemName = item.itemName)}
								>
									<Icon name="eye" class="h-4 w-4" />
								</button>
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/snippet}

{#if !inventoryContext || loadError}
	{#if loadError}
		<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
	{:else if loading}
		<p class="text-sm text-surface-500">{t('chat.context.loading')}</p>
	{:else}
		<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
	{/if}
{:else}
	<div class="space-y-4">
		<header class="flex items-start gap-2">
			<button
				bind:this={panelBackButton}
				class="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900"
				type="button"
				aria-label={t('chat.context.backToProfiles')}
				title={t('chat.context.backToProfiles')}
				onclick={onBack}
			>
				<Icon name="chevron-left" class="h-5 w-5" />
			</button>
			<div class="min-w-0 flex-1">
				<h3 class="text-base font-medium">{t('chat.context.inventory.title')}</h3>
				<p class="text-xs text-surface-500">
					{profile.preferredName} · {t('chat.sceneLabel', { sceneNumber: clickedSceneNumber ?? 0 })}
				</p>
			</div>
		</header>

		{#if !inventoryContext.editable}
			<div class="rounded-(--radius-container) border border-warning-500/50 bg-warning-100-900 p-4">
				<p class="text-sm font-medium text-warning-600-400">{t('chat.context.inventory.readOnly')}</p>
			</div>
		{/if}

		{#if actionError !== null}
			<p class="text-sm text-error-500" role="alert">{actionError}</p>
		{/if}

		{#if refreshError !== null}
			<p class="text-sm text-error-500" role="alert">{refreshError}</p>
		{/if}

		{#if formMode !== null}
			<InventoryEntryForm
				mode={formMode}
				itemName={formMode === 'addItem' ? '' : (formItem?.itemName ?? '')}
				initialEntry={formMode === 'editEntry' ? formEntry : null}
				currentEquipStatus={formItem?.equipStatus ?? 'carried'}
				sceneNumber={clickedSceneNumber ?? 0}
				saving={saving || getIsBusy()}
				editable={inventoryContext.editable}
				onSave={handleSave}
				onCancel={closeForm}
			/>
		{:else if removeTarget !== null}
			<div
				class="rounded-(--radius-container) border border-error-500/50 bg-error-50-950 p-4 space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
				role="alertdialog"
				aria-labelledby="{panelId}-remove-title"
				tabindex="-1"
				bind:this={confirmPanel}
			>
				<h3 id="{panelId}-remove-title" class="text-base font-medium">
					{t('chat.context.inventory.removeItemTitle', { item: removeTarget.item.itemName })}
				</h3>

				<div class="space-y-2">
					<div>
						<button
							class="btn preset-tonal text-sm py-1.5 px-4"
							type="button"
							disabled={!inventoryContext.editable || removeEntryDisabled || removing || getIsBusy()}
							onclick={() => void handleRemove('entry')}
						>
							{t('chat.context.inventory.deleteEntry')}
						</button>
						<p class="text-xs text-surface-500 mt-1">{t('chat.context.inventory.deleteEntryHint')}</p>
						{#if removeEntryDisabled && removeTarget.entry !== null}
							<p class="text-xs text-warning-600-400 mt-1">
								{t('chat.context.inventory.deleteEntryUnavailable', { origin: originLabel(removeTarget.entry.sceneNumber) })}
							</p>
						{/if}
					</div>
					<div>
						<button
							class="btn preset-tonal text-sm py-1.5 px-4"
							type="button"
							disabled={!inventoryContext.editable || removing || getIsBusy()}
							onclick={() => void handleRemove('history')}
						>
							{t('chat.context.inventory.eraseHistory')}
						</button>
						<p class="text-xs text-surface-500 mt-1">{t('chat.context.inventory.eraseHistoryHint')}</p>
					</div>
				</div>

				<div class="flex justify-end">
					<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" disabled={removing} onclick={cancelRemove}>
						{t('chat.cancel')}
					</button>
				</div>
			</div>
		{:else if viewedItem !== null}
			<article class="rounded-(--radius-container) border border-surface-200-800 p-4 space-y-3">
				<header class="flex items-start gap-2">
					<button
						bind:this={detailBackButton}
						class="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900"
						type="button"
						aria-label={t('chat.context.inventory.backToInventory')}
						title={t('chat.context.inventory.backToInventory')}
						onclick={() => (viewedItemName = null)}
					>
						<Icon name="chevron-left" class="h-5 w-5" />
					</button>
					<div class="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
						<h3 class="text-base font-medium">{viewedItem.itemName}</h3>
						<span class="text-xs text-primary-500">{statusLabel(viewedItem.equipStatus)}</span>
					</div>
				</header>

				<p class="text-xs text-surface-500">
					{categoryLabel(viewedItem.category)} · {originLabel(viewedItem.entries[viewedItem.entries.length - 1].sceneNumber)}
				</p>

				{#if viewedItem.description?.trim()}
					<p class="text-sm leading-relaxed text-surface-800-200">{viewedItem.description}</p>
				{/if}

				{#if canMutate}
					<div class="flex flex-wrap gap-2">
						<button class="btn preset-tonal text-xs py-1 px-3" type="button" onclick={() => startAddEntry(viewedItem)}>
							{t('chat.context.inventory.addEntry')}
						</button>
						<button
							class="btn preset-tonal text-xs py-1 px-3"
							type="button"
							onclick={(event) => startRemove(viewedItem, viewedItem.entries[viewedItem.entries.length - 1] ?? null, event)}
						>
							{t('chat.context.inventory.removeItem')}
						</button>
					</div>
				{/if}

				<h4 class="pt-2 border-t border-surface-200-800 text-sm font-medium">{t('chat.context.inventory.history')}</h4>
				<div class="overflow-x-auto">
					<table class="w-full text-sm">
						<thead>
							<tr class="text-left text-xs text-surface-500">
								<th class="pb-2 font-medium">{t('chat.context.inventory.lastChangeColumn')}</th>
								<th class="pb-2 font-medium">{t('chat.context.inventory.eventType')}</th>
								<th class="pb-2 font-medium">{t('chat.context.inventory.statusColumn')}</th>
								<th class="pb-2 font-medium">{t('chat.context.inventory.description')}</th>
								<th class="w-24 pb-2 text-right font-medium">{t('chat.context.inventory.actionsColumn')}</th>
							</tr>
						</thead>
						<tbody>
							{#each viewedItem.entries as entry (entry.id)}
								{@const editableEntry = canMutate && entry.sceneNumber === clickedSceneNumber}
								<tr class="border-t border-surface-200-800 align-top">
									<td class="py-2 pr-2 text-surface-500">{originLabel(entry.sceneNumber)}</td>
									<td class="py-2 pr-2">{eventLabel(entry.eventType)}</td>
									<td class="py-2 pr-2">{statusLabel(entry.equipStatus)}</td>
									<td class="py-2 pr-2 text-surface-500">{entry.description ?? ''}</td>
									<td class="py-2">
										{#if canMutate}
											<div class="flex justify-end gap-1">
												<button
													class="flex h-9 w-9 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900 disabled:opacity-40"
													type="button"
													disabled={!editableEntry}
													aria-label={t('chat.context.inventory.editEntry')}
													title={t('chat.context.inventory.editEntry')}
													onclick={() => startEditEntry(viewedItem, entry)}
												>
													<Icon name="pencil" class="h-4 w-4" />
												</button>
												<button
													class="flex h-9 w-9 items-center justify-center rounded-lg text-error-500 transition-colors hover:bg-surface-100-900 disabled:opacity-40"
													type="button"
													disabled={!editableEntry}
													aria-label={t('chat.context.inventory.deleteEntry')}
													title={t('chat.context.inventory.deleteEntry')}
													onclick={(event) => startRemove(viewedItem, entry, event)}
												>
													<Icon name="trash" class="h-4 w-4" />
												</button>
											</div>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</article>
		{:else}
			{#if canMutate}
				<button class="btn preset-filled-primary-500 text-sm py-1.5 px-4" type="button" onclick={startAddItem}>
					{t('chat.context.inventory.addItem')}
				</button>
			{/if}

			{#if inventoryContext.items.length === 0 && inventoryContext.inactiveItems.length === 0}
				<p class="text-sm text-surface-500">{t('chat.context.inventory.empty')}</p>
			{/if}

			{#if inventoryContext.items.length > 0}
				<h4 class="text-sm font-medium">{t('chat.context.inventory.heldSection')}</h4>
				{@render itemsTable(inventoryContext.items)}
			{/if}

			{#if inventoryContext.inactiveItems.length > 0}
				<details class="rounded-(--radius-container) border border-surface-200-800 p-3">
					<summary class="cursor-pointer text-sm font-medium text-surface-500">
						{t('chat.context.inventory.inactiveSection')} ({inventoryContext.inactiveItems.length})
					</summary>
					<div class="pt-3">
						{@render itemsTable(inventoryContext.inactiveItems)}
					</div>
				</details>
			{/if}
		{/if}
	</div>
{/if}
