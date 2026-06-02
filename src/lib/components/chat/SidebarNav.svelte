<script lang="ts">
	import { t } from '$lib/i18n';
	import {
		getStories,
		getActs,
		getActLines,
		getActiveStoryId,
		getActiveActId,
		getActiveActLineId,
		renameStory,
		renameAct,
		renameActLine,
		createActLine,
	} from '$lib/stores/stories.svelte';
	import { getIsActive as getIsWorldBuilderActive } from '$lib/features/world-builder/world-builder.svelte';
	import { batchGetActLineEventSummary, type ActLineEventSummary } from '$lib/db/act-lines';
	import { getActEnded, getStoryConcluded } from '$lib/ai/chat.svelte';
	import { getSettings, updateSettings } from '$lib/stores/settings.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';

	interface Props {
		onselectstory: (id: string) => void;
		onselectact: (id: string) => void;
		onselectactline: (id: string) => void;
		onrequestdeletestory: (id: string, name: string) => void;
		onrequestdeleteact: (id: string, name: string) => void;
		onrequestdeleteactline: (id: string, name: string) => void;
		onnewstory: () => void;
	}

	let { onselectstory, onselectact, onselectactline, onrequestdeletestory, onrequestdeleteact, onrequestdeleteactline, onnewstory }: Props =
		$props();

	let editingId = $state<string | null>(null);
	let editingType = $state<'story' | 'act' | 'line' | null>(null);
	let editingName = $state('');
	let renameSubmitting = $state(false);
	let newActLineName = $state('');
	let showNewActLine = $state(false);
	let actLineEventSummaries = $state<Map<string, ActLineEventSummary>>(new Map());
	let sidebarBlocked = $derived(getIsWorldBuilderActive());

	$effect(() => {
		const lines = getActLines();
		getActEnded(); // reactive dep: triggers re-run when actEnded changes
		getStoryConcluded(); // reactive dep: triggers re-run when storyConcluded changes
		if (lines.length === 0) {
			actLineEventSummaries = new Map();
			return;
		}
		const ids = lines.map((l) => l.id);
		batchGetActLineEventSummary(ids).then((map) => {
			actLineEventSummaries = map;
		});
	});

	function startRename(type: 'story' | 'act' | 'line', id: string, currentName: string) {
		editingId = id;
		editingType = type;
		editingName = currentName;
	}

	function cancelRename() {
		editingId = null;
		editingType = null;
		editingName = '';
		renameSubmitting = false;
	}

	async function submitRename() {
		if (renameSubmitting) return;
		renameSubmitting = true;
		const name = editingName.trim();
		if (!name || !editingId || !editingType) {
			cancelRename();
			return;
		}
		if (editingType === 'story') await renameStory(editingId, name);
		else if (editingType === 'act') await renameAct(editingId, name);
		else if (editingType === 'line') await renameActLine(editingId, name);
		cancelRename();
	}

	function handleRenameKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			submitRename();
		}
		if (e.key === 'Escape') cancelRename();
	}

	async function handleCreateActLine() {
		const name = newActLineName.trim();
		const actId = getActiveActId();
		if (!name || !actId) return;
		const line = await createActLine(actId, name);
		newActLineName = '';
		showNewActLine = false;
		onselectactline(line.id);
	}

	let fontSizeSlider = $derived(getSettings().fontSize);

	function handleFontSizeChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		updateSettings({ fontSize: parseFloat(target.value) });
	}
</script>

