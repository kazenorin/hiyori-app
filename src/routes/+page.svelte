<script lang="ts">
	import {
		getMessages,
		getIsStreaming,
		getError,
		sendMessage,
		stopStreaming
	} from '$lib/ai/chat.svelte';
	import { getActiveActLineId } from '$lib/stores/stories.svelte';
	import { Accordion } from '@skeletonlabs/skeleton-svelte';

	let input = $state('');
	let chatContainer: HTMLDivElement;

	function handleSubmit() {
		const text = input.trim();
		const actLineId = getActiveActLineId();
		if (!text || getIsStreaming() || !actLineId) return;
		input = '';
		sendMessage(actLineId, text);
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
	{#if !getActiveActLineId()}
		<!-- Empty state — no act line selected -->
		<div class="flex-1 flex items-center justify-center">
			<div class="text-center space-y-3">
				<h2 class="h2 font-display text-surface-700-300">No Act Line Selected</h2>
				<p class="text-surface-400-500 max-w-lg">
					Create a story, add an act, then select or create an act line to start chatting.
				</p>
			</div>
		</div>
	{:else}
		<!-- Chat messages area -->
		<!-- svelte-ignore binding_property_non_reactive -->
		<div
			bind:this={chatContainer}
			class="flex-1 overflow-y-auto p-6"
		>
			<div class="px-8 space-y-4">
				{#if getMessages().length === 0}
					<div class="flex flex-col items-center justify-center py-24 text-center">
						<h2 class="h2 font-display text-surface-700-300 mb-3">Begin Your Adventure</h2>
						<p class="text-surface-400-500 max-w-lg">
							Type a message to start chatting with the AI.
						</p>
					</div>
				{:else}
					{#each getMessages() as message (message.id)}
						{#if message.role === 'user'}
							<div class="flex justify-end">
								<div
									class="max-w-[80%] rounded-[var(--radius-container)] bg-primary-100-900 p-5"
								>
									<p class="leading-relaxed text-primary-900-100 whitespace-pre-wrap">{message.content}</p>
								</div>
							</div>
						{:else}
							<div
								class="rounded-[var(--radius-container)] bg-surface-50-950 p-5 shadow-message"
							>
								{#if message.reasoning}
									<div class="mb-3">
										<Accordion collapsible>
											<Accordion.Item value="reasoning">
												<Accordion.ItemTrigger
													class="flex items-center justify-between w-full text-xs font-medium text-surface-500 py-1"
												>
													<span>Thinking...</span>
													<Accordion.ItemIndicator>
														<span class="transition-transform duration-150 text-surface-500">▼</span>
													</Accordion.ItemIndicator>
												</Accordion.ItemTrigger>
												<Accordion.ItemContent>
													{#snippet element(attributes)}
														{#if !attributes.hidden}
															<div
																{...attributes}
																class="text-xs text-surface-500 leading-relaxed whitespace-pre-wrap border-l-2 border-surface-200-800 pl-3 mt-2"
															>
																{message.reasoning}
															</div>
														{/if}
													{/snippet}
												</Accordion.ItemContent>
											</Accordion.Item>
										</Accordion>
									</div>
								{/if}

								{#if message.content}
									<p class="leading-relaxed text-surface-950-50 whitespace-pre-wrap">{message.content}</p>
								{/if}
								{#if getIsStreaming() && message === getMessages().at(-1)}
									<span class="inline-block w-2 h-5 bg-primary-500 animate-pulse rounded-sm {message.content ? 'mt-2' : ''}"></span>
								{/if}
								{#if message.metadata}
									<pre class="mt-4 pt-3 border-t border-surface-200-800 text-xs text-surface-500 font-mono leading-relaxed">model:       {message.metadata.model}
finish:      {message.metadata.finishReason}
tokens:      {message.metadata.promptTokens} prompt + {message.metadata.completionTokens} completion = {message.metadata.totalTokens} total
duration:    {message.metadata.durationMs}ms</pre>
								{/if}
							</div>
						{/if}
					{/each}
				{/if}

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
	{/if}
</div>
