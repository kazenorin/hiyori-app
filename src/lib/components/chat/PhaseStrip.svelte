<script module lang="ts">
	import type { PhaseName } from '#lib/ai/narrative-types';
	import type { IconName } from '#lib/ui/icons';

	/** Icon per pipeline phase (design §4.3). */
	export const PHASE_ICONS: Record<PhaseName, IconName> = {
		WRITER: 'pen-line',
		REVIEWER: 'eye',
		EDITOR: 'edit',
		GAME_MASTER: 'dice-5',
		PLOT_PLANNER: 'map',
		TEMPLATE_FITTER: 'layout-template',
		SUMMARIZER: 'document',
		CHARACTER_PROFILE_COMPRESSOR: 'users',
	};

	/** i18n key per pipeline phase caption (formatPhaseName() is English-only and stays for logs). */
	export const PHASE_LABEL_KEYS: Record<PhaseName, string> = {
		WRITER: 'chat.phases.writer',
		REVIEWER: 'chat.phases.reviewer',
		EDITOR: 'chat.phases.editor',
		GAME_MASTER: 'chat.phases.gameMaster',
		PLOT_PLANNER: 'chat.phases.plotPlanner',
		TEMPLATE_FITTER: 'chat.phases.templateFitter',
		SUMMARIZER: 'chat.phases.summarizer',
		CHARACTER_PROFILE_COMPRESSOR: 'chat.phases.profileCompressor',
	};
</script>

<script lang="ts">
	import Icon from '#lib/components/ui/Icon.svelte';
	import { t } from '#lib/i18n';
	import type { UIScenePhase } from '#lib/ai/narrative-types';

	interface Props {
		phases: UIScenePhase[];
		streamingPhase: PhaseName | null;
		onOpen: (phase: PhaseName) => void;
	}

	let { phases, streamingPhase, onOpen }: Props = $props();

	// The pipeline writes this marker into phase.content while a phase is retrying (pipeline-callbacks.ts).
	function isRetrying(phase: UIScenePhase): boolean {
		return phase.content.startsWith('Retrying (attempt');
	}
</script>

{#if phases.length > 0}
	<div class="flex flex-wrap items-center gap-1.5 pb-2 mb-3 border-b border-surface-200-800">
		{#each phases as phase, pi (pi)}
			{@const label = t(PHASE_LABEL_KEYS[phase.phaseName])}
			{@const streaming = phase.phaseName === streamingPhase}
			{@const failed = !streaming && isRetrying(phase)}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs transition-colors cursor-pointer {streaming
					? 'border-primary-500/35 bg-primary-500/10 text-primary-600-400'
					: failed
						? 'text-error-500 hover:bg-surface-200-800'
						: 'text-surface-500 hover:bg-surface-200-800 hover:text-surface-700-300'}"
				aria-label={label}
				data-tip={label}
				onclick={() => onOpen(phase.phaseName)}
			>
				{#if streaming}
					<Icon name="loader-circle" class="size-3.5 animate-spin" aria-hidden="true" />
				{:else if failed}
					<Icon name="triangle-alert" class="size-3.5" aria-hidden="true" />
				{:else}
					<Icon name={PHASE_ICONS[phase.phaseName]} class="size-3.5" aria-hidden="true" />
				{/if}
				<span class="hidden md:inline">{label}</span>
			</button>
		{/each}
	</div>
{/if}
