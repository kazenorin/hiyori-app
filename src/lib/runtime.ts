let _isTauri: boolean | undefined;

/**
 * Async check if running inside a Tauri window.
 * Caches result after first call. The Tauri API is loaded dynamically
 * only when we haven't cached a result yet — tree-shakeable in web builds.
 */
export async function checkIsTauri(): Promise<boolean> {
	if (_isTauri !== undefined) return _isTauri;
	try {
		const { isTauri } = await import('@tauri-apps/api/core');
		_isTauri = isTauri();
	} catch {
		_isTauri = false;
	}
	return _isTauri;
}

/**
 * Synchronous check. Returns the cached result, or false if
 * checkIsTauri() hasn't been called yet. Use for code paths
 * that run after initialization.
 */
export function isTauriSync(): boolean {
	return _isTauri ?? false;
}

/**
 * Force-reset the cached result (for testing).
 */
export function resetTauriCache(): void {
	_isTauri = undefined;
}
