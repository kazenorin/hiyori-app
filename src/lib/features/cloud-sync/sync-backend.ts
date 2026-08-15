export interface SyncEntry {
	path: string;
	size: number;
	modifiedAt?: Date;
}

/**
 * Thrown by backends when a requested object does not exist (HTTP 404).
 * The sync engine distinguishes "remote is empty" (benign) from other
 * download failures, which must abort the sync instead of being treated
 * as an empty remote.
 */
export class NotFoundError extends Error {
	constructor(path: string) {
		super(`Not found: ${path}`);
		this.name = 'NotFoundError';
	}
}

/**
 * Transport abstraction for cloud sync. Implementations know nothing about
 * stories; the sync engine (sync-engine.ts) owns all story semantics.
 * Paths are relative to the backend's configured root/prefix and use '/' separators.
 */
export interface SyncBackend {
	/** Throws a human-actionable Error on failure (bad credentials, unreachable, CORS). */
	testConnection(): Promise<void>;
	list(prefix: string): Promise<SyncEntry[]>;
	upload(path: string, data: Uint8Array): Promise<void>;
	download(path: string): Promise<Uint8Array>;
	delete(path: string): Promise<void>;
}
