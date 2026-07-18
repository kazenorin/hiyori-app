<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getActiveStory, getActiveAct, getActiveActLine, getActiveActLineId } from '$lib/stores/stories.svelte';
	import { t } from '$lib/i18n';
	import type { CharacterCardContext } from '$lib/features/character-card-generator';
	import {
		getCharacters,
		getIsExtracting,
		getIsGenerating,
		getExtractionError,
		getGenerationError,
		getRawExtractionOutput,
		getProgress,
		getResults,
		extractCharacters,
		generateCards,
		updateCharacter,
		addManualCharacter,
		removeCharacter,
		resetState,
	} from '$lib/stores/character-card.svelte';
	import { settings, updateSettings } from '$lib/stores/settings.svelte';
	import { getExistingCardNamesForActLine } from '$lib/features/character-card-generator';
	import { getActLine, getMessagesForLine } from '$lib/db/act-lines';
	import { traceActLineChain } from '$lib/db/acts';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { log } from '$lib/logging/logger';

	let concurrent = $state(false);
	let fallbackActNumber = $state<number | null>(null);
	let resolvedCtx = $state<CharacterCardContext | null>(null);
	let existingCardNames = $state<Set<string>>(new Set());

	let currentExtractionId = 0;

	async function buildContext(): Promise<CharacterCardContext | null> {
		const story = getActiveStory();
		if (!story) return null;
		const activeAct = getActiveAct();
		const activeActLine = getActiveActLine();
		const activeActLineId = getActiveActLineId();
		if (!activeAct || !activeActLine || !activeActLineId) return null;

		const messages = await getMessagesForLine(activeActLine.id);
		if (messages.length > 0) {
			fallbackActNumber = null;
			const ctx: CharacterCardContext = {
				storyId: story.id,
				storyName: story.name,
				actLineId: activeActLine.id,
				actLine: activeActLine,
				actNumber: activeAct.actNumber,
			};
			resolvedCtx = ctx;
			return ctx;
		}

		// No narrative content — walk lineage (newest-first) to find the closest ancestor with content
		const seedCtx: CharacterCardContext = {
			storyId: story.id,
			storyName: story.name,
			actLineId: activeActLine.id,
			actLine: activeActLine,
			actNumber: activeAct.actNumber,
		};
		const lineage = await traceActLineChain(seedCtx.actLineId, true);
		for (const entry of lineage) {
			if (entry.actLineId === activeActLine.id) continue;
			const ancestorMessages = await getMessagesForLine(entry.actLineId);
			if (ancestorMessages.length > 0) {
				const ancestorActLine = await getActLine(entry.actLineId);
				if (ancestorActLine) {
					fallbackActNumber = entry.actNumber;
					const ctx: CharacterCardContext = {
						storyId: story.id,
						storyName: story.name,
						actLineId: entry.actLineId,
						actLine: ancestorActLine,
						actNumber: entry.actNumber,
					};
					resolvedCtx = ctx;
					return ctx;
				}
			}
		}

		fallbackActNumber = null;
		resolvedCtx = null;
		return null;
	}

	$effect(() => {
		const id = getActiveActLineId();
		if (!id) {
			resetState();
			resolvedCtx = null;
			fallbackActNumber = null;
			existingCardNames = new Set();
			return;
		}
		let cancelled = false;
		const extractionId = ++currentExtractionId;
		(async () => {
			resetState();
			existingCardNames = new Set();
			const ctx = await buildContext();
			if (cancelled || extractionId !== currentExtractionId) return;
			if (ctx) {
				await extractCharacters(ctx);
				try {
					const names = await getExistingCardNamesForActLine(ctx);
					if (cancelled || extractionId !== currentExtractionId) return;
					existingCardNames = names;
				} catch (err) {
					await log.error('context-management', 'Failed to load existing character card names', err);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	});

	async function handleGenerate() {
		const ctx = await buildContext();
		if (ctx) await generateCards(ctx, concurrent);
	}

	function handleBack() {
		resetState();
		goto(resolve('/context-management'));
	}

	function updateCanonicalName(index: number, value: string) {
		updateCharacter(index, { canonicalName: value });
	}

	function updateInclude(index: number, value: boolean) {
		updateCharacter(index, { include: value });
	}

	function handleAddRow() {
		addManualCharacter();
	}

	function handleRemoveRow(index: number) {
		removeCharacter(index);
	}
</script>

<svelte:head>
	<title>{t('characterCards.heading')}</title>
</svelte:head>

<div class="flex-1 overflow-y-auto p-3 md:p-4 lg:p-6">
	<div class="max-w-4xl mx-auto space-y-6">
		<!-- Header -->
		<div class="flex items-center gap-4">
			<button class="btn btn-sm preset-tonal min-h-11 hidden md:inline-flex" onclick={handleBack}>
				&larr; {t('characterCards.back')}
			</button>
			<h2 class="h2">{t('characterCards.heading')}</h2>
		</div>

		<!-- Fallback Notice -->
		{#if fallbackActNumber !== null}
			<section class="card p-4 flex items-start gap-3 border border-secondary-500-300">
				<Icon name="info" class="size-5 shrink-0 text-secondary-500 mt-0.5" />
				<p class="text-sm text-surface-700-300">
					{t('characterCards.fallbackNotice', { number: fallbackActNumber })}
				</p>
			</section>
		{/if}

		<!-- Context Info -->
		<section class="card p-4">
			<div class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
				<span class="font-semibold text-surface-700-300">{t('characterCards.story')}</span>
				<span class="text-surface-950-50">{resolvedCtx?.storyName ?? '—'}</span>
				<span class="font-semibold text-surface-700-300">{t('characterCards.act')}</span>
				<span class="text-surface-950-50">{resolvedCtx?.actNumber ?? '—'}</span>
				<span class="font-semibold text-surface-700-300">{t('characterCards.actLine')}</span>
				<span class="text-surface-950-50">{resolvedCtx?.actLine.name ?? '—'}</span>
				<span class="font-semibold text-surface-700-300">{t('characterCards.actLineId')}</span>
				<span class="text-surface-500 text-xs font-mono">{resolvedCtx?.actLine.id ?? '—'}</span>
			</div>
		</section>

		<!-- Ignore in Main Chat Setting -->
		<section class="card p-4 space-y-2 border border-secondary-500-300">
			<label class="flex items-center gap-2">
				<input
					type="checkbox"
					class="checkbox"
					checked={settings.ignoreCharacterCardsInChat}
					onchange={(e) => updateSettings({ ignoreCharacterCardsInChat: e.currentTarget.checked })}
				/>
				<h4 class="font-semibold text-secondary-700-300">{t('settings.ignoreCharacterCardsInChat')}</h4>
			</label>
			<p class="text-xs text-surface-500">{t('settings.ignoreCharacterCardsInChatDescription')}</p>
		</section>

		<!-- Extraction Loading -->
		{#if getIsExtracting()}
			<div
				class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
				role="alert"
				aria-live="polite"
				aria-busy="true"
			>
				<div class="card p-8 text-center">
					<Spinner size="xl" />
					<p class="mt-4 text-surface-950-50">{t('characterCards.extractingCharacters')}</p>
				</div>
			</div>
		{/if}

		<!-- Extraction Error -->
		{#if getExtractionError() && !getIsExtracting()}
			<div class="card p-4 border border-error-500-500">
				<p class="text-error-700-300">{getExtractionError()}</p>
			</div>
		{/if}

		<!-- Raw Output (if parse failed) -->
		{#if getRawExtractionOutput() && !getIsExtracting()}
			<section class="card p-4 space-y-2">
				<h3 class="font-semibold text-surface-950-50">{t('characterCards.rawLlmOutput')}</h3>
				<pre class="text-xs text-surface-700-300 whitespace-pre-wrap break-words">{getRawExtractionOutput()}</pre>
			</section>
		{/if}

		<!-- Character Table -->
		{#if !getIsExtracting() && (getCharacters().length > 0 || getExtractionError())}
			<section class="card p-3 md:p-4 space-y-3">
				<!-- Mobile card layout -->
				<div class="md:hidden space-y-3">
					{#each getCharacters() as char, i (i)}
						<div class="space-y-2 p-3 border border-surface-200-800 rounded-container">
							<div class="flex items-center justify-between">
								<span class="text-xs font-semibold text-surface-700-300 uppercase tracking-wide">{t('characterCards.character')}</span>
								{#if char.isManual}
									<button class="btn btn-sm preset-filled-error-500 min-h-11" onclick={() => handleRemoveRow(i)}>&times;</button>
								{/if}
							</div>
							{#if char.isManual}
								<input
									type="text"
									class="input text-sm"
									value={char.character}
									oninput={(e) => updateCharacter(i, { character: e.currentTarget.value })}
									placeholder={t('characterCards.enterNamePlaceholder')}
								/>
							{:else}
								<p class="text-surface-950-50 text-sm">{char.character}</p>
							{/if}

							<span class="text-xs font-semibold text-surface-700-300 uppercase tracking-wide">{t('characterCards.summary')}</span>
							{#if char.isManual}
								<input
									type="text"
									class="input text-sm"
									value={char.importance}
									oninput={(e) => updateCharacter(i, { importance: e.currentTarget.value })}
									placeholder={t('characterCards.summary')}
								/>
							{:else}
								<p class="text-surface-700-300 text-sm">{char.importance}</p>
							{/if}

							<span class="text-xs font-semibold text-surface-700-300 uppercase tracking-wide">{t('characterCards.canonicalName')}</span>
							<div class="flex items-center gap-1.5">
								<input
									type="text"
									class="input text-sm flex-1"
									value={char.canonicalName}
									oninput={(e) => updateCanonicalName(i, e.currentTarget.value)}
								/>
								{#if existingCardNames.has(char.canonicalName)}
									<Icon name="check-circle" class="size-4 text-success-500 shrink-0" aria-label={t('characterCards.cardExists')} />
								{/if}
							</div>

							<div class="flex items-center justify-between">
								<span class="text-xs font-semibold text-surface-700-300 uppercase tracking-wide">{t('characterCards.include')}</span>
								{#if char.isManual}
									<span class="text-xs text-surface-500">{t('characterCards.manual')}</span>
								{:else}
									<input
										type="checkbox"
										class="checkbox"
										checked={char.include}
										onchange={(e) => updateInclude(i, e.currentTarget.checked)}
									/>
								{/if}
							</div>
						</div>
					{/each}
					<button class="btn btn-sm preset-tonal w-full min-h-11" onclick={handleAddRow}>{t('characterCards.addRow')}</button>
				</div>

				<!-- Desktop table layout -->
				<div class="hidden md:block overflow-x-auto">
					<div class="min-w-[600px]">
						<div
							class="grid grid-cols-[minmax(120px,1.5fr)_minmax(160px,2fr)_minmax(100px,1fr)_60px_36px] gap-3 text-xs font-semibold text-surface-700-300 uppercase tracking-wide border-b border-surface-200-800 pb-2"
						>
							<span>{t('characterCards.character')}</span>
							<span>{t('characterCards.summary')}</span>
							<span>{t('characterCards.canonicalName')}</span>
							<span class="text-center">{t('characterCards.include')}</span>
							<span></span>
						</div>

						{#each getCharacters() as char, i (i)}
							<div
								class="grid grid-cols-[minmax(120px,1.5fr)_minmax(160px,2fr)_minmax(100px,1fr)_60px_36px] gap-3 items-center py-2 border-b border-surface-100-900"
							>
								<span class="text-surface-950-50">
									{#if char.isManual}
										<input
											type="text"
											class="input text-sm"
											value={char.character}
											oninput={(e) => updateCharacter(i, { character: e.currentTarget.value })}
											placeholder={t('characterCards.enterNamePlaceholder')}
										/>
									{:else}
										{char.character}
									{/if}
								</span>
								<span class="text-surface-700-300 text-sm">
									{#if char.isManual}
										<input
											type="text"
											class="input text-sm"
											value={char.importance}
											oninput={(e) => updateCharacter(i, { importance: e.currentTarget.value })}
											placeholder={t('characterCards.summary')}
										/>
									{:else}
										{char.importance}
									{/if}
								</span>
								<span class="flex items-center gap-1.5">
									<input
										type="text"
										class="input text-sm"
										value={char.canonicalName}
										oninput={(e) => updateCanonicalName(i, e.currentTarget.value)}
									/>
									{#if existingCardNames.has(char.canonicalName)}
										<Icon name="check-circle" class="size-4 text-success-500 shrink-0" aria-label={t('characterCards.cardExists')} />
									{/if}
								</span>
								<span class="text-center">
									{#if char.isManual}
										<span class="text-xs text-surface-500">{t('characterCards.manual')}</span>
									{:else}
										<input
											type="checkbox"
											class="checkbox"
											checked={char.include}
											onchange={(e) => updateInclude(i, e.currentTarget.checked)}
										/>
									{/if}
								</span>
								<span>
									{#if char.isManual}
										<button class="btn btn-sm preset-filled-error-500" onclick={() => handleRemoveRow(i)}>&times;</button>
									{/if}
								</span>
							</div>
						{/each}

						<button class="btn btn-sm preset-tonal" onclick={handleAddRow}>{t('characterCards.addRow')}</button>
					</div>
				</div>
			</section>
		{/if}

		<!-- Remarks -->
		{#if !getIsExtracting()}
			<section class="card p-4 space-y-2 border border-secondary-500-300">
				<h4 class="font-semibold text-secondary-700-300">{t('characterCards.remarks')}</h4>
				<ul class="list-disc list-inside text-sm text-surface-700-300 space-y-1">
					<li>{t('characterCards.canonicalNamesHint')}</li>
					<li>{t('characterCards.perActLineHint')}</li>
					<li>{t('characterCards.lineageContextHint')}</li>
					<li>{t('characterCards.overwriteHint')}</li>
				</ul>
			</section>
		{/if}

		<!-- Generation Controls -->
		{#if !getIsExtracting() && !getIsGenerating() && getCharacters().length > 0}
			<div class="flex items-center gap-4">
				<label class="flex items-center gap-2 text-sm text-surface-700-300">
					<input type="checkbox" class="checkbox" bind:checked={concurrent} />
					{t('characterCards.concurrentGeneration')}
				</label>
				<button class="btn preset-filled-primary-500 min-h-11 md:min-h-0" onclick={handleGenerate}
					>{t('characterCards.generateCards')}</button
				>
			</div>
		{/if}

		<!-- Generation Progress Overlay -->
		{#if getIsGenerating()}
			{@const total = getProgress()?.total ?? getCharacters().length}
			{@const completed = getProgress()?.completed ?? 0}
			<div
				class="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
				role="alert"
				aria-live="polite"
				aria-busy="true"
			>
				<div class="card p-8 text-center min-w-[320px]">
					<p class="text-surface-950-50">{t('characterCards.generatingProgress', { current: completed + 1, total })}</p>
					<p class="text-lg font-semibold text-surface-950-50 mt-2">{getProgress()?.currentCharacter ?? ''}</p>
					<div
						class="mt-4 h-3 bg-surface-200-800 rounded-full overflow-hidden"
						role="progressbar"
						aria-valuenow={completed}
						aria-valuemin={0}
						aria-valuemax={total}
					>
						<div
							class="h-full bg-primary-500 transition-[width] duration-200"
							style="width: {total > 0 ? (completed / total) * 100 : 0}%"
						></div>
					</div>
				</div>
			</div>
		{/if}

		<!-- Generation Error -->
		{#if getGenerationError() && !getIsGenerating()}
			<div class="card p-4 border border-error-500-500">
				<p class="text-error-700-300">{getGenerationError()}</p>
			</div>
		{/if}

		<!-- Results -->
		{#if getResults().length > 0 && !getIsGenerating()}
			<section class="card p-4 space-y-2 border border-success-500-300">
				<h3 class="font-semibold text-success-700-300">{t('characterCards.generatedCards', { n: getResults().length })}</h3>
				<ul class="list-disc list-inside text-sm text-surface-700-300">
					{#each getResults() as r (r.characterName)}
						<li>
							<strong class="text-surface-950-50">{r.characterName}</strong>:
							<span class="font-mono text-xs">{r.filePath}</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>
</div>
