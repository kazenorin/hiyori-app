import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';
import kitConfig from './sveltekit.config.ts';

export default defineConfig({
	plugins: [sveltekit(kitConfig)],
	test: {
		include: ['src/**/*.test.ts'],
		environment: 'jsdom',
		setupFiles: ['src/lib/__tests__/setup.ts'],
	},
});
