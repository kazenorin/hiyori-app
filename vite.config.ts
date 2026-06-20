import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));
const baseRaw = (process.env.BASE_PATH || '').replace(/\/$/, '');
const base = baseRaw ? `${baseRaw}/` : '/';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Hiyori — Build Your Own Adventure',
				short_name: 'Hiyori',
				description: 'Interactive narrative adventure builder',
				start_url: base,
				display: 'standalone',
				background_color: '#0d1117',
				theme_color: '#0d1117',
				icons: [
					{
						src: `${base}icons/icon-192.png`,
						sizes: '192x192',
						type: 'image/png',
					},
					{
						src: `${base}icons/icon-512.png`,
						sizes: '512x512',
						type: 'image/png',
					},
				],
			},
			scope: base,
			workbox: {
				globPatterns: ['**/*.{js,css,ico,png,svg,webmanifest,wasm}'],
				maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
			},
		}),
	],
	clearScreen: false,
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
	},
	server: {
		port: 1420,
		strictPort: true,
	},
	worker: {
		format: 'es',
	},
});
