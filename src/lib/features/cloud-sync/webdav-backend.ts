import type { SyncBackend, SyncEntry } from './sync-backend';
import { syncFetch, withRetry } from './http-client';

export interface WebDavConfig {
	url: string;
	username: string;
	password: string;
}

const RETRY = { attempts: 3, baseDelayMs: 1000 };

function toBase64(value: string): string {
	// btoa() throws on non-Latin1; credentials may contain unicode.
	const bytes = new TextEncoder().encode(value);
	let binary = '';
	for (const b of bytes) binary += String.fromCharCode(b);
	return btoa(binary);
}

export class WebDavBackend implements SyncBackend {
	private baseUrl: string;
	private authHeader: string;

	constructor(config: WebDavConfig) {
		this.baseUrl = config.url.replace(/\/+$/, '');
		this.authHeader = `Basic ${toBase64(`${config.username}:${config.password}`)}`;
	}

	private pathUrl(path: string): string {
		return path ? `${this.baseUrl}/${path.split('/').map(encodeURIComponent).join('/')}` : this.baseUrl;
	}

	private async request(path: string, init: RequestInit): Promise<Response> {
		const headers = { Authorization: this.authHeader, ...(init.headers as Record<string, string> | undefined) };
		return withRetry(() => syncFetch(this.pathUrl(path), { ...init, headers }), RETRY);
	}

	async testConnection(): Promise<void> {
		const res = await this.request('', { method: 'PROPFIND', headers: { Depth: '0' } });
		if (res.status === 401)
			throw new Error('WebDAV connection failed: unauthorized. Check the username and password (app password).');
		if (res.status === 404) throw new Error('WebDAV connection failed: folder not found. Check the server URL.');
		if (!res.ok && res.status !== 207) throw new Error(`WebDAV connection failed: HTTP ${res.status}`);
	}

	async list(prefix: string): Promise<SyncEntry[]> {
		const res = await this.request(prefix, { method: 'PROPFIND', headers: { Depth: '1' } });
		if (res.status === 404) return [];
		if (!res.ok && res.status !== 207) throw new Error(`WebDAV list failed: HTTP ${res.status}`);

		const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
		const baseHref = decodeURIComponent(new URL(this.pathUrl(prefix)).pathname);
		const entries: SyncEntry[] = [];

		for (const response of xml.getElementsByTagNameNS('DAV:', 'response')) {
			const href = decodeURIComponent(response.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent ?? '');
			const isCollection = response.getElementsByTagNameNS('DAV:', 'collection').length > 0;
			if (isCollection) continue;

			const relative = href.startsWith(baseHref)
				? href.slice(baseHref.length).replace(/^\//, '')
				: href.split('/').pop() ?? '';
			if (!relative) continue;
			const lengthText = response.getElementsByTagNameNS('DAV:', 'getcontentlength')[0]?.textContent;
			const modifiedText = response.getElementsByTagNameNS('DAV:', 'getlastmodified')[0]?.textContent;
			entries.push({
				path: relative,
				size: Number(lengthText ?? 0),
				modifiedAt: modifiedText ? new Date(modifiedText) : undefined,
			});
		}
		return entries;
	}

	private async ensureParentDirs(path: string): Promise<void> {
		const segments = path.split('/').slice(0, -1);
		let current = '';
		for (const segment of segments) {
			current = current ? `${current}/${segment}` : segment;
			const res = await this.request(current, { method: 'MKCOL' });
			if (!res.ok && res.status !== 405) {
				// 405 = already exists; anything else is a real failure.
				throw new Error(`WebDAV MKCOL failed for ${current}: HTTP ${res.status}`);
			}
		}
	}

	async upload(path: string, data: Uint8Array): Promise<void> {
		await this.ensureParentDirs(path);
		// Copy into an ArrayBuffer-backed view: Uint8Array<ArrayBufferLike> is not
		// assignable to BlobPart/BodyInit under the project's TS lib version.
		const res = await this.request(path, { method: 'PUT', body: new Blob([data.slice()]) });
		if (!res.ok) throw new Error(`WebDAV upload failed: HTTP ${res.status}`);
	}

	async download(path: string): Promise<Uint8Array> {
		const res = await this.request(path, { method: 'GET' });
		if (!res.ok) throw new Error(`WebDAV download failed: HTTP ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	async delete(path: string): Promise<void> {
		const res = await this.request(path, { method: 'DELETE' });
		if (!res.ok && res.status !== 404) throw new Error(`WebDAV delete failed: HTTP ${res.status}`);
	}
}
