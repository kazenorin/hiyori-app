import { scrollToBottom } from '$lib/utils/scroll';

function isCursorVisible(container: HTMLDivElement | null): boolean {
	if (!container) return false;
	const cursor = container.querySelector('[data-streaming-cursor]');
	if (!cursor) return false;
	const containerRect = container.getBoundingClientRect();
	const cursorRect = cursor.getBoundingClientRect();
	return cursorRect.top <= containerRect.bottom && cursorRect.bottom >= containerRect.top;
}

export function setupScrollObservers(container: HTMLDivElement): () => void {
	const scrollIfCursorVisible = () => {
		if (isCursorVisible(container)) {
			scrollToBottom(container);
		}
	};

	const mutationObserver = new MutationObserver(() => scrollIfCursorVisible());
	mutationObserver.observe(container, { childList: true, subtree: true, characterData: true });

	const resizeObserver = new ResizeObserver(() => scrollIfCursorVisible());
	resizeObserver.observe(container);

	return () => {
		mutationObserver.disconnect();
		resizeObserver.disconnect();
	};
}

export function handleStreamEndScroll(container: HTMLDivElement | null, wasStreaming: boolean, isStreaming: boolean): boolean {
	if (wasStreaming && !isStreaming && container) {
		requestAnimationFrame(() => {
			if (container) scrollToBottom(container);
		});
	}
	return isStreaming;
}
