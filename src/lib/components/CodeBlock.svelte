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

	interface CodeBlockProps {
		code: string;
		lang?: string;
	}
</script>

<script lang="ts">
	const { code, lang = 'txt' }: CodeBlockProps = $props();

	const supportedLangs = new Set(highlighter.getLoadedLanguages());

	const generatedHtml =
		lang && supportedLangs.has(lang)
			? highlighter.codeToHtml(code, { lang, theme: 'github-dark' })
			: `<pre style="background-color:#0d1117;color:#e6edf3;padding:1rem;overflow-x:auto;border-radius:0.375rem;font-size:0.75rem;line-height:1.625;">${code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
</script>

<div class="overflow-auto rounded-container [&>pre]:p-4 [&>pre]:text-xs [&>pre]:leading-relaxed">
	{@html generatedHtml}
</div>
