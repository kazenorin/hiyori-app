import { copyFileSync } from 'fs';

const files = [
	{ src: 'node_modules/sql.js/dist/sql-wasm.wasm', dest: 'static/sql-wasm.wasm' },
	{ src: 'node_modules/libcurl.js/libcurl.wasm', dest: 'static/libcurl.wasm' },
];

for (const { src, dest } of files) {
	try {
		copyFileSync(src, dest);
	} catch (err) {
		if (err.code === 'ENOENT') {
			console.error(`postinstall: ${src} not found — run npm install first`);
			process.exit(1);
		}
		throw err;
	}
}
