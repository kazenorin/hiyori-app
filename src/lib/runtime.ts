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
 * Force-reset the Tauri-detection cached result (for testing).
 */
export function resetTauriCache(): void {
	_isTauri = undefined;
}

export type Platform = 'web' | 'desktop' | 'android';

let _platform: Platform | undefined;

/**
 * Detect the current platform.
 * Uses @tauri-apps/plugin-os to distinguish desktop vs android inside Tauri.
 * Falls back to 'web' when not running in a Tauri shell.
 * Result is cached after first resolution.
 *
 * Note: plugin-os's platform() is sync and only invoked when isTauriSync()
 * is true, so this function is safe to call in the web build (the dynamic
 * import is only triggered inside a Tauri shell).
 */
export async function detectPlatform(): Promise<Platform> {
	if (_platform !== undefined) return _platform;
	if (!isTauriSync()) {
		_platform = 'web';
		return _platform;
	}
	try {
		const { platform } = await import('@tauri-apps/plugin-os');
		const os = platform();
		_platform = os === 'android' ? 'android' : 'desktop';
	} catch {
		// plugin-os unavailable — assume web
		_platform = 'web';
	}
	return _platform;
}

/** Sync accessor for the cached platform. Returns 'web' before detectPlatform() resolves. */
export function getPlatformSync(): Platform {
	return _platform ?? 'web';
}

export function resetPlatformCache(): void {
	_platform = undefined;
}
