<script lang="ts">
	import { t } from '#lib/i18n/index.ts';
	import MarkdownContent from '#lib/components/MarkdownContent.svelte';
	import { log } from '#lib/logging/logger.ts';
	import { toaster } from '#lib/stores/toaster.svelte.ts';
	import { getIsBusy, getMessages, updateMessageInState } from '#lib/ai/chat.svelte.ts';
	import { getActiveActLine, getActiveActLineId } from '#lib/stores/stories.svelte.ts';
	import { getDefaultPlotMode, isPlotPlannerEnabled } from '#lib/stores/settings.svelte.ts';
	import { getLastSceneNumber } from '#lib/db/act-lines.ts';
	import { updateMessageFields } from '#lib/db/messages.ts';
	import { resolveScenePlot } from '#lib/features/context-manager.ts';
	import {
		DEFAULT_ESTIMATE,
		MAX_ESTIMATE,
		MIN_ESTIMATE,
		joinScenePlotEstimate,
		splitScenePlotEstimate,
	} from '#lib/ai/plot-planner-output-parser.ts';

	interface Props {
		messageId: string;
	}

	let { messageId }: Props = $props();

	const clicked = $derived(getMessages().find((m) => m.id === messageId));
	// Resolve the same way run-manager.ts:595 does, or the panel would disagree with the pipeline.
	const plotMode = $derived(getActiveActLine()?.plotMode ?? getDefaultPlotMode());
	const plannerEnabled = $derived(isPlotPlannerEnabled());

	let lastSceneNumber = $state<number | null>(null);
	let loaded = $state(false);
	let loadError = $state(false);
	let editing = $state(false);
	let draft = $state('');
	let draftEstimate = $state(DEFAULT_ESTIMATE);
	let labelPrefix = $state<string | null>(null);
	let saving = $state(false);

	$effect(() => {
		const actLineId = getActiveActLineId();
		// Reload when the message set changes: a run completing while the dialog is open advances
		// the latest scene, and a stale value would mark a non-latest plot editable.
		void getMessages().length;
		loaded = false;
		loadError = false;
		editing = false;
		if (actLineId === null) return;
		void loadLastScene(actLineId);
	});

	async function loadLastScene(actLineId: string): Promise<void> {
		try {
			lastSceneNumber = await getLastSceneNumber(actLineId);
		} catch (err) {
			loadError = true;
			await log.error('context-manager', 'Failed to load the last scene number', err);
		} finally {
			loaded = true;
		}
	}

	const plot = $derived(
		clicked && loaded && !loadError ? resolveScenePlot(getMessages(), clicked.sceneNumber, plotMode, lastSceneNumber) : null
	);
	// Gate on consumption, not on parseability: run-manager.ts:705 only reads the estimate in
	// phaseEvent mode, so showing it in guidance mode would display a value the pipeline ignores.
	const showEstimate = $derived(plotMode === 'phaseEvent');
	const parts = $derived(plot && showEstimate ? splitScenePlotEstimate(plot.scenePlot) : null);

	function startEdit(): void {
		if (getIsBusy() || !plot?.editable) return;
		draft = parts?.prose ?? plot.scenePlot;
		draftEstimate = parts?.estimate ?? DEFAULT_ESTIMATE;
		labelPrefix = parts?.labelPrefix ?? null;
		editing = true;
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			void save();
		}
	}

	async function save(): Promise<void> {
		if (!plot) return;
		if (saving) return;
		const targetId = plot.messageId;
		// A number input still accepts out-of-range typing; the parser would reject it and the
		// pipeline would silently fall back, so clamp to the range the parser accepts.
		const estimate = Number.isFinite(draftEstimate)
			? Math.min(MAX_ESTIMATE, Math.max(MIN_ESTIMATE, Math.round(draftEstimate)))
			: DEFAULT_ESTIMATE;
		const scenePlot = showEstimate ? joinScenePlotEstimate(draft, estimate, labelPrefix) : draft;
		saving = true;
		try {
			await updateMessageFields(targetId, { scenePlot });
			updateMessageInState(targetId, { scenePlot });
			editing = false;
		} catch (err) {
			await log.error('context-manager', 'Failed to save scene plot', err);
			toaster.error({ title: t('chat.context.saveFailed') });
		} finally {
			saving = false;
		}
	}
</script>

{#if !clicked || loadError}
	<p class="text-sm text-error-500">{t('chat.context.loadFailed')}</p>
{:else if !loaded}
	<p class="text-sm text-surface-500">{t('chat.context.loading')}</p>
{:else if !plot}
	<p class="text-sm text-surface-500">
		{plannerEnabled ? t('chat.context.noScenePlot') : t('chat.context.noScenePlotPlannerOff')}
	</p>
{:else}
	<div class="space-y-3">
		<div class="flex items-center justify-between gap-2">
			<p class="text-xs text-surface-500">{t('chat.sceneLabel', { sceneNumber: plot.ownerSceneNumber })}</p>
			{#if plot.editable && !editing}
				<button class="btn preset-tonal text-xs py-1 px-3 shrink-0" type="button" disabled={getIsBusy() || saving} onclick={startEdit}>
					{t('chat.edit')}
				</button>
			{/if}
		</div>

		{#if clicked && plot.ownerSceneNumber !== clicked.sceneNumber}
			<p class="text-sm text-surface-500">
				{t('chat.context.sceneMismatchNote', {
					ownerSceneNumber: plot.ownerSceneNumber,
					clickedSceneNumber: clicked.sceneNumber,
				})}
			</p>
		{/if}

		{#if !plot.editable}
			<p class="text-sm text-warning-600-400">{t('chat.context.scenePlotReadOnly')}</p>
		{/if}

		{#if editing}
			{#if showEstimate}
				<label class="flex items-center gap-2 text-sm">
					{t('chat.context.estimatedLength')}
					<input class="input w-24 text-sm" type="number" min={MIN_ESTIMATE} max={MAX_ESTIMATE} bind:value={draftEstimate} />
				</label>
			{/if}
			<textarea class="input w-full resize-y text-sm leading-relaxed min-h-32" rows="8" bind:value={draft} onkeydown={handleKeydown}
			></textarea>
			<div class="flex gap-2 mt-3 pt-3 border-t border-surface-200-800">
				<button class="btn preset-filled-primary-500 text-xs py-1 px-3" type="button" disabled={saving} onclick={save}>
					{t('chat.save')}
				</button>
				<button class="btn preset-tonal text-xs py-1 px-3" type="button" disabled={saving} onclick={() => (editing = false)}>
					{t('chat.cancel')}
				</button>
			</div>
		{:else}
			{#if showEstimate}
				<p class="text-sm text-surface-500">{t('chat.context.estimatedLength')}: {parts?.estimate ?? DEFAULT_ESTIMATE}</p>
			{/if}
			<div class="leading-relaxed text-surface-800-200">
				<MarkdownContent content={parts?.prose ?? plot.scenePlot} />
			</div>
		{/if}
	</div>
{/if}
