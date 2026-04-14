<script lang="ts">
	import { goto } from '$app/navigation';

	function handleBack() {
		goto('/');
	}
</script>

<div class="flex flex-col items-center justify-center min-h-full p-8">
	<div class="max-w-lg w-full">
		<h1 class="text-2xl font-semibold text-surface-900-100 mb-4">Import World</h1>
		<p class="text-surface-600-400 mb-6">
			Import an existing world document to start a new story.
		</p>
		<div class="bg-surface-50-950 border border-surface-200-800 rounded-xl p-8 text-center">
			<p class="text-surface-500 italic">Import functionality coming soon...</p>
		</div>
		<button
			class="mt-6 px-4 py-2 rounded-lg bg-surface-200-800 hover:bg-surface-300-700 text-surface-700-300 text-sm transition-colors"
			type="button"
			onclick={handleBack}
		>
			Back to Chat
		</button>
	</div>
</div>