import tailwindcss from '@tailwindcss/vite';
import { withPwa } from '@vite-pwa/sveltekit';
import { defineConfig } from 'vite';
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
		// SvelteKit 3 does not run Vite's transformIndexHtml hook, which the PWA
		// integration uses to inject the manifest link. It is added in app.html.
		withPwa(kitConfig, {
			// PWA is only meaningful for a root-hosted web build.
			disable: !pwaEnabled,
			outDir: '.svelte-kit/output/client',
			registerType: 'autoUpdate',
			base,
			scope: base,
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
			// The onnxruntime wasm is ~27 MB and loaded on demand; keep it out of the precache.
			maximumFileSizeToCacheInBytes: 25 * 1024 * 1024,
			generateSW: {
				globPatterns: ['client/**/*.{js,css,ico,png,svg,webp,webmanifest,wasm}', 'prerendered/**/*.{html,json}'],
				globIgnores: ['**/workers/assets/**'],
			},
		}),
	],
	build: {
		// AI SDK + zod and marked + bundled localized prompts are intentionally large,
		// offline-cached chunks; the default 500 kB limit does not apply to this app.
		chunkSizeWarningLimit: 1500,
	},
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
