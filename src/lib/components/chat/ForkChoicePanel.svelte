<script lang="ts">
	import { t } from '$lib/i18n';
	import Icon from '$lib/components/ui/Icon.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import { slide } from 'svelte/transition';

	type PlotMode = 'guidance' | 'phaseEvent' | null;

	interface ForkActions {
		onForkDirect: () => void;
		onForkWithInterview: () => void;
		onCancel: () => void;
	}

	interface Props {
		variant: 'desktop' | 'mobile';
		forkPlotMode?: PlotMode;
		isForking: boolean;
		isBusy: boolean;
		actions: ForkActions;
	}

	let { variant, forkPlotMode = $bindable(null), isForking, isBusy, actions }: Props = $props();
</script>

{#if isForking || isBusy}
	<div
		class={variant === 'desktop'
			? 'flex items-center gap-2 text-xs text-surface-600-400'
			: 'flex items-center justify-center gap-2 min-h-11 text-sm text-surface-600-400'}
		role="status"
		aria-live="polite"
		transition:slide={{ duration: 200 }}
	>
		<Spinner size={variant === 'desktop' ? 'xs' : 'md'} />
		<span>{t('chat.forking')}</span>
	</div>
{:else if variant === 'desktop'}
	<div class="flex flex-col gap-2" transition:slide={{ duration: 200 }}>
		<!-- Plot Mode row -->
		<div class="flex gap-2 items-center">
			<button
				class="flex items-center gap-1 h-7 px-2 rounded-full text-xs transition-colors {forkPlotMode === null
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = null)}
			>
				<Icon name="keep-plot" class="w-3 h-3" />
				{t('chat.keepPlotMode')}
			</button>
			<button
				class="flex items-center gap-1 h-7 px-2 rounded-full text-xs transition-colors {forkPlotMode === 'guidance'
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = 'guidance')}
			>
				<Icon name="guidance" class="w-3 h-3" />
				{t('chat.switchToGuidance')}
			</button>
			<button
				class="flex items-center gap-1 h-7 px-2 rounded-full text-xs transition-colors {forkPlotMode === 'phaseEvent'
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = 'phaseEvent')}
			>
				<Icon name="phase-event" class="w-3 h-3" />
				{t('chat.switchToPhaseEvent')}
			</button>
		</div>
		<!-- Action row -->
		<div class="flex gap-2 items-center">
			<button
				class="btn preset-filled-primary-500 text-xs gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
				disabled={forkPlotMode !== null}
				onclick={actions.onForkDirect}
			>
				<Icon name="fork" class="w-3.5 h-3.5" />
				{t('chat.keepCurrentPlot')}
			</button>
			<button class="btn preset-filled-success-500 text-xs gap-1" onclick={actions.onForkWithInterview}>
				<Icon name="edit" class="w-3.5 h-3.5" />
				{t('chat.tellUsWhatsDifferent')}
			</button>
			<button class="btn preset-tonal text-xs" onclick={actions.onCancel}>
				{t('chat.cancel')}
			</button>
		</div>
	</div>
{:else}
	<div class="flex flex-col gap-2 mt-2 pt-2 border-t border-surface-200-800" transition:slide={{ duration: 200 }}>
		<!-- Plot Mode selector -->
		<div class="flex gap-2">
			<button
				class="flex-1 h-8 px-2.5 rounded-full text-xs flex items-center justify-center gap-1.5 cursor-pointer select-none transition-colors {forkPlotMode ===
				null
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = null)}
			>
				<Icon name="keep-plot" class="w-3.5 h-3.5" />
				{t('chat.keepPlotMode')}
			</button>
			<button
				class="flex-1 h-8 px-2.5 rounded-full text-xs flex items-center justify-center gap-1.5 cursor-pointer select-none transition-colors {forkPlotMode ===
				'guidance'
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = 'guidance')}
			>
				<Icon name="guidance" class="w-3.5 h-3.5" />
				{t('chat.switchToGuidance')}
			</button>
			<button
				class="flex-1 h-8 px-2.5 rounded-full text-xs flex items-center justify-center gap-1.5 cursor-pointer select-none transition-colors {forkPlotMode ===
				'phaseEvent'
					? 'preset-tonal-tertiary'
					: 'preset-outlined'}"
				onclick={() => (forkPlotMode = 'phaseEvent')}
			>
				<Icon name="phase-event" class="w-3.5 h-3.5" />
				{t('chat.switchToPhaseEvent')}
			</button>
		</div>
		<!-- Action buttons -->
		<div class="flex flex-wrap gap-2">
			<button
				class="btn preset-filled-primary-500 flex-1 min-h-11 gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
				disabled={forkPlotMode !== null}
				onclick={actions.onForkDirect}
			>
				<Icon name="fork" class="w-4 h-4" />
				{t('chat.fork')}
			</button>
			<button class="btn preset-filled-success-500 flex-1 min-h-11 gap-2" onclick={actions.onForkWithInterview}>
				<Icon name="edit" class="w-4 h-4" />
				{t('chat.newPlot')}
			</button>
			<button class="btn preset-tonal min-h-11 px-4" onclick={actions.onCancel}>
				{t('chat.cancel')}
			</button>
		</div>
	</div>
{/if}
