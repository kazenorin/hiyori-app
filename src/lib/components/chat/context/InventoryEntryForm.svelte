<script lang="ts">
	import { onMount } from 'svelte';
	import { t } from '#lib/i18n/index.ts';
	import ThemedSelect from '#lib/components/ThemedSelect.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import {
		EQUIP_STATUSES,
		INVENTORY_CATEGORIES,
		INVENTORY_EVENT_TYPES,
		type EquipStatus,
		type InventoryCategory,
		type InventoryEventType,
	} from '#lib/db/inventory.ts';
	import type { InventoryEntry, InventoryEntryDraft } from '#lib/features/inventory-context.ts';
	import {
		buildInventoryDraft,
		eventImpliesEquipStatus,
		nextCategoryChoice,
		type InventoryCategoryChoice,
	} from './inventory-form-state.ts';

	interface Props {
		mode: 'addItem' | 'addEntry' | 'editEntry';
		itemName: string;
		initialEntry: InventoryEntry | null;
		currentEquipStatus: EquipStatus;
		sceneNumber: number;
		saving: boolean;
		editable: boolean;
		onSave: (draft: InventoryEntryDraft) => void;
		onCancel: () => void;
	}

	let { mode, itemName, initialEntry, currentEquipStatus, sceneNumber, saving, editable, onSave, onCancel }: Props = $props();

	const formId = $props.id();
	let backButton = $state<HTMLButtonElement | null>(null);

	// svelte-ignore state_referenced_locally
	let formItemName = $state(mode === 'addItem' ? '' : itemName);
	// svelte-ignore state_referenced_locally
	let formEventType = $state<InventoryEventType>(initialEntry?.eventType ?? (mode === 'addEntry' ? 'modified' : 'acquired'));
	// svelte-ignore state_referenced_locally
	let formCategoryChoice = $state<InventoryCategoryChoice>(
		initialEntry === null ? (mode === 'addEntry' ? 'inherit' : 'none') : (initialEntry.category ?? 'none')
	);
	// svelte-ignore state_referenced_locally
	let formEquipStatus = $state<EquipStatus>(initialEntry?.equipStatus ?? currentEquipStatus);
	// svelte-ignore state_referenced_locally
	let formDescription = $state(initialEntry?.description ?? '');

	const titleKey = $derived(
		mode === 'addItem'
			? 'chat.context.inventory.addItem'
			: mode === 'addEntry'
				? 'chat.context.inventory.addEntry'
				: 'chat.context.inventory.editEntry'
	);
	const eventItems = $derived(
		INVENTORY_EVENT_TYPES.map((eventType) => ({ value: eventType, label: t(`chat.context.inventory.events.${eventType}`) }))
	);
	const categoryItems = $derived([
		...(mode === 'addEntry' && formEventType !== 'acquired'
			? [{ value: 'inherit' as const, label: t('chat.context.inventory.categoryInherit') }]
			: []),
		{ value: 'none' as const, label: t('chat.context.inventory.categoryNone') },
		...INVENTORY_CATEGORIES.map((category: InventoryCategory) => ({
			value: category,
			label: t(`chat.context.inventory.categories.${category}`),
		})),
	]);
	const statusItems = $derived(EQUIP_STATUSES.map((status) => ({ value: status, label: t(`chat.context.inventory.statuses.${status}`) })));
	const impliesStatus = $derived(eventImpliesEquipStatus(formEventType));
	const itemNameMissing = $derived(mode === 'addItem' && formItemName.trim().length === 0);
	const saveDisabled = $derived(saving || !editable || itemNameMissing);

	onMount(() => {
		backButton?.scrollIntoView({ block: 'start' });
		backButton?.focus();
	});

	function handleEventChange(value: InventoryEventType): void {
		formEventType = value;
		formCategoryChoice = nextCategoryChoice(value, formCategoryChoice);
		if (value === 'acquired' && (formEquipStatus === 'lost' || formEquipStatus === 'consumed')) formEquipStatus = 'carried';
	}

	function handleKeydown(event: KeyboardEvent): void {
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			submit();
		}
	}

	function submit(): void {
		if (saveDisabled) return;
		onSave(
			buildInventoryDraft({
				itemName: mode === 'addItem' ? formItemName : itemName,
				eventType: formEventType,
				categoryChoice: formCategoryChoice,
				equipStatus: formEquipStatus,
				description: formDescription,
			})
		);
	}
</script>

<div class="rounded-(--radius-container) border border-primary-500/40 bg-primary-50-950 p-4 space-y-4">
	<header class="flex items-start gap-2">
		<button
			bind:this={backButton}
			class="-ml-2 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-surface-100-900"
			type="button"
			aria-label={t('chat.back')}
			title={t('chat.back')}
			onclick={onCancel}
		>
			<Icon name="chevron-left" class="h-5 w-5" />
		</button>
		<div class="space-y-1">
			<h3 class="text-base font-medium">{t(titleKey)}</h3>
			<p class="text-xs text-surface-500">{t('chat.sceneLabel', { sceneNumber })}</p>
		</div>
	</header>

	<div class="grid gap-3 sm:grid-cols-2">
		{#if mode === 'addItem'}
			<label class="block sm:col-span-2" for="{formId}-item-name">
				<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.itemName')}</span>
				<input
					id="{formId}-item-name"
					class="input mt-1 w-full text-sm"
					type="text"
					bind:value={formItemName}
					aria-invalid={itemNameMissing}
					aria-describedby={itemNameMissing ? `${formId}-item-name-error` : undefined}
					onkeydown={handleKeydown}
				/>
				{#if itemNameMissing}
					<span id="{formId}-item-name-error" class="text-xs text-error-500 mt-1 block">
						{t('chat.context.inventory.itemNameRequired')}
					</span>
				{/if}
			</label>
		{:else}
			<div class="block sm:col-span-2">
				<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.itemName')}</span>
				<p class="mt-1 text-sm text-surface-800-200">{itemName}</p>
			</div>
		{/if}

		<label class="block">
			<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.eventType')}</span>
			<ThemedSelect items={eventItems} value={formEventType} onValueChange={handleEventChange} />
		</label>

		<label class="block">
			<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.category')}</span>
			<ThemedSelect items={categoryItems} value={formCategoryChoice} onValueChange={(value) => (formCategoryChoice = value)} />
		</label>

		{#if impliesStatus}
			<div class="block sm:col-span-2">
				<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.equipStatus')}</span>
				<p class="mt-1 text-xs text-surface-500">{t('chat.context.inventory.impliedStatusNote')}</p>
			</div>
		{:else}
			<label class="block">
				<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.equipStatus')}</span>
				<ThemedSelect items={statusItems} value={formEquipStatus} onValueChange={(value) => (formEquipStatus = value)} />
			</label>
		{/if}

		<label class="block sm:col-span-2" for="{formId}-description">
			<span class="text-sm font-medium text-surface-700-300">{t('chat.context.inventory.description')}</span>
			<textarea
				id="{formId}-description"
				class="input mt-1 w-full resize-y text-sm leading-relaxed"
				rows="2"
				bind:value={formDescription}
				onkeydown={handleKeydown}></textarea>
		</label>
	</div>

	<div class="flex flex-wrap gap-2 pt-3 border-t border-surface-200-800">
		<button class="btn preset-filled-primary-500 text-sm py-1.5 px-4" type="button" disabled={saveDisabled} onclick={submit}>
			{t('chat.save')}
		</button>
		<button class="btn preset-tonal text-sm py-1.5 px-4" type="button" disabled={saving} onclick={onCancel}>
			{t('chat.cancel')}
		</button>
	</div>
</div>
