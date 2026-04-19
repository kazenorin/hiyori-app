<script lang="ts">
	import { goto } from '$app/navigation';
	import { getImportWorldStore } from './import-state.svelte';
	import { executeImport } from '$lib/import-world/import-orchestrator';

	const store = getImportWorldStore();

	async function handleImport() {
		// Scroll to top when import starts
		window.scrollTo(0, 0);

		const result = store.validate();
		if (!result.isValid) return;

		store.setImporting(true);

		const importResult = await executeImport(store.getFormData(), (update) => {
			store.addProgressUpdate(update);
		});

		// Stay on page after import - show complete log
		if (importResult.success && importResult.importComplete) {
			store.setImportComplete();
		} else {
			store.setImporting(false);
		}
	}

	function handleBack() {
		goto('/');
	}
</script>

<div class="flex-1 overflow-y-auto p-6">
	<div class="max-w-3xl mx-auto space-y-6">
		<div class="flex items-center justify-between">
			<h1 class="h2 font-display">Import World</h1>
			<button class="btn preset-tonal" type="button" onclick={handleBack} disabled={store.isImporting}> Back to Chat </button>
		</div>

		<!-- Import Progress (shown at top for visibility) -->
		{#if store.isImporting || store.importComplete || store.progressUpdates.length > 0}
			<section class="card p-6 space-y-4">
				<h2 class="h4">
					{#if store.importComplete}
						Import Complete
					{:else}
						Import Progress
					{/if}
				</h2>

				<!-- Current status -->
				{#if store.isImporting}
					<div class="flex items-center gap-2">
						<div class="animate-spin h-4 w-4 border-2 border-primary-500 border-t-transparent rounded-full"></div>
						<span class="text-sm text-surface-700-300">
							{store.progressUpdates[store.progressUpdates.length - 1]?.message ?? 'Processing...'}
						</span>
					</div>
				{/if}

				<!-- Completion indicator -->
				{#if store.importComplete}
					<div class="flex items-center gap-2 text-success-600">
						<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
						</svg>
						<span class="text-sm font-medium">Story imported successfully. You can find it in the sidebar.</span>
					</div>
				{/if}

				<!-- Console output -->
				{#if store.consoleOutput}
					<div class="bg-surface-900-100 text-surface-100-900 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto">
						<pre class="whitespace-pre-wrap break-words">{store.consoleOutput}</pre>
					</div>
				{/if}

				<!-- Error display -->
				{#if store.importError}
					<div class="card p-4 border border-error-500">
						<h3 class="text-sm font-semibold text-error-600">Import Failed</h3>
						<p class="text-sm text-error-500 mt-1">{store.importError}</p>
					</div>
				{/if}

				<!-- Progress log -->
				<details>
					<summary class="text-sm font-medium cursor-pointer text-surface-500">Full Log</summary>
					<div class="mt-2 space-y-1 max-h-64 overflow-y-auto">
						{#each store.progressUpdates as update}
							<p class="text-xs text-surface-500">
								<span class="font-mono">[{update.phase}]</span>
								{update.message}
								{#if !!update.repeatedMessageCounter}
									<span class="font-mono">x{update.repeatedMessageCounter}</span>
								{/if}
							</p>
						{/each}
					</div>
				</details>
			</section>
		{/if}

		<!-- Form Sections - Hidden During Import -->
		{#if !store.isImporting}
			{#if store.validationResult && store.validationResult.errors.length > 0}
				<div class="card p-4 border border-error-500 bg-error-50 dark:bg-error-950 space-y-2">
					<h3 class="text-sm font-semibold text-error-700 dark:text-error-400">Validation Errors</h3>
					{#each store.validationResult.errors as error}
						<p class="text-sm text-error-600 dark:text-error-400">{error.message}</p>
					{/each}
				</div>
			{/if}

			<!-- Validation Warnings -->
			{#if store.showValidationWarnings && store.validationResult?.warnings}
				<details class="card p-4 border border-warning-500 bg-warning-50 dark:bg-warning-950">
					<summary class="text-sm font-semibold text-warning-700 dark:text-warning-400 cursor-pointer">
						Warnings ({store.validationResult.warnings.length})
					</summary>
					<div class="mt-2 space-y-1">
						{#each store.validationResult.warnings as warning}
							<p class="text-sm text-warning-600 dark:text-warning-400">{warning.message}</p>
						{/each}
					</div>
				</details>
			{/if}

			<!-- Story Name -->
			<section class="card p-6 space-y-4">
				<h2 class="h4">Story Details</h2>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">Story Name</span>
					<span class="text-xs text-surface-500 ml-2">(optional)</span>
					<input
						class="input mt-1"
						type="text"
						placeholder="Auto-generated if empty"
						bind:value={store.storyName}
						disabled={store.isImporting || store.importComplete}
					/>
				</label>

				<label class="block">
					<span class="text-sm font-medium text-surface-700-300">World Building File</span>
					<span class="text-xs text-surface-500 ml-2">(.md or .txt)</span>
					<input
						class="input mt-1"
						type="file"
						accept=".md,.txt"
						disabled={store.isImporting || store.importComplete}
						onchange={(e) => {
							const target = e.target as HTMLInputElement;
							store.worldFile = target.files?.[0] ?? null;
						}}
					/>
				</label>
			</section>

			<!-- Acts -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="h4">Acts / Chapters</h2>
					<button
						class="btn preset-tonal text-sm"
						type="button"
						onclick={store.addAct}
						disabled={store.isImporting || store.importComplete}
					>
						+ Add Act
					</button>
				</div>

				{#if store.acts.length === 0}
					<p class="text-sm text-surface-500">No acts added. Click "Add Act" to add one.</p>
				{/if}

				{#each store.acts as act, index (act.id)}
					<div class="card p-4 space-y-3 border border-surface-200-800">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-semibold">Act {index + 1}</h3>
							<button
								class="btn variant-ghost text-sm text-error-600"
								type="button"
								onclick={() => store.removeAct(act.id)}
								disabled={store.isImporting || store.importComplete}
							>
								Remove
							</button>
						</div>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">Act Name</span>
							<span class="text-xs text-surface-500 ml-2">(optional)</span>
							<input
								class="input mt-1"
								type="text"
								placeholder="Auto-generated if empty"
								value={act.name}
								oninput={(e) => store.updateActName(act.id, (e.target as HTMLInputElement).value)}
								disabled={store.isImporting || store.importComplete}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">Act / Chapter File</span>
							<span class="text-xs text-surface-500 ml-2">(.md or .txt)</span>
							<input
								class="input mt-1"
								type="file"
								accept=".md,.txt"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateActFile(act.id, target.files?.[0] ?? null);
								}}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">Transcript</span>
							<span class="text-xs text-surface-500 ml-2">(.json)</span>
							<input
								class="input mt-1"
								type="file"
								accept=".json"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateActTranscript(act.id, target.files?.[0] ?? null);
								}}
							/>
						</label>
					</div>
				{/each}
			</section>

			<!-- Characters -->
			<section class="card p-6 space-y-4">
				<div class="flex items-center justify-between">
					<h2 class="h4">Characters</h2>
					<button
						class="btn preset-tonal text-sm"
						type="button"
						onclick={store.addCharacter}
						disabled={store.isImporting || store.importComplete}
					>
						+ Add Character
					</button>
				</div>

				{#if store.characters.length === 0}
					<p class="text-sm text-surface-500">No characters added. Click "Add Character" to add one.</p>
				{/if}

				{#each store.characters as character (character.id)}
					<div class="card p-4 space-y-3 border border-surface-200-800">
						<div class="flex items-center justify-between">
							<h3 class="text-sm font-semibold">Character</h3>
							<button
								class="btn variant-ghost text-sm text-error-600"
								type="button"
								onclick={() => store.removeCharacter(character.id)}
								disabled={store.isImporting || store.importComplete}
							>
								Remove
							</button>
						</div>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">Character Name</span>
							<span class="text-xs text-surface-500 ml-2">(optional)</span>
							<input
								class="input mt-1"
								type="text"
								placeholder="Derived from card if empty"
								value={character.name}
								oninput={(e) => store.updateCharacterName(character.id, (e.target as HTMLInputElement).value)}
								disabled={store.isImporting || store.importComplete}
							/>
						</label>

						<label class="block">
							<span class="text-sm font-medium text-surface-700-300">Character Card</span>
							<span class="text-xs text-surface-500 ml-2">(.md or .txt, required)</span>
							<input
								class="input mt-1"
								type="file"
								accept=".md,.txt"
								disabled={store.isImporting || store.importComplete}
								onchange={(e) => {
									const target = e.target as HTMLInputElement;
									store.updateCharacterFile(character.id, target.files?.[0] ?? null);
								}}
							/>
						</label>
					</div>
				{/each}
			</section>

			<!-- Import Settings -->
			<section class="card p-6 space-y-4">
				<h2 class="h4">Import Settings</h2>

				<label class="flex items-center gap-2">
					<input
						type="checkbox"
						class="checkbox"
						bind:checked={store.skipOptionalMalformed}
						disabled={store.isImporting || store.importComplete}
					/>
					<span class="text-sm text-surface-700-300">Skip malformed optional data</span>
				</label>

				<div class="grid grid-cols-2 gap-4">
					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">LLM Retry Count</span>
						<input
							class="input mt-1"
							type="number"
							min="0"
							max="20"
							bind:value={store.retryCount}
							disabled={store.isImporting || store.importComplete}
						/>
					</label>

					<label class="block">
						<span class="text-sm font-medium text-surface-700-300">Backoff Interval (s)</span>
						<input
							class="input mt-1"
							type="number"
							min="1"
							max="60"
							bind:value={store.backoffIntervalSeconds}
							disabled={store.isImporting || store.importComplete}
						/>
					</label>
				</div>
			</section>
		{/if}

		<!-- Submit -->
		<div class="flex justify-end gap-3 pb-8">
			{#if store.importComplete}
				<button class="btn variant-filled" type="button" onclick={handleBack}> Back to Chat </button>
			{:else}
				<button class="btn variant-ghost" type="button" onclick={handleBack} disabled={store.isImporting}> Cancel </button>
				<button class="btn variant-filled" type="button" onclick={handleImport} disabled={store.isImporting}>
					{store.isImporting ? 'Importing...' : 'Import Story'}
				</button>
			{/if}
		</div>
	</div>
</div>
