import { AwsClient } from 'aws4fetch';
import type { SyncBackend, SyncEntry } from './sync-backend';
import { syncFetch, withRetry } from './http-client';

export interface S3Config {
	endpoint: string;
	region: string;
	bucket: string;
	prefix?: string;
	accessKeyId: string;
	secretAccessKey: string;
}

const RETRY = { attempts: 3, baseDelayMs: 1000 };

export class S3Backend implements SyncBackend {
	private aws: AwsClient;

	constructor(private config: S3Config) {
		this.aws = new AwsClient({
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
			region: config.region || 'auto',
			service: 's3',
		});
	}

	private key(path: string): string {
		const prefix = this.config.prefix?.replace(/\/+$/, '');
		return prefix ? `${prefix}/${path}` : path;
	}

	private url(path: string, query?: string): string {
		const base = this.config.endpoint.replace(/\/+$/, '');
		const encodedKey = this.key(path)
			.split('/')
			.map(encodeURIComponent)
			.join('/');
		return `${base}/${this.config.bucket}/${encodedKey}${query ? `?${query}` : ''}`;
	}

	private async signedFetch(path: string, init: RequestInit, query?: string): Promise<Response> {
		const request = new Request(this.url(path, query), init);
		const signed = await this.aws.sign(request);
		return withRetry(() => syncFetch(signed), RETRY);
	}

	async testConnection(): Promise<void> {
		const res = await this.signedFetch('', { method: 'GET' }, 'list-type=2&max-keys=1');
		if (res.status === 403)
			throw new Error('S3 connection failed: access denied. Check the access key ID and secret.');
		if (res.status === 404)
			throw new Error('S3 connection failed: bucket not found. Check the endpoint and bucket name.');
		if (!res.ok) throw new Error(`S3 connection failed: HTTP ${res.status}`);
	}

	async list(prefix: string): Promise<SyncEntry[]> {
		const query = `list-type=2&prefix=${encodeURIComponent(this.key(prefix))}`;
		const res = await this.signedFetch('', { method: 'GET' }, query);
		if (!res.ok) throw new Error(`S3 list failed: HTTP ${res.status}`);

		const xml = new DOMParser().parseFromString(await res.text(), 'application/xml');
		const keyPrefix = this.key('');
		return [...xml.getElementsByTagName('Contents')].map((node) => {
			const fullKey = node.getElementsByTagName('Key')[0]?.textContent ?? '';
			return {
				// key('') yields 'prefix/' (with trailing slash), so a plain slice
				// strips exactly the config prefix from the full S3 key.
				path: keyPrefix ? fullKey.slice(keyPrefix.length) : fullKey,
				size: Number(node.getElementsByTagName('Size')[0]?.textContent ?? 0),
				modifiedAt: new Date(node.getElementsByTagName('LastModified')[0]?.textContent ?? 0),
			};
		});
	}

	async upload(path: string, data: Uint8Array): Promise<void> {
		// Copy into an ArrayBuffer-backed view: Uint8Array<ArrayBufferLike> is not
		// assignable to BlobPart/BodyInit under the project's TS lib version.
		const res = await this.signedFetch(path, { method: 'PUT', body: new Blob([data.slice()]) });
		if (!res.ok) throw new Error(`S3 upload failed: HTTP ${res.status}`);
	}

	async download(path: string): Promise<Uint8Array> {
		const res = await this.signedFetch(path, { method: 'GET' });
		if (!res.ok) throw new Error(`S3 download failed: HTTP ${res.status}`);
		return new Uint8Array(await res.arrayBuffer());
	}

	async delete(path: string): Promise<void> {
		const res = await this.signedFetch(path, { method: 'DELETE' });
		if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: HTTP ${res.status}`);
	}
}
