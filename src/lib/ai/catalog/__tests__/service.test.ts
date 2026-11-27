import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCache = { match: vi.fn(), put: vi.fn(), delete: vi.fn() };
const mockCaches = { open: vi.fn().mockResolvedValue(mockCache) };
vi.stubGlobal('caches', mockCaches);

const mockFetch = vi.fn();
vi.mock('#lib/http/fetch.ts', () => ({ resolveFetch: () => Promise.resolve(mockFetch) }));

vi.mock('../snapshot.json', () => ({
	default: {
		generatedAt: '2026-01-01T00:00:00Z',
		providers: [
			{
				id: 'bundled',
				name: 'Bundled',
				npm: '@ai-sdk/openai-compatible',
				api: 'https://bundled.test/v1',
				env: [],
				doc: '',
				models: [],
			},
		],
	},
}));

function rawProvider(overrides: Record<string, unknown> = {}) {
	return {
		id: 'openrouter',
		name: 'OpenRouter',
		npm: '@openrouter/ai-sdk-provider',
		api: 'https://openrouter.ai/api/v1',
		env: [],
		doc: '',
		models: {
			'openai/gpt-5': {
				id: 'openai/gpt-5',
				name: 'GPT-5',
				reasoning: true,
				tool_call: true,
				attachment: true,
				release_date: '2025-08-07',
				limit: { context: 400000, output: 128000 },
			},
		},
		...overrides,
	};
}

function jsonResponse(body: unknown, etag = '"abc"') {
	return new Response(JSON.stringify(body), { status: 200, headers: { etag, 'content-type': 'application/json' } });
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	mockCache.match.mockResolvedValue(undefined);
	mockCache.put.mockResolvedValue(undefined);
	mockCache.delete.mockResolvedValue(true);
	mockCaches.open.mockResolvedValue(mockCache);
});

describe('getCatalog', () => {
	it('fetches live on empty cache (200)', async () => {
		const { getCatalog } = await import('../service');
		mockFetch.mockResolvedValue(jsonResponse({ openrouter: rawProvider() }));
		const result = await getCatalog();
		expect(result.source).toBe('live');
		expect(result.providers.length).toBe(1);
		expect(result.providers[0].models[0].context).toBe(400000);
		expect(mockCache.put).toHaveBeenCalled();
	});

	it('returns cached on 304', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(new Response(JSON.stringify({ openrouter: rawProvider() }), { headers: { etag: '"abc"' } }));
		mockFetch.mockResolvedValue(new Response(null, { status: 304 }));
		const result = await getCatalog();
		expect(result.source).toBe('cache');
		expect(result.providers.length).toBe(1);
		expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('models.dev'), {
			headers: { 'If-None-Match': '"abc"' },
		});
	});

	it('falls back to cached on network error', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(new Response(JSON.stringify({ openrouter: rawProvider() }), { headers: { etag: '"abc"' } }));
		mockFetch.mockRejectedValue(new Error('network'));
		const result = await getCatalog();
		expect(result.source).toBe('cache');
		expect(result.providers.length).toBe(1);
	});

	it('falls back to bundled when cache empty + network error', async () => {
		const { getCatalog } = await import('../service');
		mockFetch.mockRejectedValue(new Error('network'));
		const result = await getCatalog();
		expect(result.source).toBe('bundled');
		expect(result.providers[0].id).toBe('bundled');
	});

	it('applies provider-level and model-level eligibility to live data', async () => {
		const { getCatalog } = await import('../service');
		mockFetch.mockResolvedValue(
			jsonResponse({
				anthropic: rawProvider({ id: 'anthropic', name: 'Anthropic', npm: '@ai-sdk/anthropic' }),
				openrouter: rawProvider({
					models: {
						chat: {
							id: 'chat',
							name: 'Chat',
							reasoning: false,
							tool_call: true,
							attachment: false,
							release_date: '',
							limit: { context: 1 },
						},
						embedding: {
							id: 'embedding',
							name: 'Embedding',
							type: 'embedding',
							reasoning: false,
							tool_call: false,
							attachment: false,
							release_date: '',
							limit: { context: 1 },
						},
					},
				}),
			})
		);
		const result = await getCatalog();
		expect(result.providers.map((p) => p.id)).toEqual(['openrouter']);
		expect(result.providers[0].models.map((m) => m.id)).toEqual(['chat']);
	});
});

