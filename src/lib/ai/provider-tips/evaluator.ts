import yaml from 'js-yaml';
import type { ApiType, Provider } from '$lib/stores/settings.svelte';
import type { Platform } from '$lib/runtime';
import rawRules from './rules.yaml?raw';
import { matchWhen, type FieldCondition, type WhenBlock } from './predicates';

export type { FieldCondition, WhenBlock } from './predicates';
export type { KnownProvider } from './known-providers';

export type TipKind = 'warning' | 'note' | 'verified';

export type ProviderTipSuggestion =
	| { type: 'rewriteBaseUrl'; value: string }
	| { type: 'rewriteBaseUrlStripSuffix'; value: string[] }
	| { type: 'rewriteBaseUrlScheme'; value: 'https' }
	| {
			type: 'switchProvider';
			value: Provider;
			rewriteBaseUrl?: string;
	  };

export interface ProviderConfigTip {
	id: string;
	kind: TipKind;
	messageKey: string;
	messageParams?: Record<string, string | number>;
	suggest?: ProviderTipSuggestion;
}

export interface TipEvaluationInput {
	provider: Provider;
	baseURL: string;
	model: string;
	apiType?: ApiType;
	corsBypassEnabled: boolean;
	wispProxyUrl?: string;
	pageProtocol?: 'http' | 'https';
	platform: Platform;
	apiKey?: string;
}

interface RawRule {
	id: string;
	platform: string;
	kind: TipKind;
	priority: number;
	when: WhenBlock & {
		provider?: FieldCondition;
		baseURL?: FieldCondition;
		model?: FieldCondition;
		corsBypassEnabled?: { equals?: boolean };
		pageProtocol?: { equals?: 'http' | 'https' };
	};
	messageKey: string;
	suggest?: {
		rewriteBaseUrl?: string;
		rewriteBaseUrlStripSuffix?: string[];
		rewriteBaseUrlScheme?: 'https';
		switchProvider?: Provider;
	};
}

interface RawRulesFile {
	rules: RawRule[];
}

const parsed = yaml.load(rawRules) as RawRulesFile | null;

function buildSuggestion(raw: NonNullable<RawRule['suggest']>): ProviderTipSuggestion | undefined {
	if (raw.switchProvider !== undefined) {
		return {
			type: 'switchProvider',
			value: raw.switchProvider,
			rewriteBaseUrl: raw.rewriteBaseUrl,
		};
	}
	if (raw.rewriteBaseUrlScheme !== undefined) {
		return { type: 'rewriteBaseUrlScheme', value: raw.rewriteBaseUrlScheme };
	}
	if (raw.rewriteBaseUrlStripSuffix !== undefined) {
		return {
			type: 'rewriteBaseUrlStripSuffix',
			value: raw.rewriteBaseUrlStripSuffix,
		};
	}
	if (raw.rewriteBaseUrl !== undefined) {
		return { type: 'rewriteBaseUrl', value: raw.rewriteBaseUrl };
	}
	return undefined;
}

interface CompiledRule {
	id: string;
	platform: RawRule['platform'];
	kind: TipKind;
	priority: number;
	when: WhenBlock;
	messageKey: string;
	suggest?: ProviderTipSuggestion;
	declareOrder: number;
}

/**
 * Normalize raw `when` blocks: YAML allows `provider: openai` as shorthand for
 * `provider: { equals: openai }`. Bare strings/booleans must be wrapped because
 * `matchField` expects a FieldCondition object — accessing `.startsWith` on a
 * string primitive returns `String.prototype.startsWith` (a function), which
 * would incorrectly trigger condition checks. Likewise, `corsBypassEnabled: false`
 * is parsed as boolean `false` (falsy), short-circuiting the guard in `matchWhen`.
 */
function normalizeField(raw: unknown): FieldCondition | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === 'string') return { equals: raw };
	return raw as FieldCondition;
}

function normalizeEqualsCond<T extends string | boolean>(raw: unknown): { equals?: T } | undefined {
	if (raw === undefined || raw === null) return undefined;
	if (typeof raw === 'string' || typeof raw === 'boolean') return { equals: raw as T };
	return raw as { equals?: T };
}

function normalizeWhen(raw: RawRule['when']): WhenBlock {
	return {
		provider: normalizeField(raw.provider),
		baseURL: normalizeField(raw.baseURL),
		model: normalizeField(raw.model),
		corsBypassEnabled: normalizeEqualsCond<boolean>(raw.corsBypassEnabled),
		pageProtocol: normalizeEqualsCond<'http' | 'https'>(raw.pageProtocol),
	};
}

const rules: CompiledRule[] = (() => {
	if (!parsed?.rules) return [];
	return parsed.rules.map((r, idx) => ({
		id: r.id,
		platform: r.platform,
		kind: r.kind,
		priority: r.priority,
		when: normalizeWhen(r.when),
		messageKey: r.messageKey,
		suggest: r.suggest ? buildSuggestion(r.suggest) : undefined,
		declareOrder: idx,
	}));
})();

function platformMatches(rulePlatform: string, inputPlatform: Platform): boolean {
	if (rulePlatform === 'all') return true;
	if (rulePlatform === 'desktop-android') {
		return inputPlatform === 'desktop' || inputPlatform === 'android';
	}
	return rulePlatform === inputPlatform;
}

function buildMessageParams(input: TipEvaluationInput): Record<string, string | number> {
	const params: Record<string, string | number> = {};
	if (input.baseURL) params.baseUrl = input.baseURL;
	if (input.model) params.model = input.model;
	try {
		const url = new URL(input.baseURL);
		params.host = url.host;
	} catch {
		// ignore — invalid URL
	}
	return params;
}

/**
 * Evaluate all rules against the input snapshot and return the single winning
 * tip (lowest priority number; ties broken by declaration order in YAML).
 * Returns null if no rule matches.
 */
export function evaluateProviderTip(input: TipEvaluationInput): ProviderConfigTip | null {
	const candidates = rules.filter((r) => platformMatches(r.platform, input.platform) && matchWhen(r.when, input));

	if (candidates.length === 0) return null;

	let winner = candidates[0]!;
	for (const c of candidates.slice(1)) {
		if (c.priority < winner.priority || (c.priority === winner.priority && c.declareOrder < winner.declareOrder)) {
			winner = c;
		}
	}

	return {
		id: winner.id,
		kind: winner.kind,
		messageKey: winner.messageKey,
		messageParams: buildMessageParams(input),
		suggest: winner.suggest,
	};
}

/**
 * Expand {{baseUrl}} placeholders in a suggestion value against the input.
 */
export function expandSuggestionTemplate(template: string, input: TipEvaluationInput): string {
	return template.replace(/\{\{\s*baseUrl\s*\}\}/g, input.baseURL);
}

/**
 * Strip the single longest matching suffix from baseUrl.
 * Used by A2b's rewriteBaseUrlStripSuffix suggestion.
 */
export function applyStripSuffix(baseUrl: string, suffixes: string[]): string {
	let longest: string | undefined;
	for (const s of suffixes) {
		if (baseUrl.endsWith(s) && (longest === undefined || s.length > longest.length)) {
			longest = s;
		}
	}
	return longest ? baseUrl.slice(0, -longest.length) : baseUrl;
}
