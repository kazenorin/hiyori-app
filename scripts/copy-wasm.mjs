import { copyFileSync } from 'fs';

const src = 'node_modules/sql.js/dist/sql-wasm.wasm';
const dest = 'static/sql-wasm.wasm';

try {
	copyFileSync(src, dest);
} catch (err) {
	if (err.code === 'ENOENT') {
		console.error(`postinstall: ${src} not found — run npm install first`);
		process.exit(1);
	}
	throw err;
}
