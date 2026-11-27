<script module lang="ts">
	import DOMPurify from 'dompurify';
	import { resolveFetch } from '#lib/http/fetch.ts';

	const LOGO_BASE_URL = 'https://models.dev/logos';
	const logoCache: Record<string, string | null> = {};
	const pending = new WeakMap<Element, { id: string; apply: (svg: string | null) => void }>();
	let observer: IntersectionObserver | null = null;

	async function loadLogo(id: string): Promise<string | null> {
		try {
			const f = await resolveFetch();
			const response = await f(`${LOGO_BASE_URL}/${encodeURIComponent(id)}.svg`);
			if (!response.ok) return null;
			const markup = await response.text();
			if (!markup.includes('<svg')) return null;
			const sanitized = DOMPurify.sanitize(markup, { USE_PROFILES: { svg: true } }).trim();
			return sanitized || null;
		} catch {
			return null;
		}
	}

	function getObserver(): IntersectionObserver {
		observer ??= new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (!entry.isIntersecting) continue;
					const request = pending.get(entry.target);
					if (!request) continue;
					pending.delete(entry.target);
					observer?.unobserve(entry.target);
					void loadLogo(request.id).then((svg) => {
						logoCache[request.id] = svg;
						request.apply(svg);
					});
				}
			},
			{ rootMargin: '200px' }
		);
		return observer;
	}

	function observeLogo(el: Element, id: string, apply: (svg: string | null) => void): () => void {
		if (Object.hasOwn(logoCache, id)) {
			apply(logoCache[id]);
			return () => {};
		}
		pending.set(el, { id, apply });
		getObserver().observe(el);
		return () => {
			pending.delete(el);
			observer?.unobserve(el);
		};
	}
</script>

<script lang="ts">
	const SIZE_CLASS = {
		md: 'h-9 w-9 rounded-lg p-1',
		lg: 'h-12 w-12 rounded-xl p-1.5',
	} as const;

	interface Props {
		id: string;
		name?: string;
		size?: keyof typeof SIZE_CLASS;
		class?: string;
	}

	let { id, name, size = 'md', class: extraClass = '' }: Props = $props();

	let container = $state<HTMLSpanElement | null>(null);
	let svg = $state<string | null>(null);

	$effect(() => {
		const el = container;
		const catalogId = id;
		if (!el) return;
		svg = null;
		return observeLogo(el, catalogId, (markup) => {
			if (el.isConnected) svg = markup;
		});
	});

	const letter = $derived((name || id).charAt(0).toUpperCase());
</script>

<span
	bind:this={container}
	class="inline-flex shrink-0 items-center justify-center overflow-hidden border border-surface-200-800 bg-surface-100-900 text-primary-500 [&>svg]:h-full [&>svg]:w-full {SIZE_CLASS[
		size
	]} {extraClass}"
	aria-hidden="true"
>
	{#if svg}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via DOMPurify -->
		{@html svg}
	{:else}
		<span class="font-bold {size === 'lg' ? 'text-base' : 'text-sm'}">{letter}</span>
	{/if}
</span>
