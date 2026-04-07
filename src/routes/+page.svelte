<script lang="ts">
	import { getGreeting, getMessage, setMessage, send } from '$lib/greeting.svelte';
</script>

<div class="w-full h-screen border-2 border-surface-900 dark:border-surface-100 flex flex-col items-center justify-center p-6 gap-6 bg-surface-50-950">
	<p class="w-full text-center text-sm font-normal text-surface-500 tracking-wide pb-3">
		Welcome
	</p>

	<div class="flex items-stretch gap-2 w-full max-w-[540px]">
		<input
			class="input"
			type="text"
			placeholder="Textbox"
			aria-label="Message input"
			value={getMessage()}
			oninput={(e) => setMessage(e.currentTarget.value)}
			onkeydown={(e) => e.key === 'Enter' && send()}
		/>
		<button class="btn preset-outlined-surface-900-100" type="button" onclick={send}>
			Send
		</button>
	</div>

	{#if getGreeting()}
		<p class="text-sm">{getGreeting()}</p>
	{/if}
</div>
