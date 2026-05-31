<script lang="ts" module>
	import { createHighlighterCore } from 'shiki/core';
	import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

	const highlighter = await createHighlighterCore({
		langs: [
			import('@shikijs/langs/json'),
			import('@shikijs/langs/markdown'),
			import('@shikijs/langs/yaml'),
		],
		themes: [import('@shikijs/themes/github-dark')],
		engine: createJavaScriptRegexEngine(),
	});

	const supportedLangs = new Set(highlighter.getLoadedLanguages());

	interface CodeBlockProps {
		code: string;
		lang?: string;
	}
</script>

<script lang="ts">
	import DOMPurify from 'dompurify';

	const { code, lang = 'txt' }: CodeBlockProps = $props();

	const generatedHtml = $derived(
		lang && supportedLangs.has(lang)
			? DOMPurify.sanitize(highlighter.codeToHtml(code, { lang, theme: 'github-dark' }))
			: DOMPurify.sanitize(
					`<pre class="bg-surface-950-50 text-surface-800-200 p-4 overflow-x-auto rounded-(--radius-base) text-xs leading-relaxed">${code}</pre>`,
				),
	);
</script>

<div class="overflow-auto rounded-container">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via DOMPurify -->
	{@html generatedHtml}
</div>
