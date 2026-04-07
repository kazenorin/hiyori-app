<script lang="ts">
	import { getGreeting, getMessage, setMessage, send } from '$lib/greeting.svelte';
</script>

<div class="flex-1 flex flex-col">
	<!-- Chat messages area -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="max-w-[var(--reading-width)] mx-auto space-y-4">
			{#if getGreeting()}
				<!-- Narrator message -->
				<div
					class="max-w-[640px] rounded-[var(--radius-container)] bg-surface-50-950 p-5 shadow-message"
				>
					<p class="leading-relaxed text-surface-950-50">{getGreeting()}</p>
				</div>
			{:else}
				<!-- Welcome state -->
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<h2 class="h2 font-display text-surface-700-300 mb-3">Begin Your Adventure</h2>
					<p class="text-surface-400-500 max-w-md">
						Type your character's name or describe how you'd like the story to begin.
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Input area -->
	<div class="border-t border-surface-200-800 p-4">
		<div class="flex gap-2 max-w-[var(--reading-width)] mx-auto">
			<input
				class="input flex-1"
				type="text"
				placeholder="What do you do next?"
				aria-label="Message input"
				value={getMessage()}
				oninput={(e) => setMessage(e.currentTarget.value)}
				onkeydown={(e) => e.key === 'Enter' && send()}
			/>
			<button class="btn preset-filled-primary-500" type="button" onclick={send}>
				Send
			</button>
		</div>
	</div>
</div>
