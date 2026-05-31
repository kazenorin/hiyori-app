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
	const { code, lang = 'txt' }: CodeBlockProps = $props();

	const generatedHtml =
		lang && supportedLangs.has(lang)
			? highlighter.codeToHtml(code, { lang, theme: 'github-dark' })
			: `<pre class="bg-surface-950-50 text-surface-800-200 p-4 overflow-x-auto rounded-(--radius-base) text-xs leading-relaxed">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
</script>

<div class="overflow-auto rounded-container">
	{@html generatedHtml}
</div>
