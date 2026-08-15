import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/features/cloud-sync/http-client', () => ({
	syncFetch: vi.fn(),
	withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { WebDavBackend } from '$lib/features/cloud-sync/webdav-backend';
import { syncFetch } from '$lib/features/cloud-sync/http-client';

const mockedFetch = vi.mocked(syncFetch);
const config = { url: 'https://cloud.example.com/remote.php/dav/files/user/Hiyori', username: 'user', password: 'app-pw' };

// Sample shaped after a real Nextcloud multistatus response.
const multistatus = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/remote.php/dav/files/user/Hiyori/</d:href>
    <d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat>
  </d:response>
  <d:response>
    <d:href>/remote.php/dav/files/user/Hiyori/hiyori-manifest.json</d:href>
    <d:propstat><d:prop>
      <d:resourcetype/>
      <d:getcontentlength>120</d:getcontentlength>
      <d:getlastmodified>Fri, 14 Aug 2026 10:00:00 GMT</d:getlastmodified>
    </d:prop></d:propstat>
  </d:response>
</d:multistatus>`;

describe('WebDavBackend', () => {
	beforeEach(() => vi.clearAllMocks());

	it('sends Basic auth header on every request', async () => {
		mockedFetch.mockResolvedValue(new Response(multistatus, { status: 207 }));
		const backend = new WebDavBackend(config);
		await backend.list('');
		const init = mockedFetch.mock.calls[0][1] as RequestInit;
		expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${btoa('user:app-pw')}`);
	});

	// WHY: the collection entry itself is always present in a PROPFIND Depth:1
	// response; treating it as a file would corrupt the manifest listing.
	it('excludes the collection itself and strips the base path from entries', async () => {
		mockedFetch.mockResolvedValue(new Response(multistatus, { status: 207 }));
		const backend = new WebDavBackend(config);
		const entries = await backend.list('');
		expect(entries).toHaveLength(1);
		expect(entries[0].path).toBe('hiyori-manifest.json');
		expect(entries[0].size).toBe(120);
	});

	it('testConnection translates 401 into a credentials error', async () => {
		mockedFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
		const backend = new WebDavBackend(config);
		await expect(backend.testConnection()).rejects.toThrow(/username|password/i);
	});
});