<nav class="flex-1 overflow-y-auto p-2 pt-4 space-y-1 relative">
	{#each getStories() as story (story.id)}
		<div class="space-y-0.5">
			<!-- Story header -->
			<div
				class="group flex items-center justify-between p-3 rounded-(--radius-base) transition-colors duration-150 cursor-pointer {getActiveStoryId() ===
				story.id
					? 'bg-surface-200-800'
					: 'hover:bg-surface-200-800'}"
				onclick={() => onselectstory(story.id)}
			>
				{#if editingId === story.id && editingType === 'story'}
					<input
						autofocus
						maxlength="200"
						class="input text-sm flex-1"
						bind:value={editingName}
						onkeydown={handleRenameKeydown}
						onblur={() => {
							if (!renameSubmitting) submitRename();
						}}
						onclick={(e) => e.stopPropagation()}
						type="text"
					/>
				{:else}
					<span class="text-sm font-medium truncate flex-1">{story.name}</span>
					<button
						class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
						type="button"
						onclick={(e) => {
							e.stopPropagation();
							startRename('story', story.id, story.name);
						}}
						title={t('sidebar.renameStory')}>&#9998;</button
					>
				{/if}
				<button
					class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
					type="button"
					onclick={(e) => {
						e.stopPropagation();
						onrequestdeletestory(story.id, story.name);
					}}
					title={t('sidebar.deleteStory')}>&times;</button
				>
			</div>

			<!-- Acts (only show for active story) -->
			{#if getActiveStoryId() === story.id}
				{#each getActs() as act (act.id)}
					<div class="ml-3 space-y-0.5">
						<div
							class="group flex items-center justify-between p-2 pl-4 rounded-(--radius-base) transition-colors duration-150 cursor-pointer text-sm {getActiveActId() ===
							act.id
								? 'bg-surface-200-800'
								: 'hover:bg-surface-200-800'}"
							onclick={() => onselectact(act.id)}
						>
							{#if editingId === act.id && editingType === 'act'}
								<input
									autofocus
									maxlength="200"
									class="input text-xs flex-1"
									bind:value={editingName}
									onkeydown={handleRenameKeydown}
									onblur={() => {
										if (!renameSubmitting) submitRename();
									}}
									onclick={(e) => e.stopPropagation()}
									type="text"
								/>
							{:else}
								<span class="truncate flex-1 text-surface-700-300">{t('common.actLabel', { n: act.actNumber })}: {act.name}</span>
								<button
									class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										startRename('act', act.id, act.name);
									}}
									title={t('sidebar.renameAct')}>&#9998;</button
								>
							{/if}
							{#if getActs().length > 1 && getActs().at(-1)?.id === act.id}
								<button
									class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
									type="button"
									onclick={(e) => {
										e.stopPropagation();
										onrequestdeleteact(act.id, act.name);
									}}
									title={t('sidebar.deleteAct')}>&times;</button
								>
							{/if}
						</div>

						<!-- Act Lines -->
						{#if getActiveActId() === act.id}
							{#each getActLines() as line (line.id)}
								<div
									class="group flex items-center justify-between p-2 pl-8 rounded-(--radius-base) transition-colors duration-150 cursor-pointer text-xs {getActiveActLineId() ===
									line.id
										? 'bg-primary-100-900 text-primary-700-300'
										: 'hover:bg-surface-200-800 text-surface-500'}"
									onclick={() => onselectactline(line.id)}
								>
									{#if editingId === line.id && editingType === 'line'}
										<input
											autofocus
											maxlength="200"
											class="input text-xs flex-1"
											bind:value={editingName}
											onkeydown={handleRenameKeydown}
											onblur={() => {
												if (!renameSubmitting) submitRename();
											}}
											onclick={(e) => e.stopPropagation()}
											type="text"
										/>
									{:else}
										<span class="truncate flex-1">{line.name}</span>
										{#if actLineEventSummaries.get(line.id)?.endedAt != null}
											<span class="text-[10px] font-medium text-surface-400-600 ml-1 shrink-0">{t('sidebar.actConcluded')}</span>
										{/if}
										<button
											class="text-surface-500 hover:text-surface-700-300 ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
											type="button"
											onclick={(e) => {
												e.stopPropagation();
												startRename('line', line.id, line.name);
											}}
											title={t('sidebar.renameLine')}>&#9998;</button
										>
									{/if}
									<button
										class="text-surface-500 hover:text-error-500 ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-xs shrink-0"
										type="button"
										onclick={(e) => {
											e.stopPropagation();
											onrequestdeleteactline(line.id, line.name);
										}}
										title={t('sidebar.deleteLine')}>&times;</button
									>
								</div>
							{/each}

							<!-- Add act line button -->
							{#if showNewActLine}
								<div class="pl-8 p-1">
									<div class="flex gap-1">
										<input
											class="input text-xs flex-1"
											placeholder={t('sidebar.lineNamePlaceholder')}
											bind:value={newActLineName}
											onkeydown={(e) => e.key === 'Enter' && handleCreateActLine()}
										/>
										<button class="text-xs text-primary-500" type="button" onclick={handleCreateActLine}>+</button>
									</div>
								</div>
							{:else}
								<button
									class="p-2 pl-8 text-xs text-surface-500 hover:text-surface-700-300 transition-colors"
									type="button"
									onclick={() => (showNewActLine = true)}
								>
									{t('sidebar.newLine')}
								</button>
							{/if}
						{/if}
					</div>
				{/each}
			{/if}
		</div>
	{/each}

	<!-- Add story button -->
	<button
		class="w-full p-3 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
		type="button"
		onclick={onnewstory}
	>
		{t('sidebar.newStory')}
	</button>

	<!-- Sidebar blocking overlay (covers nav only, not footer) -->
	{#if sidebarBlocked}
		<div
			class="absolute inset-0 z-10 bg-surface-50-950/60 backdrop-blur-sm flex items-center justify-center cursor-not-allowed"
			role="alert"
			aria-live="polite"
			aria-busy="true"
		>
			<div class="text-center space-y-2">
				<Spinner size="lg" />
				<p class="text-xs text-surface-500">{t('sidebar.worldBuilderActive')}</p>
			</div>
		</div>
	{/if}
</nav>

<!-- Sidebar footer -->
<div class="p-3 border-t border-surface-200-800 flex flex-col gap-1">
	<label class="flex items-center gap-2 px-2 py-1 text-xs text-surface-500">
		<span class="shrink-0 font-medium" style="font-size: 0.65rem;">Aa</span>
		<input
			class="flex-1 cursor-pointer"
			type="range"
			min="0.7"
			max="1.5"
			step="0.05"
			value={fontSizeSlider}
			oninput={handleFontSizeChange}
		/>
		<span class="shrink-0 w-8 text-right tabular-nums">{(fontSizeSlider * 100).toFixed(0)}%</span>
	</label>
	<a
		href="/"
		class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
	>
		{t('sidebar.chat')}
	</a>
	<a
		href="/settings"
		class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
	>
		{t('sidebar.settings')}
	</a>
	<a
		href="/memory-manager"
		class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
	>
		{t('sidebar.memoryManager')}
	</a>
	<a
		href="/file-manager"
		class="flex items-center gap-2 p-2 rounded-(--radius-base) hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
	>
		{t('sidebar.fileManager')}
	</a>
</div>
