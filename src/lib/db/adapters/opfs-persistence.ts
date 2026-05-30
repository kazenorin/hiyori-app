export async function persistToOpfs(data: Uint8Array, filename: string): Promise<void> {
	const root = await navigator.storage.getDirectory();
	const fileHandle = await root.getFileHandle(filename, { create: true });
	const writable = await fileHandle.createWritable();
	await writable.write(data.buffer as ArrayBuffer);
	await writable.close();
}

export async function loadFromOpfs(filename: string): Promise<Uint8Array | null> {
	try {
		const root = await navigator.storage.getDirectory();
		const fileHandle = await root.getFileHandle(filename);
		const file = await fileHandle.getFile();
		const buffer = await file.arrayBuffer();
		return new Uint8Array(buffer);
	} catch (err) {
		console.warn(`[opfs-persistence] Failed to load ${filename}:`, err);
		return null;
	}
}
