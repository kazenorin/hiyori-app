export interface SyncManifestEntry {
	name: string;
	archiveHash: string;
	updatedAt: number;
}

export interface SyncManifest {
	version: 1;
	stories: Record<string, SyncManifestEntry>;
}

export function emptyManifest(): SyncManifest {
	return { version: 1, stories: {} };
}

export function parseManifest(json: string): SyncManifest {
	const parsed = JSON.parse(json) as SyncManifest;
	if (parsed.version !== 1 || typeof parsed.stories !== 'object') {
		throw new Error('Invalid cloud sync manifest format');
	}
	return parsed;
}

async function sha256Hex(text: string): Promise<string> {
	const buffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

/**
 * Content hash over the story-data payload plus the sorted set of
 * story-folder file hashes. Deterministic regardless of file enumeration order.
 */
export async function computeContentHash(
	storyDataJson: string,
	files: { path: string; hash: string }[]
): Promise<string> {
	const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
	const fingerprint = JSON.stringify({ storyData: storyDataJson, files: sorted });
	return sha256Hex(fingerprint);
}

export async function hashBytes(data: Uint8Array): Promise<string> {
	// slice() yields an ArrayBuffer-backed view accepted by BufferSource.
	const buffer = await crypto.subtle.digest('SHA-256', data.slice());
	return Array.from(new Uint8Array(buffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}
