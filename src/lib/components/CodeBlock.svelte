<script lang="ts" module>
	import { createHighlighterCore } from 'shiki/core';
	import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

	const highlighter = await createHighlighterCore({
		langs: [
			import('@shikijs/langs/json'),
			import('@shikijs/langs/markdown'),
			import('@shikijs/langs/yaml'),
		],
		themes: [import('@shikijs/themes/github-dark'), import('@shikijs/themes/github-light')],
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

	let isDark = $state(window.matchMedia('(prefers-color-scheme: dark)').matches);

	const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
	mediaQuery.addEventListener('change', (e) => {
		isDark = e.matches;
	});

	const generatedHtml = $derived(
		lang && supportedLangs.has(lang)
			? DOMPurify.sanitize(highlighter.codeToHtml(code, { lang, theme: isDark ? 'github-dark' : 'github-light' }))
			: DOMPurify.sanitize(
					`<pre class="p-4 overflow-x-auto rounded-(--radius-base) text-xs leading-relaxed">${code}</pre>`,
				),
	);
</script>

<div class="overflow-auto rounded-container max-h-[70vh]">
	<!-- eslint-disable-next-line svelte/no-at-html-tags -- sanitized via DOMPurify -->
	{@html generatedHtml}
</div>
