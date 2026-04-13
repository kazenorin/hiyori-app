<script lang="ts">
	import { goto } from '$app/navigation';
	import { getActiveStory, getActiveAct, getActiveActLine } from '$lib/stores/stories.svelte';
	import {
		getCharacters,
		getIsExtracting,
		getIsGenerating,
		getExtractionError,
		getGenerationError,
		getRawExtractionOutput,
		getProgress,
		getResults,
		extractCharacters,
		generateCards,
		updateCharacter,
		addManualCharacter,
		removeCharacter,
		resetState
	} from '$lib/stores/character-card.svelte';
	import { onMount } from 'svelte';

	let concurrent = $state(false);

	onMount(() => {
		resetState();
		extractCharacters();
	});

	function handleGenerate() {
		generateCards(concurrent);
	}

	function handleBack() {
		resetState();
		goto('/');
	}

	function updateCanonicalName(index: number, value: string) {
		updateCharacter(index, { canonicalName: value });
	}

	function updateInclude(index: number, value: boolean) {
		updateCharacter(index, { include: value });
	}

	function handleAddRow() {
		addManualCharacter();
	}

	function handleRemoveRow(index: number) {
		removeCharacter(index);
	}
</script>

<svelte:head>
	<title>Generate Character Cards</title>
</svelte:head>

