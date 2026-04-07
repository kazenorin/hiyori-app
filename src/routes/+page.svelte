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
	let chatContainer: HTMLDivElement;

	function handleSubmit() {
		const text = input.trim();
		if (!text || getIsStreaming()) return;
		input = '';
		sendMessage(text);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSubmit();
		}
	}

	function scrollToBottom() {
		if (chatContainer) {
			chatContainer.scrollTop = chatContainer.scrollHeight;
		}
	}

	$effect(() => {
		getMessages();
		getIsStreaming();
		setTimeout(scrollToBottom, 0);
	});
</script>

<div class="flex-1 flex min-h-0">
	<!-- Chat messages area -->
	<!-- svelte-ignore binding_property_non_reactive -->
	<div
		bind:this={chatContainer}
		class="flex-1 overflow-y-auto p-6"
	>
		<div class="px-8 space-y-4">
			{#if getMessages().length === 0}
				<!-- Welcome state -->
				<div class="flex flex-col items-center justify-center py-24 text-center">
					<h2 class="h2 font-display text-surface-700-300 mb-3">Begin Your Adventure</h2>
					<p class="text-surface-400-500 max-w-lg">
						Configure your API settings, then type a message to start chatting with the AI.
					</p>
				</div>
			{:else}
				{#each getMessages() as message (message.id)}
					{#if message.role === 'user'}
						<!-- User message -->
						<div class="flex justify-end">
							<div
								class="max-w-[80%] rounded-[var(--radius-container)] bg-primary-100-900 p-5"
							>
								<p class="leading-relaxed text-primary-900-100 whitespace-pre-wrap">{message.content}</p>
							</div>
						</div>
					{:else}
						<!-- Assistant message -->
						<div
							class="rounded-[var(--radius-container)] bg-surface-50-950 p-5 shadow-message"
						>
							{#if message.content}
								<p class="leading-relaxed text-surface-950-50 whitespace-pre-wrap">{message.content}</p>
							{/if}
							{#if getIsStreaming() && message === getMessages().at(-1)}
								<span class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm {message.content ? 'mt-2' : ''}"></span>
							{/if}
						</div>
					{/if}
				{/each}
			{/if}

			<!-- Error display -->
			{#if getError()}
				<div class="rounded-[var(--radius-container)] bg-error-100-900 p-4">
					<p class="text-sm text-error-700-300">{getError()}</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Right-side input panel -->
	<aside class="w-80 border-l border-surface-200-800 flex flex-col p-4 bg-surface-50-950">
		<div class="flex items-center justify-between mb-3">
			<span class="text-xs font-medium text-surface-500 uppercase tracking-wider">Message</span>
			{#if getMessages().length > 0}
				<button
					class="text-xs text-surface-500 hover:text-surface-700-300 transition-colors"
					type="button"
					onclick={clearChat}
				>
					Clear
				</button>
			{/if}
		</div>

		<textarea
			class="input flex-1 resize-none text-sm leading-relaxed"
			placeholder="Type your message...&#10;&#10;Enter to send, Shift+Enter for new line."
			aria-label="Message input"
			bind:value={input}
			onkeydown={handleKeydown}
			disabled={getIsStreaming()}
		></textarea>

		<div class="mt-3">
			{#if getIsStreaming()}
				<button class="btn preset-filled-error-500 w-full" type="button" onclick={stopStreaming}>
					Stop
				</button>
			{:else}
				<button class="btn preset-filled-primary-500 w-full" type="button" onclick={handleSubmit}>
					Send
				</button>
			{/if}
		</div>
	</aside>
</div>
