<script lang="ts">
	import MarkdownContent from '$lib/components/MarkdownContent.svelte';

	interface Props {
		decisions: string[];
		activePlotThreads: string[];
		decisionContext: string | null;
		isStreaming: boolean;
		onDecisionClick: (decision: string) => void;
	}

	let { decisions, activePlotThreads, decisionContext, isStreaming, onDecisionClick }: Props = $props();

	let hasContent = $derived(decisions.length > 0 || activePlotThreads.length > 0 || decisionContext !== null);
</script>

{#if hasContent && !isStreaming}
	<div class="border-t border-surface-200-800 bg-surface-50-950 px-8 py-3">
		<div class="space-y-2">
			{#if decisionContext}
				<div class="mb-1">
					<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">Decision Point</span>
					<div class="text-surface-950-50"><MarkdownContent content={decisionContext} /></div>
				</div>
			{/if}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
				{#if activePlotThreads.length > 0}
					<div>
						<div class="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Active Plot Threads</div>
						<MarkdownContent content={activePlotThreads.map((t) => `- ${t}`).join('\n')} />
					</div>
				{/if}
				{#if decisions.length > 0}
					<div>
						<div class="text-xs font-medium text-surface-500 uppercase tracking-wider mb-1">Decisions</div>
						<div class="space-y-1">
							{#each decisions as decision, i (i)}
								<button
									class="btn preset-filled-primary-500 w-full text-left line-clamp-2 whitespace-normal"
									type="button"
									onclick={() => onDecisionClick(decision)}
								>
									{i + 1}. {decision}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</div>
	</div>
{/if}