<script lang="ts">
	import { isNearBottom, scrollToBottom } from '$lib/utils/scroll';

	interface Props {
		chatContainer: HTMLDivElement | null;
		isStreaming: boolean;
		thresholdPx?: number;
	}

	let { chatContainer, isStreaming, thresholdPx = 150 }: Props = $props();

	let visible = $state(false);

	$effect(() => {
		const container = chatContainer;
		if (!container) return;

		visible = !isStreaming && !isNearBottom(container, thresholdPx);

		let rafId = 0;

		const onScroll = () => {
			cancelAnimationFrame(rafId);
			rafId = requestAnimationFrame(() => {
				visible = !isStreaming && !isNearBottom(container, thresholdPx);
			});
		};

		container.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(rafId);
			container.removeEventListener('scroll', onScroll);
		};
	});

	$effect(() => {
		if (isStreaming) visible = false;
	});

	function handleClick() {
		if (chatContainer) scrollToBottom(chatContainer, true);
	}
</script>

<button
	type="button"
	aria-label="Scroll to bottom"
	onclick={handleClick}
	class="mx-auto -mt-9 mb-2 max-md:mb-[100px] z-10 rounded-full
	       h-10 w-10 flex items-center justify-center
	       bg-surface-50-950 border border-surface-200-700
	       shadow-lg transition-all duration-150
	       {visible
		? 'opacity-50 pointer-events-auto hover:opacity-100 hover:shadow-xl hover:border-primary-500'
		: 'opacity-0 pointer-events-none'}"
>
	<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
		<path
			fill-rule="evenodd"
			d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
			clip-rule="evenodd"
		/>
	</svg>
</button>