<div class="container">
	<!-- Header -->
	<div class="header">
		<button class="back-btn" onclick={handleBack}>← Back</button>
		<h1>Generate Character Cards</h1>
	</div>

	<!-- Context Info -->
	<div class="context-info">
		<span class="label">Story:</span>
		<span class="value">{getActiveStory()?.name ?? '—'}</span>
		<span class="label">Act:</span>
		<span class="value">{getActiveAct()?.actNumber ?? '—'}</span>
		<span class="label">Act Line:</span>
		<span class="value">{getActiveActLine()?.name ?? '—'}</span>
		<span class="label">Act Line ID:</span>
		<span class="value id">{getActiveActLine()?.id ?? '—'}</span>
	</div>

	<!-- Extraction Loading -->
	{#if getIsExtracting()}
		<div class="loading-overlay" role="alert" aria-live="polite" aria-busy="true">
			<div class="spinner" aria-hidden="true"></div>
			<p>Extracting characters from act...</p>
		</div>
	{/if}

	<!-- Extraction Error -->
	{#if getExtractionError() && !getIsExtracting()}
		<div class="error-box">
			<p>{getExtractionError()}</p>
		</div>
	{/if}

	<!-- Raw Output (if parse failed) -->
	{#if getRawExtractionOutput() && !getIsExtracting()}
		<div class="raw-output">
			<h3>Raw LLM Output</h3>
			<pre>{getRawExtractionOutput()}</pre>
		</div>
	{/if}

	<!-- Character Table -->
	{#if !getIsExtracting() && (getCharacters().length > 0 || getExtractionError())}
		<div class="character-table">
			<div class="table-header">
				<span class="col-name">Character Name</span>
				<span class="col-summary">Summary</span>
				<span class="col-canonical">Canonical Name</span>
				<span class="col-include">Include</span>
				<span class="col-actions"></span>
			</div>

			{#each getCharacters() as char, i (i)}
				<div class="table-row">
					<span class="col-name">
						{#if char.isManual}
							<input
								type="text"
								value={char.character}
								oninput={(e) => updateCharacter(i, { character: e.currentTarget.value })}
								placeholder="Enter name"
							/>
						{:else}
							{char.character}
						{/if}
					</span>
					<span class="col-summary">
						{#if char.isManual}
							<input
								type="text"
								value={char.importance}
								oninput={(e) => updateCharacter(i, { importance: e.currentTarget.value })}
								placeholder="Summary"
							/>
						{:else}
							{char.importance}
						{/if}
					</span>
					<span class="col-canonical">
						<input
							type="text"
							value={char.canonicalName}
							oninput={(e) => updateCanonicalName(i, e.currentTarget.value)}
						/>
					</span>
					<span class="col-include">
						{#if char.isManual}
							<span class="manual-note">(manual)</span>
						{:else}
							<input type="checkbox" checked={char.include} onchange={(e) => updateInclude(i, e.currentTarget.checked)} />
						{/if}
					</span>
					<span class="col-actions">
						{#if char.isManual}
							<button class="remove-btn" onclick={() => handleRemoveRow(i)}>×</button>
						{/if}
					</span>
				</div>
			{/each}

			<button class="add-row-btn" onclick={handleAddRow}>+ Add Row</button>
		</div>
	{/if}

	<!-- Remarks Box -->
	{#if !getIsExtracting()}
		<div class="remarks-box">
			<h4>Remarks</h4>
			<ul>
				<li>Canonical names must remain consistent throughout the entire story.</li>
				<li>Character cards are maintained per act line (not globally).</li>
				<li>Cards are generated from the current act's content. If cards exist for the current act line <strong>and</strong> previous acts in the lineage, their content contributes to generation context.</li>
				<li>If a card for the current act line already exists, <strong>it will be overwritten</strong>.</li>
			</ul>
		</div>
	{/if}

	<!-- Generation Controls -->
	{#if !getIsExtracting() && !getIsGenerating() && getCharacters().length > 0}
		<div class="controls">
			<label class="concurrent-label">
				<input type="checkbox" bind:checked={concurrent} />
				Concurrent Generation
			</label>
			<button class="generate-btn" onclick={handleGenerate}>Generate Cards</button>
		</div>
	{/if}

	<!-- Generation Progress Overlay -->
	{#if getIsGenerating()}
		{@const total = getProgress()?.total ?? getCharacters().length}
		{@const completed = getProgress()?.completed ?? 0}
		<div class="loading-overlay" role="alert" aria-live="polite" aria-busy="true">
			<div class="progress-box">
				<p>Generating {completed + 1} of {total} characters...</p>
				<p class="current-char">{getProgress()?.currentCharacter ?? ''}</p>
				<div class="progress-bar" role="progressbar" aria-valuenow={completed} aria-valuemin={0} aria-valuemax={total}>
					<div
						class="progress-fill"
						style="width: {total > 0 ? (completed / total) * 100 : 0}%"
					></div>
				</div>
			</div>
		</div>
	{/if}

	<!-- Generation Error -->
	{#if getGenerationError() && !getIsGenerating()}
		<div class="error-box">
			<p>{getGenerationError()}</p>
		</div>
	{/if}

	<!-- Results -->
	{#if getResults().length > 0 && !getIsGenerating()}
		<div class="success-box">
			<h3>Generated {getResults().length} character cards:</h3>
			<ul>
				{#each getResults() as r}
					<li>
						<strong>{r.characterName}</strong>: {r.filePath}
					</li>
				{/each}
			</ul>
		</div>
	{/if}
</div>

<style>
	.container {
		max-width: 900px;
		margin: 0 auto;
		padding: 20px;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 16px;
		margin-bottom: 20px;
	}

	.back-btn {
		padding: 8px 16px;
		background: #555;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	.back-btn:hover {
		background: #666;
	}

	h1 {
		margin: 0;
	}

	.context-info {
		background: var(--color-surface-200);
		padding: 16px;
		border-radius: 8px;
		margin-bottom: 20px;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 8px 16px;
	}

	.label {
		font-weight: 600;
		color: var(--color-surface-700);
		white-space: nowrap;
	}

	.value {
		color: var(--color-surface-900);
	}

	.value.id {
		font-size: 0.85em;
		color: var(--color-surface-600);
	}

	.loading-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #fff;
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	.progress-box {
		background: var(--color-surface-100);
		color: var(--color-surface-900);
		padding: 24px;
		border-radius: 8px;
		text-align: center;
		min-width: 300px;
	}

	.current-char {
		font-size: 1.1em;
		font-weight: 600;
		margin: 8px 0 16px;
	}

	.progress-bar {
		height: 12px;
		background: var(--color-surface-300);
		border-radius: 6px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #4a90d9;
		transition: width 0.2s;
	}

	.error-box {
		background: rgba(204, 0, 0, 0.1);
		border: 1px solid #c00;
		padding: 16px;
		border-radius: 8px;
		margin-bottom: 20px;
	}

	.error-box p {
		margin: 0;
		color: #900;
	}

	.raw-output {
		background: var(--color-surface-200);
		padding: 16px;
		border-radius: 8px;
		margin-bottom: 20px;
	}

	.raw-output h3 {
		margin: 0 0 12px;
		color: var(--color-surface-900);
	}

	.raw-output pre {
		white-space: pre-wrap;
		word-break: break-word;
		font-size: 0.85em;
		color: var(--color-surface-700);
	}

	.character-table {
		margin-bottom: 20px;
	}

	.table-header {
		display: flex;
		gap: 16px;
		padding: 12px 0;
		font-weight: 600;
		border-bottom: 2px solid var(--color-surface-300);
		color: var(--color-surface-900);
	}

	.table-row {
		display: flex;
		gap: 16px;
		padding: 12px 0;
		border-bottom: 1px solid var(--color-surface-200);
		align-items: center;
		color: var(--color-surface-800);
	}

	.col-name {
		min-width: 150px;
	}

	.col-summary {
		min-width: 200px;
	}

	.col-canonical {
		min-width: 120px;
	}

	.col-include {
		min-width: 80px;
		text-align: center;
	}

	.col-actions {
		min-width: 40px;
	}

	.table-row input[type="text"] {
		width: 100%;
		padding: 6px 8px;
		border: 1px solid var(--color-surface-400);
		border-radius: 4px;
		background: var(--color-surface-100);
		color: var(--color-surface-900);
	}

	.table-row input[type="checkbox"] {
		width: 18px;
		height: 18px;
	}

	.manual-note {
		font-size: 0.85em;
		color: var(--color-surface-600);
	}

	.remove-btn {
		background: #c00;
		color: white;
		border: none;
		border-radius: 4px;
		padding: 4px 10px;
		cursor: pointer;
	}

	.remove-btn:hover {
		background: #a00;
	}

	.add-row-btn {
		margin-top: 12px;
		padding: 8px 16px;
		background: #555;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
	}

	.add-row-btn:hover {
		background: #666;
	}

	.remarks-box {
		background: rgba(74, 144, 217, 0.1);
		border: 1px solid #4a90d9;
		padding: 16px;
		border-radius: 8px;
		margin-bottom: 20px;
		color: var(--color-surface-800);
	}

	.remarks-box h4 {
		margin: 0 0 12px;
		color: var(--color-surface-900);
	}

	.remarks-box ul {
		margin: 0;
		padding-left: 20px;
	}

	.remarks-box li {
		margin-bottom: 8px;
	}

	.remarks-box li:last-child {
		margin-bottom: 0;
	}

	.controls {
		display: flex;
		gap: 16px;
		align-items: center;
		margin-bottom: 20px;
	}

	.concurrent-label {
		display: flex;
		gap: 8px;
		align-items: center;
		color: var(--color-surface-800);
	}

	.generate-btn {
		padding: 12px 24px;
		background: #4a90d9;
		color: white;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-weight: 600;
	}

	.generate-btn:hover {
		background: #3a80c9;
	}

	.success-box {
		background: rgba(0, 204, 0, 0.1);
		border: 1px solid #0c0;
		padding: 16px;
		border-radius: 8px;
		color: var(--color-surface-800);
	}

	.success-box h3 {
		margin: 0 0 12px;
		color: var(--color-surface-900);
	}

	.success-box ul {
		margin: 0;
		padding-left: 20px;
	}

	.success-box li {
		margin-bottom: 4px;
	}
</style>
