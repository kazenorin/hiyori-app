export function scrollToBottom(container: HTMLElement, smooth = false): void {
	if (smooth) {
		container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
	} else {
		container.scrollTop = container.scrollHeight;
	}
}

export function isNearBottom(container: HTMLElement, thresholdPx = 150): boolean {
	return container.scrollHeight - container.scrollTop - container.clientHeight < thresholdPx;
}
