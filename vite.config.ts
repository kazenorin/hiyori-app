import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import kitConfig from './sveltekit.config.ts';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));
const baseRaw = (process.env.BASE_PATH || '').replace(/\/$/, '');
const base = baseRaw ? `${baseRaw}/` : '/';
const isTauriBuild = !!process.env.TAURI_ENV_PLATFORM;
const pwaEnabled = baseRaw === '' && !isTauriBuild;

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(kitConfig),
		VitePWA({
			// PWA is only meaningful for a root-hosted web build.
			disable: !pwaEnabled,
			outDir: '.svelte-kit/output/client',
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
				// The onnxruntime wasm is ~27 MB and loaded on demand; keep it out of the precache.
				globIgnores: ['**/workers/assets/**'],
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
		watch: {
			// Ignore the Rust build output so the dev watcher doesn't choke on
			// locked .exe artifacts on Windows (EBUSY).
			ignored: ['**/src-tauri/target/**'],
		},
	},
	worker: {
		format: 'es',
	},
});
