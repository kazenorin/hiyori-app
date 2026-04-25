<script lang="ts">
	import { marked } from 'marked';
	import DOMPurify from 'dompurify';

	interface Props {
		content: string;
	}

	let { content }: Props = $props();

	let html = $derived(DOMPurify.sanitize(marked.parse(content, { async: false }) as string));
</script>

<div class="markdown-content">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via DOMPurify -->
	{@html html}
</div>

<style>
	@reference "../../routes/+layout.css";

	.markdown-content {
		font-size: var(--text-base);
	}
	.markdown-content :global(h1) {
		font-size: var(--text-2xl);
		@apply font-bold mt-6 mb-3;
	}
	.markdown-content :global(h2) {
		font-size: var(--text-xl);
		@apply font-semibold mt-5 mb-2;
	}
	.markdown-content :global(h3) {
		font-size: var(--text-lg);
		@apply font-semibold mt-4 mb-2;
	}
	.markdown-content :global(h4) {
		font-size: var(--text-base);
		@apply font-semibold mt-3 mb-1;
	}
	.markdown-content :global(p) {
		@apply mb-3 leading-relaxed;
	}
	.markdown-content :global(p:last-child) {
		@apply mb-0;
	}
	.markdown-content :global(ul) {
		@apply list-disc pl-5 mb-3;
	}
	.markdown-content :global(ul > li) {
		@apply mt-1;
	}
	.markdown-content :global(ol) {
		@apply list-decimal pl-5 mb-3;
	}
	.markdown-content :global(ol > li) {
		@apply mt-1;
	}
	.markdown-content :global(li) {
		@apply leading-relaxed;
	}
	.markdown-content :global(blockquote) {
		@apply border-l-4 border-surface-300-700 pl-4 italic my-3;
	}
	.markdown-content :global(code) {
		font-size: var(--text-xs);
		@apply font-mono bg-surface-200-800 rounded px-1.5 py-0.5;
	}
	.markdown-content :global(pre) {
		font-size: var(--text-xs);
		@apply font-mono bg-surface-200-800 rounded-lg p-4 overflow-x-auto my-3;
	}
	.markdown-content :global(pre code) {
		@apply bg-transparent p-0 rounded-none;
	}
	.markdown-content :global(a) {
		@apply text-primary-500 underline;
	}
	.markdown-content :global(a:hover) {
		@apply text-primary-600;
	}
	.markdown-content :global(strong) {
		@apply font-semibold;
	}
	.markdown-content :global(em) {
		@apply italic;
	}
	.markdown-content :global(hr) {
		@apply border-surface-200-800 my-4;
	}
	.markdown-content :global(table) {
		@apply w-full border-collapse my-3;
	}
	.markdown-content :global(th) {
		@apply border border-surface-200-800 px-3 py-2 text-left font-semibold;
	}
	.markdown-content :global(td) {
		@apply border border-surface-200-800 px-3 py-2;
	}
</style>
