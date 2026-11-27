import { resolveFetch } from '#lib/http/fetch.ts';
import { log } from '#lib/logging/logger.ts';
import { isEligibleModel, isEligibleProvider } from './eligibility';
import type { CatalogResult, EligibleModel, EligibleProvider } from './types';

const CACHE_NAME = 'models-dev-catalog';
const CATALOG_URL = 'https://models.dev/api.json';
const LOG_TAG = 'catalog';

let inMemoryCache: CatalogResult | null = null;

function filterProviders(raw: Record<string, unknown>): EligibleProvider[] {
	const result: EligibleProvider[] = [];
	for (const p of Object.values(raw) as Array<Record<string, unknown>>) {
		if (!isEligibleProvider(p as never)) continue;
		const models: EligibleModel[] = [];
		const rawModels = (p.models ?? {}) as Record<string, Record<string, unknown>>;
		for (const m of Object.values(rawModels)) {
			if (!isEligibleModel(p as never, m as never)) continue;
			models.push({
				id: m.id as string,
				name: m.name as string,
				reasoning: m.reasoning as boolean,
				tool_call: m.tool_call as boolean,
				attachment: m.attachment as boolean,
				...(m.status ? { status: m.status as EligibleModel['status'] } : {}),
				release_date: m.release_date as string,
				context: (m.limit as Record<string, number>)?.context ?? 0,
				...(m.reasoning_options ? { reasoning_options: m.reasoning_options as never } : {}),
				...(m.temperature !== undefined ? { temperature: m.temperature as boolean } : {}),
				...(m.provider ? { provider: m.provider as never } : {}),
			});
		}
		if (models.length === 0) continue;
		models.sort((a, b) => a.name.localeCompare(b.name));
		result.push({
			id: p.id as string,
			name: p.name as string,
			npm: p.npm as string,
			api: p.api as string | undefined,
			env: (p.env ?? []) as string[],
			doc: (p.doc ?? '') as string,
			models,
		});
	}
	result.sort((a, b) => a.name.localeCompare(b.name));
	return result;
}

async function parseResponse(response: Response, source: CatalogResult['source']): Promise<CatalogResult> {
	const body = (await response.clone().json()) as Record<string, unknown>;
	const generatedAt =
		(body.generatedAt as string) ??
		response.headers.get('x-catalog-fetched-at') ??
		response.headers.get('date') ??
		new Date().toISOString();
	return { providers: filterProviders(body), generatedAt, source };
}

async function loadBundled(): Promise<CatalogResult> {
	const snapshot = await import('./snapshot.json');
	const data = snapshot.default ?? snapshot;
	return {
		providers: data.providers as EligibleProvider[],
		generatedAt: data.generatedAt,
		source: 'bundled',
	};
}

async function parseValidated(response: Response, source: CatalogResult['source']): Promise<CatalogResult | undefined> {
	try {
		return await parseResponse(response, source);
	} catch (err) {
		void log.warn(LOG_TAG, `Discarding unparseable ${source} response: ${errorMessage(err)}`);
		return undefined;
	}
}

async function storeCachedResponse(cache: Cache | undefined, response: Response): Promise<void> {
	if (!cache) return;
	try {
		// api.json carries no generatedAt; stamp the fetch time so cache/304 reads report the data's real age.
		const headers = new Headers(response.headers);
		headers.set('x-catalog-fetched-at', new Date().toISOString());
		await cache.put(
			CATALOG_URL,
			new Response(response.clone().body, { status: response.status, statusText: response.statusText, headers })
		);
	} catch (err) {
		void log.warn(LOG_TAG, `Failed to cache live response: ${errorMessage(err)}`);
	}
}

async function deleteCachedResponse(cache: Cache | undefined): Promise<void> {
	if (!cache) return;
	try {
		await cache.delete(CATALOG_URL);
	} catch (err) {
		void log.warn(LOG_TAG, `Failed to delete unparseable cache entry: ${errorMessage(err)}`);
	}
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

async function fetchCatalog(): Promise<CatalogResult> {
	let cache: Cache | undefined;
	let cached: Response | undefined;
	try {
		cache = await caches.open(CACHE_NAME);
		cached = await cache.match(CATALOG_URL);
	} catch {
		/* Cache API unavailable */
	}

	try {
		const f = await resolveFetch();
		const headers: Record<string, string> = {};
		const etag = cached?.headers.get('etag');
		if (etag) headers['If-None-Match'] = etag;
		const response = await f(CATALOG_URL, { headers });

		if (response.status === 304 && cached) {
			const fromCache = await parseValidated(cached, 'cache');
			if (fromCache) return fromCache;
			await deleteCachedResponse(cache);
			return loadBundled();
		}

		if (response.ok) {
			// Parse before caching: a 200 that is not api.json (proxy page,
			// captive portal, schema drift) must never poison the cache.
			const fromLive = await parseValidated(response, 'live');
			if (fromLive) {
				await storeCachedResponse(cache, response);
				return fromLive;
			}
		}
	} catch {
		/* network error */
	}

	if (cached) {
		const fromCache = await parseValidated(cached, 'cache');
		if (fromCache) return fromCache;
		await deleteCachedResponse(cache);
	}
	return loadBundled();
}

export async function getCatalog(): Promise<CatalogResult> {
	if (inMemoryCache) return inMemoryCache;
	inMemoryCache = await fetchCatalog();
	return inMemoryCache;
}

export async function refreshCatalog(): Promise<CatalogResult> {
	inMemoryCache = await fetchCatalog();
	return inMemoryCache;
}
