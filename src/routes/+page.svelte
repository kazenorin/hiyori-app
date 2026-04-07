<script lang="ts">
	import { invoke } from '@tauri-apps/api/core';

	let greeting = $state('');

	async function greet() {
		greeting = await invoke<string>('greet', { name: 'World' });
	}
</script>

<main>
	<h1>Hello Tauri + SvelteKit</h1>
	<button onclick={greet}>Greet</button>
	{#if greeting}
		<p>{greeting}</p>
	{/if}
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	h1 {
		margin-bottom: 1rem;
	}

	button {
		padding: 0.5rem 1.5rem;
		font-size: 1rem;
		cursor: pointer;
		border: none;
		border-radius: 4px;
		background: #ff3e00;
		color: white;
	}

	button:hover {
		background: #e03600;
	}

	p {
		margin-top: 1rem;
		font-size: 1.25rem;
		color: #333;
	}
</style>
