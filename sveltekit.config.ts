/* global process */
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import type { Config } from '@sveltejs/kit/vite';

const rawBase = (process.env.BASE_PATH || '').replace(/\/$/, '');
const base = rawBase as '' | `/${string}`;

const config: Config = {
	preprocess: vitePreprocess(),
	adapter: adapter({
		fallback: 'index.html',
	}),
	paths: { base },
	// SvelteKit 3 replaced the implicit `$lib` alias with Node subpath imports
	// (`#lib`). Keep `$lib` so existing imports don't need rewriting.
	alias: { $lib: 'src/lib' },
};

export default config;
