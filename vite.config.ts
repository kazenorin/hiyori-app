import tailwindcss from '@tailwindcss/vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'BYOA — Build Your Own Adventure',
				short_name: 'BYOA',
				description: 'Interactive narrative adventure builder',
				start_url: '/',
				display: 'standalone',
				background_color: '#0d1117',
				theme_color: '#0d1117',
				icons: [
					{
						src: '/icons/icon-192.png',
						sizes: '256x256',
						type: 'image/png',
					},
					{
						src: '/icons/icon-512.png',
						sizes: '512x512',
						type: 'image/png',
					},
				],
			},
			scope: '/',
			workbox: {
				globPatterns: ['**/*.{js,css,ico,png,svg,webmanifest,wasm}'],
			},
		}),
	],
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
});
