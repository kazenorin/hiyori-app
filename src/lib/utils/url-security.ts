/** Local/LAN host detection for informational URL warnings. */
export function isLocalOrLanHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (host === 'localhost' || host === '::1' || host === '127.0.0.1' || host.endsWith('.localhost') || host.endsWith('.local')) {
		return true;
	}
	const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4) {
		const [a, b] = ipv4.slice(1).map(Number);
		return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
	}
	return false;
}

export interface UrlWarnings {
	/** Web app mode requires the server to send CORS headers for the app origin. */
	cors: boolean;
	/** Plain HTTP to a host outside the local network transmits credentials unencrypted. */
	insecure: boolean;
}

export function getUrlWarnings(url: string, isWebApp: boolean): UrlWarnings {
	const trimmed = url.trim();
	const warnings: UrlWarnings = { cors: trimmed !== '' && isWebApp, insecure: false };
	if (!trimmed) return warnings;
	try {
		const parsed = new URL(trimmed);
		warnings.insecure = parsed.protocol === 'http:' && !isLocalOrLanHost(parsed.hostname);
	} catch {
		// Unparseable input: no warnings until it looks like a URL.
	}
	return warnings;
}
