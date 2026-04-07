<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';

	let greeting = $state('');

	async function greet() {
		greeting = await invoke<string>('greet', { name: 'World' });
	}
</script>

<main class="grid place-items-center min-h-screen p-8">
	<h1 class="h1 mb-4">Hello Tauri + SvelteKit</h1>
	<button class="btn preset-filled-primary-500" onclick={greet}>Greet</button>
	{#if greeting}
		<p class="text-xl mt-4">{greeting}</p>
	{/if}
</main>
