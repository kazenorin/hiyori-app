<script lang="ts">
	import type { MessageMetadata } from '$lib/ai/chat-stream';
	import { formatPhaseName, type PhaseName } from '$lib/ai/narrative-types';

	interface Props {
		metadata: MessageMetadata;
	}

	let { metadata }: Props = $props();
	let expanded = $state(false);

	function formatTokens(n: number): string {
		if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
		if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
		return String(n);
	}

	function formatDuration(ms: number): string {
		if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
		return ms + 'ms';
	}

	function tokenSummary(m: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }): string {
		const parts = [formatTokens(m.inputTokens) + ' in', formatTokens(m.outputTokens) + ' out'];
		if (m.cacheReadTokens) parts.push(formatTokens(m.cacheReadTokens) + ' cache');
		return parts.join(' / ');
	}

	const maxPhaseTokens = $derived(
		metadata.phases?.length
			? Math.max(...metadata.phases.map((p) => p.totalTokens), 1)
			: 0
	);
</script>

<div class="mt-3 pt-2 border-t border-surface-200-800 select-none">
	<!-- Collapsed: single-line telemetry bar -->
	<button
		class="w-full flex flex-wrap items-center gap-1.5 text-xs font-mono text-surface-400-500
		       hover:text-surface-600-300 transition-colors cursor-pointer"
		onclick={() => (expanded = !expanded)}
	>
		<span class="truncate max-w-[50%]">{metadata.model}</span>
		<span class="opacity-30">&middot;</span>
		<span>{tokenSummary(metadata)}</span>
		<span class="opacity-30">&middot;</span>
		<span>{formatDuration(metadata.durationMs)}</span>
		{#if metadata.phases?.length}
			<span class="opacity-30">&middot;</span>
			<span class="opacity-60">{expanded ? '▾' : '▸'}&thinsp;{metadata.phases.length} phases</span>
		{/if}
	</button>

	<!-- Expanded: dense rows with proportional token bars -->
	{#if expanded && metadata.phases?.length}
		<div class="mt-1.5 space-y-0.5">
			{#each metadata.phases as phase (phase.phaseName)}
				{@const barWidth = Math.max((phase.totalTokens / maxPhaseTokens) * 100, 2)}
				<div class="flex items-center gap-2 text-[11px] font-mono text-surface-400-500">
					<span class="w-24 shrink-0 truncate" title={formatPhaseName(phase.phaseName as PhaseName)}>
						{formatPhaseName(phase.phaseName as PhaseName)}
					</span>
					<div class="flex-1 h-1 bg-surface-100-800 rounded-full overflow-hidden">
						<div
							class="h-full rounded-full bg-primary-500/40 transition-all duration-300"
							style="width: {barWidth}%"
						></div>
					</div>
					<span class="w-20 text-right tabular-nums">{tokenSummary(phase)}</span>
					<span class="w-10 text-right tabular-nums opacity-60">{formatDuration(phase.durationMs)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
