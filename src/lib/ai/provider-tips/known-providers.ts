import yaml from 'js-yaml';
import rawKnownProviders from './known-providers.yaml?raw';

export interface KnownProvider {
	/** Normalized base URL (trailing slash trimmed). */
	baseUrl: string;
	/** Either '*' (all models verified) or a list of verified model IDs. */
	models: string[] | '*';
}

interface RawKnownProvider {
	baseUrl: string;
	models: string[] | '*';
}

const raw = yaml.load(rawKnownProviders) as { providers: RawKnownProvider[] } | null;

const providers: KnownProvider[] = (() => {
	if (!raw?.providers) return [];
	return raw.providers.map((p) => ({
		baseUrl: normalizeBaseUrl(p.baseUrl),
		models: p.models === '*' ? '*' : Array.isArray(p.models) ? p.models : [],
	}));
})();

function normalizeBaseUrl(url: string): string {
	return url.replace(/\/+$/, '');
}

/**
 * Look up a known provider by base URL. Returns undefined if not in the list.
 * Performs normalization (trailing slash) on the input.
 */
export function findKnownProvider(baseUrl: string): KnownProvider | undefined {
	const normalized = normalizeBaseUrl(baseUrl);
	return providers.find((p) => p.baseUrl === normalized);
}

/**
 * Check whether a base URL is in the known-providers list.
 */
export function isInKnownProviders(baseUrl: string): boolean {
	return findKnownProvider(baseUrl) !== undefined;
}

/**
 * Check whether a model is verified for the given base URL.
 * Returns false if the base URL is not a known provider.
 * Returns true if the provider has models: "*" or the model is in its list.
 */
export function isModelVerifiedForBaseUrl(baseUrl: string, model: string): boolean {
	const provider = findKnownProvider(baseUrl);
	if (!provider) return false;
	if (provider.models === '*') return true;
	return provider.models.includes(model);
}
