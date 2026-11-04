/* global process */
import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import type { Config } from '@sveltejs/kit/vite';

const rawBase = (process.env.BASE_PATH || '').replace(/\/$/, '');
const base = rawBase as '' | `/${string}`;

const config: Config = {
	preprocess: vitePreprocess(),
	adapter: adapter({
		fallback: '200.html',
	}),
	paths: { base },
};

export default config;
