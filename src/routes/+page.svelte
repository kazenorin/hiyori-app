<script lang="ts">
	import {
		getMessages,
		getIsStreaming,
		getError,
		sendMessage,
		stopStreaming,
		clearChat
	} from '$lib/ai/chat.svelte';

	let input = $state('');

	function handleSubmit() {
		const text = input.trim();
		if (!text || getIsStreaming()) return;
		input = '';
		sendMessage(text);
	}
</script>

<div class="flex-1 flex flex-col">
	<!-- Chat messages area -->
	<div class="flex-1 overflow-y-auto p-6">
		<div class="max-w-[var(--reading-width)] mx-auto space-y-4">
			{#if getMessages().length === 0}
				<!-- Welcome state -->
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<h2 class="h2 font-display text-surface-700-300 mb-3">Begin Your Adventure</h2>
					<p class="text-surface-400-500 max-w-md">
						Configure your API settings, then type a message to start chatting with the AI.
					</p>
				</div>
			{:else}
				{#each getMessages() as message (message.id)}
					{#if message.role === 'user'}
						<!-- User message -->
						<div class="flex justify-end">
							<div
								class="max-w-[640px] rounded-[var(--radius-container)] bg-primary-100-900 p-5"
							>
								<p class="leading-relaxed text-primary-900-100">{message.content}</p>
							</div>
						</div>
					{:else}
						<!-- Assistant message -->
						<div
							class="max-w-[640px] rounded-[var(--radius-container)] bg-surface-50-950 p-5 shadow-message"
						>
							<p class="leading-relaxed text-surface-950-50 whitespace-pre-wrap">{message.content}</p>
							{#if getIsStreaming() && !message.content}
								<span class="inline-block w-2 h-5 bg-surface-400-500 animate-pulse rounded-sm"></span>
							{/if}
						</div>
						<!-- Streaming cursor after partial content -->
						{#if getIsStreaming() && message.content && message === getMessages().at(-1)}
							<div class="max-w-[640px] pl-5">
								<span class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm"></span>
							</div>
						{/if}
					{/if}
				{/each}
			{/if}

			<!-- Error display -->
			{#if getError()}
				<div class="max-w-[640px] rounded-[var(--radius-container)] bg-error-100-900 p-4">
					<p class="text-sm text-error-700-300">{getError()}</p>
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
				placeholder="Type a message..."
				aria-label="Message input"
				bind:value={input}
				onkeydown={(e) => e.key === 'Enter' && handleSubmit()}
				disabled={getIsStreaming()}
			/>
			{#if getIsStreaming()}
				<button class="btn preset-filled-error-500" type="button" onclick={stopStreaming}>
					Stop
				</button>
			{:else}
				<button class="btn preset-filled-primary-500" type="button" onclick={handleSubmit}>
					Send
				</button>
			{/if}
			{#if getMessages().length > 0}
				<button class="btn preset-tonal" type="button" onclick={clearChat}>
					Clear
				</button>
			{/if}
		</div>
	</div>
</div>
