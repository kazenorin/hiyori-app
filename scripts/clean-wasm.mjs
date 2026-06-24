import { rmSync } from 'fs';

const files = ['build/sql-wasm.wasm', 'build/libcurl.wasm'];

for (const f of files) {
	rmSync(f, { force: true });
}
