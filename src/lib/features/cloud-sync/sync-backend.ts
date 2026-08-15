export interface SyncEntry {
	path: string;
	size: number;
	modifiedAt?: Date;
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