describe('poisoned cache resilience', () => {
	it('degrades to bundled when the cached entry is not valid api.json', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(new Response('not json'));
		mockFetch.mockRejectedValue(new Error('network'));
		const result = await getCatalog();
		expect(result.source).toBe('bundled');
		expect(result.providers[0].id).toBe('bundled');
		expect(mockCache.delete).toHaveBeenCalled();
	});

	it('does not cache a live 200 that is not valid api.json', async () => {
		const { getCatalog } = await import('../service');
		mockFetch.mockResolvedValue(new Response('not json', { status: 200 }));
		const result = await getCatalog();
		expect(result.source).toBe('bundled');
		expect(mockCache.put).not.toHaveBeenCalled();
	});
});

describe('catalog provenance', () => {
	it('stamps the cached response with the fetch time and keeps the original headers', async () => {
		const { getCatalog } = await import('../service');
		const before = Date.now();
		mockFetch.mockResolvedValue(jsonResponse({ openrouter: rawProvider() }));
		await getCatalog();
		const stored = mockCache.put.mock.calls[0][1] as Response;
		expect(stored.headers.get('etag')).toBe('"abc"');
		const stampedAt = new Date(stored.headers.get('x-catalog-fetched-at')!).getTime();
		expect(stampedAt).toBeGreaterThanOrEqual(before);
		expect(stampedAt).toBeLessThanOrEqual(Date.now());
	});

	it('reports the stamped fetch time for cached data, not the read time', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(
			new Response(JSON.stringify({ openrouter: rawProvider() }), {
				headers: { etag: '"abc"', 'x-catalog-fetched-at': '2026-01-02T03:04:05.000Z' },
			})
		);
		mockFetch.mockRejectedValue(new Error('network'));
		const result = await getCatalog();
		expect(result.source).toBe('cache');
		expect(result.generatedAt).toBe('2026-01-02T03:04:05.000Z');
	});

	it('keeps the original fetch date across a 304 revalidation', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(
			new Response(JSON.stringify({ openrouter: rawProvider() }), {
				headers: { etag: '"abc"', 'x-catalog-fetched-at': '2026-01-02T03:04:05.000Z' },
			})
		);
		mockFetch.mockResolvedValue(new Response(null, { status: 304 }));
		const result = await getCatalog();
		expect(result.source).toBe('cache');
		expect(result.generatedAt).toBe('2026-01-02T03:04:05.000Z');
	});

	it('falls back to the cached Date header for entries stored before the fetch stamp existed', async () => {
		const { getCatalog } = await import('../service');
		mockCache.match.mockResolvedValue(
			new Response(JSON.stringify({ openrouter: rawProvider() }), {
				headers: { etag: '"abc"', date: 'Fri, 02 Jan 2026 03:04:05 GMT' },
			})
		);
		mockFetch.mockRejectedValue(new Error('network'));
		const result = await getCatalog();
		expect(result.source).toBe('cache');
		expect(result.generatedAt).toBe('Fri, 02 Jan 2026 03:04:05 GMT');
	});
});

describe('memoization', () => {
	it('does not refetch on a second getCatalog()', async () => {
		const { getCatalog } = await import('../service');
		mockFetch.mockResolvedValue(jsonResponse({ openrouter: rawProvider() }));
		await getCatalog();
		const second = await getCatalog();
		expect(second.source).toBe('live');
		expect(mockFetch).toHaveBeenCalledTimes(1);
	});

	it('refetches on refreshCatalog() after a memoized getCatalog()', async () => {
		const { getCatalog, refreshCatalog } = await import('../service');
		mockFetch.mockResolvedValue(jsonResponse({ openrouter: rawProvider() }));
		await getCatalog();
		await refreshCatalog();
		expect(mockFetch).toHaveBeenCalledTimes(2);
	});
});
