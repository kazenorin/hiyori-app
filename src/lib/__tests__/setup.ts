// jsdom does not implement window.matchMedia. Polyfill it for tests that
// transitively load settings.svelte.ts (whose applyTheme() runs at module
// init) or any other module that calls matchMedia at import time.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
	window.matchMedia = (query: string): MediaQueryList => ({
		matches: false,
		media: query,
		onchange: null,
		addEventListener: () => {},
		removeEventListener: () => {},
		addListener: () => {},
		removeListener: () => {},
		dispatchEvent: () => false,
	});
}
