import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/features/cloud-sync/http-client', () => ({
	syncFetch: vi.fn(),
	withRetry: vi.fn((fn: () => Promise<unknown>) => fn()),
}));

import { S3Backend } from '$lib/features/cloud-sync/s3-backend';
import { syncFetch } from '$lib/features/cloud-sync/http-client';

const mockedFetch = vi.mocked(syncFetch);

const config = {
	endpoint: 'https://account.r2.cloudflarestorage.com',
	region: 'auto',
	bucket: 'hiyori',
	prefix: 'sync',
	accessKeyId: 'AK',
	secretAccessKey: 'SK',
};

function xmlResponse(body: string, status = 200): Response {
	return new Response(body, { status, headers: { 'Content-Type': 'application/xml' } });
}

describe('S3Backend', () => {
	beforeEach(() => vi.clearAllMocks());

	// WHY: path-style key layout with prefix is what makes both R2 and MinIO
	// work without virtual-host DNS requirements.
	it('uploads with path-style URL including prefix and bucket', async () => {
		mockedFetch.mockResolvedValue(new Response(null, { status: 200 }));
		const backend = new S3Backend(config);
		await backend.upload('stories/x.zip', new Uint8Array([1, 2, 3]));

		const request = mockedFetch.mock.calls[0][0] as Request;
		expect(request.method).toBe('PUT');
		expect(request.url).toBe('https://account.r2.cloudflarestorage.com/hiyori/sync/stories/x.zip');
	});

	it('parses ListObjectsV2 XML into SyncEntry list', async () => {
		mockedFetch.mockResolvedValue(
			xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult>
  <Contents><Key>sync/hiyori-manifest.json</Key><Size>120</Size><LastModified>2026-08-14T10:00:00.000Z</LastModified></Contents>
  <Contents><Key>sync/stories/a.zip</Key><Size>999</Size><LastModified>2026-08-15T11:00:00.000Z</LastModified></Contents>
</ListBucketResult>`)
		);
		const backend = new S3Backend(config);
		const entries = await backend.list('');

		expect(entries).toHaveLength(2);
		expect(entries[0]).toEqual({ path: 'hiyori-manifest.json', size: 120, modifiedAt: new Date('2026-08-14T10:00:00.000Z') });
		expect(entries[1].path).toBe('stories/a.zip');
	});

	// WHY: 403 on list is the signature of bad credentials — the error text
	// must steer the user to check keys, not just say "failed".
	it('testConnection translates 403 into a credentials error', async () => {
		mockedFetch.mockResolvedValue(new Response('Forbidden', { status: 403 }));
		const backend = new S3Backend(config);
		await expect(backend.testConnection()).rejects.toThrow(/credential|access key/i);
	});
});
