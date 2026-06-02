<script lang="ts">
	import { isNearBottom, scrollToBottom } from '$lib/utils/scroll';
	import Icon from '$lib/components/ui/Icon.svelte';

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
	class="z-10 rounded-full
	       h-10 w-10 flex items-center justify-center
	       bg-surface-50-950 border border-surface-200-700
	       shadow-lg transition-all duration-150
	       fixed md:static left-1/2 md:left-auto -translate-x-1/2 md:translate-x-0
	       bottom-[120px] md:bottom-auto md:mx-auto md:-mt-9 md:mb-2
	       {visible
		? 'opacity-50 pointer-events-auto hover:opacity-100 hover:shadow-xl hover:border-primary-500'
		: 'opacity-0 pointer-events-none'}"
>
	<Icon name="chevron-down" class="h-5 w-5" />
</button>
