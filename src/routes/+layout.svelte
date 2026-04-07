<script lang="ts">
	import './+layout.css';

	let { children } = $props();
</script>

<div class="flex h-screen overflow-hidden bg-surface-50-950">
	<!-- Sidebar -->
	<aside class="w-72 border-r border-surface-200-800 flex flex-col">
		<!-- Sidebar navigation -->
		<nav class="flex-1 overflow-y-auto p-2 pt-4 space-y-1">
			<a
				href="/"
				class="block p-3 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150"
			>
				<p class="text-sm font-medium truncate">New Adventure</p>
				<p class="text-xs text-surface-500 truncate">Start a new story...</p>
			</a>
		</nav>

		<!-- Sidebar footer -->
		<div class="p-3 border-t border-surface-200-800">
			<a
				href="/settings"
				class="flex items-center gap-2 p-2 rounded-[var(--radius-base)] hover:bg-surface-200-800 transition-colors duration-150 text-sm text-surface-500"
			>
				Settings
			</a>
		</div>
	</aside>

	<!-- Main content -->
	<main class="flex-1 flex flex-col min-w-0">
		{@render children()}
	</main>
</div>
