/* global process */
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

const rawBase = (process.env.BASE_PATH || '').replace(/\/$/, '');
const base = /** @type {"" | `/${string}`} */ (rawBase);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			fallback: 'index.html',
		}),
		paths: { base },
	},
};

export default config;
