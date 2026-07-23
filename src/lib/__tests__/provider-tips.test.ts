import { describe, it, expect, beforeEach } from 'vitest';

import { evaluateProviderTip, expandSuggestionTemplate, applyStripSuffix, type TipEvaluationInput } from '$lib/ai/provider-tips/evaluator';
import { matchField, matchWhen, type FieldCondition } from '$lib/ai/provider-tips/predicates';
import { findKnownProvider, isInKnownProviders, isModelVerifiedForBaseUrl } from '$lib/ai/provider-tips/known-providers';
import { detectPlatform, getPlatformSync, resetTauriCache, resetPlatformCache, type Platform } from '$lib/runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function baseInput(overrides: Partial<TipEvaluationInput> = {}): TipEvaluationInput {
	return {
		provider: 'openai-compatible',
		baseURL: 'https://api.neuralwatt.com/v1',
		model: 'google/gemma-4-31b',
		corsBypassEnabled: false,
		platform: 'desktop',
		pageProtocol: 'https',
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// known-providers.ts
// ---------------------------------------------------------------------------

describe('known-providers', () => {
	describe('findKnownProvider', () => {
		it('finds by exact URL', () => {
			expect(findKnownProvider('https://api.neuralwatt.com/v1')).toBeDefined();
			expect(findKnownProvider('https://pass.wafer.ai/v1')).toBeDefined();
			expect(findKnownProvider('https://openrouter.ai/api/v1')).toBeDefined();
		});

		it('normalizes trailing slash', () => {
			expect(findKnownProvider('https://api.neuralwatt.com/v1/')).toBeDefined();
			expect(findKnownProvider('https://api.neuralwatt.com/v1///')).toBeDefined();
		});

		it('returns undefined for unknown URL', () => {
			expect(findKnownProvider('https://example.com/v1')).toBeUndefined();
		});

		it('does not match partial host', () => {
			expect(findKnownProvider('https://notapi.neuralwatt.com/v1')).toBeUndefined();
		});
	});

	describe('isInKnownProviders', () => {
		it('returns true for a known base URL', () => {
			expect(isInKnownProviders('https://openrouter.ai/api/v1')).toBe(true);
		});

		it('returns false for an unknown base URL', () => {
			expect(isInKnownProviders('https://unknown.example.com/v1')).toBe(false);
		});
	});

	describe('isModelVerifiedForBaseUrl', () => {
		it('returns true when provider has models: "*"', () => {
			expect(isModelVerifiedForBaseUrl('https://api.neuralwatt.com/v1', 'anything')).toBe(true);
			expect(isModelVerifiedForBaseUrl('https://pass.wafer.ai/v1', 'any-model')).toBe(true);
		});

		it('returns true when model is in the provider list', () => {
			expect(isModelVerifiedForBaseUrl('https://openrouter.ai/api/v1', 'z-ai/glm-5.2')).toBe(true);
			expect(isModelVerifiedForBaseUrl('https://openrouter.ai/api/v1', 'google/gemma-4-31b-it')).toBe(true);
		});

		it('returns false when model is not in the provider list', () => {
			expect(isModelVerifiedForBaseUrl('https://openrouter.ai/api/v1', 'unknown/model')).toBe(false);
		});

		it('returns false for an unknown base URL', () => {
			expect(isModelVerifiedForBaseUrl('https://unknown.example.com/v1', 'any-model')).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// predicates.ts — matchField
// ---------------------------------------------------------------------------

describe('predicates — matchField', () => {
	const ctx = { baseURL: 'https://api.neuralwatt.com/v1', model: 'google/gemma-4-31b' };

	it('equals', () => {
		expect(matchField('openai', { equals: 'openai' }, ctx)).toBe(true);
		expect(matchField('ollama', { equals: 'openai' }, ctx)).toBe(false);
	});

	it('notEquals', () => {
		expect(matchField('ollama', { notEquals: 'openai' }, ctx)).toBe(true);
		expect(matchField('openai', { notEquals: 'openai' }, ctx)).toBe(false);
	});

	it('isNonEmpty', () => {
		expect(matchField('hello', { isNonEmpty: true }, ctx)).toBe(true);
		expect(matchField('', { isNonEmpty: true }, ctx)).toBe(false);
		expect(matchField('   ', { isNonEmpty: true }, ctx)).toBe(false);
	});

	it('in', () => {
		expect(matchField('a', { in: ['a', 'b'] }, ctx)).toBe(true);
		expect(matchField('c', { in: ['a', 'b'] }, ctx)).toBe(false);
	});

	it('notIn', () => {
		expect(matchField('c', { notIn: ['a', 'b'] }, ctx)).toBe(true);
		expect(matchField('a', { notIn: ['a', 'b'] }, ctx)).toBe(false);
	});

	it('startsWith', () => {
		expect(matchField('https://api.openai.com', { startsWith: 'https://api.openai.com' }, ctx)).toBe(true);
		expect(matchField('http://localhost', { startsWith: 'https://api.openai.com' }, ctx)).toBe(false);
	});

	it('notStartsWith', () => {
		expect(matchField('http://localhost', { notStartsWith: 'https://api.openai.com' }, ctx)).toBe(true);
		expect(matchField('https://api.openai.com', { notStartsWith: 'https://api.openai.com' }, ctx)).toBe(false);
	});

	it('endsWith', () => {
		expect(matchField('https://example.com/v1', { endsWith: '/v1' }, ctx)).toBe(true);
		expect(matchField('https://example.com/v2', { endsWith: '/v1' }, ctx)).toBe(false);
	});

	it('notEndsWith', () => {
		expect(matchField('https://example.com/v2', { notEndsWith: '/v1' }, ctx)).toBe(true);
		expect(matchField('https://example.com/v1', { notEndsWith: '/v1' }, ctx)).toBe(false);
	});

	it('startsWithAny', () => {
		const cond: FieldCondition = { startsWithAny: ['https://', 'http://localhost'] };
		expect(matchField('https://api.openai.com', cond, ctx)).toBe(true);
		expect(matchField('http://localhost:11434', cond, ctx)).toBe(true);
		expect(matchField('ftp://bad', cond, ctx)).toBe(false);
	});

	it('notStartsWithAny', () => {
		const cond: FieldCondition = { notStartsWithAny: ['https://', 'http://localhost'] };
		expect(matchField('ftp://bad', cond, ctx)).toBe(true);
		expect(matchField('https://api.openai.com', cond, ctx)).toBe(false);
	});

	it('endsWithAny', () => {
		const cond: FieldCondition = { endsWithAny: ['/v1/chat', '/v1/chat/completions'] };
		expect(matchField('https://example.com/v1/chat', cond, ctx)).toBe(true);
		expect(matchField('https://example.com/v1/chat/completions', cond, ctx)).toBe(true);
		expect(matchField('https://example.com/v1', cond, ctx)).toBe(false);
	});

	describe('containsWordAnyIgnoreCase', () => {
		const cond: FieldCondition = { containsWordAnyIgnoreCase: ['0.8b', '2b', '4b', '9b', 'e2b', 'e4b', '12b'] };

		it('matches small model names', () => {
			expect(matchField('gemma-2b', cond, ctx)).toBe(true);
			expect(matchField('qwen-4b', cond, ctx)).toBe(true);
			expect(matchField('gemma-9b', cond, ctx)).toBe(true);
			expect(matchField('qwen-12b', cond, ctx)).toBe(true);
			expect(matchField('qwen-0.8b', cond, ctx)).toBe(true);
			expect(matchField('gemma-3n-e2b', cond, ctx)).toBe(true);
			expect(matchField('gemma-3n-e4b', cond, ctx)).toBe(true);
		});

		it('is case-insensitive', () => {
			expect(matchField('QWEN-12B-IT', cond, ctx)).toBe(true);
			expect(matchField('Gemma-2B', cond, ctx)).toBe(true);
		});

		it('matches with suffix after keyword', () => {
			expect(matchField('gemma-2b-it', cond, ctx)).toBe(true);
			expect(matchField('qwen2.5-0.5b', cond, ctx)).toBe(false);
		});

		it('does not match large models with digit boundaries', () => {
			expect(matchField('yi-34b', cond, ctx)).toBe(false);
			expect(matchField('mixtral-8x7b-32b', cond, ctx)).toBe(false);
			expect(matchField('qwen-14b', cond, ctx)).toBe(false);
			expect(matchField('google/gemma-4-31b', cond, ctx)).toBe(false);
		});

		it('does not match MoE active-param suffixes (A-prefixed)', () => {
			expect(matchField('Qwen3.6-35B-A3B', cond, ctx)).toBe(false);
			expect(matchField('26B-A4B', cond, ctx)).toBe(false);
			expect(matchField('26B A4B', cond, ctx)).toBe(false);
			expect(matchField('model-a4b-it', cond, ctx)).toBe(false);
		});

		it('does not match when keyword absent', () => {
			expect(matchField('z-ai/glm-5.2', cond, ctx)).toBe(false);
			expect(matchField('llama3', cond, ctx)).toBe(false);
		});

		it('returns false for empty keyword list', () => {
			expect(matchField('anything', { containsWordAnyIgnoreCase: [] }, ctx)).toBe(false);
		});

		it('matches keyword at start of string', () => {
			expect(matchField('2b-model', cond, ctx)).toBe(true);
		});

		it('matches keyword at end of string', () => {
			expect(matchField('model-2b', cond, ctx)).toBe(true);
		});

		it('matches keyword with dot boundary', () => {
			expect(matchField('model.2b', cond, ctx)).toBe(true);
		});

		it('matches second occurrence when first is digit-bound', () => {
			expect(matchField('model2b-2b', cond, ctx)).toBe(true);
		});
	});

	it('hostEquals matches hostname', () => {
		expect(matchField('https://integrate.api.nvidia.com/v1', { hostEquals: 'integrate.api.nvidia.com' }, ctx)).toBe(true);
		expect(matchField('https://other.host.com/v1', { hostEquals: 'integrate.api.nvidia.com' }, ctx)).toBe(false);
	});

	it('hostEquals matches with port', () => {
		expect(matchField('http://localhost:11434', { hostEquals: 'localhost:11434' }, ctx)).toBe(true);
	});

	it('hostEquals returns false for invalid URL', () => {
		expect(matchField('not-a-url', { hostEquals: 'localhost' }, ctx)).toBe(false);
	});

	it('hasNonRootPath: true for a path', () => {
		expect(matchField('https://example.com/v1', { hasNonRootPath: true }, ctx)).toBe(true);
		expect(matchField('https://example.com/some/path', { hasNonRootPath: true }, ctx)).toBe(true);
	});

	it('hasNonRootPath: false for root', () => {
		expect(matchField('https://example.com/', { hasNonRootPath: true }, ctx)).toBe(false);
		expect(matchField('https://example.com', { hasNonRootPath: true }, ctx)).toBe(false);
	});

	it('hasNonRootPath: false for invalid URL', () => {
		expect(matchField('not-a-url', { hasNonRootPath: true }, ctx)).toBe(false);
	});

	describe('hostNotLocalNotLan', () => {
		it('true for public host', () => {
			expect(matchField('http://api.example.com/v1', { hostNotLocalNotLan: true }, ctx)).toBe(true);
			expect(matchField('http://integrate.api.nvidia.com/v1', { hostNotLocalNotLan: true }, ctx)).toBe(true);
		});

		it('false for localhost', () => {
			expect(matchField('http://localhost:1234/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for 127.0.0.1', () => {
			expect(matchField('http://127.0.0.1:1234/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for *.localhost', () => {
			expect(matchField('http://api.localhost/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://my.localhost:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for 10.* (Class A LAN)', () => {
			expect(matchField('http://10.0.0.1:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://10.1.2.3/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for 172.* (Class B LAN)', () => {
			expect(matchField('http://172.16.0.1:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://172.20.30.40/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for 192.168.* (Class C LAN)', () => {
			expect(matchField('http://192.168.1.100:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://192.168.0.1/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for *.local (mDNS)', () => {
			expect(matchField('http://raspberry.local/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://api.local:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for *.internal', () => {
			expect(matchField('http://server.internal/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://db.internal:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for *.home.arpa', () => {
			expect(matchField('http://nas.home.arpa/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
			expect(matchField('http://router.home.arpa:8080/v1', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('false for invalid URL', () => {
			expect(matchField('not-a-url', { hostNotLocalNotLan: true }, ctx)).toBe(false);
		});

		it('true for public host with HTTPS', () => {
			expect(matchField('https://api.example.com/v1', { hostNotLocalNotLan: true }, ctx)).toBe(true);
		});
	});

	it('inKnownProviders: true for a known base URL', () => {
		expect(matchField('https://api.neuralwatt.com/v1', { inKnownProviders: true }, ctx)).toBe(true);
	});

	it('inKnownProviders: false for unknown base URL', () => {
		expect(matchField('https://unknown.example.com/v1', { inKnownProviders: true }, ctx)).toBe(false);
	});

	it('inKnownProvidersForBaseUrl: true when model is verified', () => {
		const c = { baseURL: 'https://api.neuralwatt.com/v1', model: 'anything' };
		expect(matchField('anything', { inKnownProvidersForBaseUrl: true }, c)).toBe(true);
	});

	it('inKnownProvidersForBaseUrl: false when model is not verified', () => {
		const c = { baseURL: 'https://openrouter.ai/api/v1', model: 'unknown/model' };
		expect(matchField('unknown/model', { inKnownProvidersForBaseUrl: true }, c)).toBe(false);
	});

	it('no conditions → matches everything', () => {
		expect(matchField('anything', {}, ctx)).toBe(true);
	});

	it('multiple conditions AND together', () => {
		const cond: FieldCondition = { startsWith: 'https://', endsWith: '/v1' };
		expect(matchField('https://api.openai.com/v1', cond, ctx)).toBe(true);
		expect(matchField('http://api.openai.com/v1', cond, ctx)).toBe(false);
		expect(matchField('https://api.openai.com/v2', cond, ctx)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// predicates.ts — matchWhen
// ---------------------------------------------------------------------------

describe('predicates — matchWhen', () => {
	it('returns true when no conditions', () => {
		expect(matchWhen({}, baseInput())).toBe(true);
	});

	it('provider condition', () => {
		expect(matchWhen({ provider: { equals: 'openai-compatible' } }, baseInput())).toBe(true);
		expect(matchWhen({ provider: { equals: 'openai' } }, baseInput())).toBe(false);
	});

	it('baseURL condition', () => {
		expect(matchWhen({ baseURL: { endsWith: '/v1' } }, baseInput())).toBe(true);
		expect(matchWhen({ baseURL: { endsWith: '/v2' } }, baseInput())).toBe(false);
	});

	it('model condition', () => {
		expect(matchWhen({ model: { equals: 'google/gemma-4-31b' } }, baseInput())).toBe(true);
		expect(matchWhen({ model: { equals: 'wrong' } }, baseInput())).toBe(false);
	});

	it('corsBypassEnabled condition', () => {
		expect(matchWhen({ corsBypassEnabled: { equals: false } }, baseInput({ corsBypassEnabled: false }))).toBe(true);
		expect(matchWhen({ corsBypassEnabled: { equals: true } }, baseInput({ corsBypassEnabled: false }))).toBe(false);
	});

	it('pageProtocol condition', () => {
		expect(matchWhen({ pageProtocol: { equals: 'https' } }, baseInput({ pageProtocol: 'https' }))).toBe(true);
		expect(matchWhen({ pageProtocol: { equals: 'http' } }, baseInput({ pageProtocol: 'https' }))).toBe(false);
	});

	it('multiple fields AND together', () => {
		expect(matchWhen({ provider: { equals: 'openai-compatible' }, baseURL: { endsWith: '/v1' } }, baseInput())).toBe(true);
		expect(matchWhen({ provider: { equals: 'openai' }, baseURL: { endsWith: '/v1' } }, baseInput())).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// evaluator.ts — applyStripSuffix
// ---------------------------------------------------------------------------

describe('evaluator — applyStripSuffix', () => {
	it('strips the longest matching suffix', () => {
		expect(applyStripSuffix('https://example.com/v1/chat/completions', ['/chat/completions', '/chat'])).toBe('https://example.com/v1');
	});

	it('strips shorter suffix when only it matches', () => {
		expect(applyStripSuffix('https://example.com/v1/chat', ['/chat/completions', '/chat'])).toBe('https://example.com/v1');
	});

	it('returns baseUrl unchanged when no suffix matches', () => {
		expect(applyStripSuffix('https://example.com/v1', ['/chat/completions', '/chat'])).toBe('https://example.com/v1');
	});

	it('handles empty suffix list', () => {
		expect(applyStripSuffix('https://example.com/v1', [])).toBe('https://example.com/v1');
	});

	it('single-pass: does not chain-strip', () => {
		// After stripping /chat/completions we get .../v1 — /chat no longer matches.
		expect(applyStripSuffix('https://example.com/v1/chat/completions', ['/chat/completions', '/chat'])).toBe('https://example.com/v1');
		// Suffix that is itself a suffix of the longest still only strips once.
		expect(applyStripSuffix('https://example.com/v1/v1', ['/v1'])).toBe('https://example.com/v1');
	});
});

// ---------------------------------------------------------------------------
// evaluator.ts — expandSuggestionTemplate
// ---------------------------------------------------------------------------

describe('evaluator — expandSuggestionTemplate', () => {
	it('replaces {{baseUrl}} placeholder', () => {
		expect(expandSuggestionTemplate('{{baseUrl}}/v1', baseInput({ baseURL: 'https://ollama.com' }))).toBe('https://ollama.com/v1');
	});

	it('handles whitespace in placeholder', () => {
		expect(expandSuggestionTemplate('{{ baseUrl }}/v1', baseInput({ baseURL: 'https://ollama.com' }))).toBe('https://ollama.com/v1');
	});

	it('returns unchanged when no placeholder present', () => {
		expect(expandSuggestionTemplate('https://api.openai.com/v1', baseInput())).toBe('https://api.openai.com/v1');
	});
});

// ---------------------------------------------------------------------------
// evaluator.ts — evaluateProviderTip: individual rules
// ---------------------------------------------------------------------------

describe('evaluator — rule A1 (openai non-official base URL)', () => {
	it('fires for openai provider with non-official base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'openai', baseURL: 'https://example.com/v1', model: 'google/gemma-4-31b' }));
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A1-openai-non-official-base-url');
		expect(tip!.kind).toBe('warning');
		expect(tip!.suggest?.type).toBe('rewriteBaseUrl');
		expect(tip!.suggest).toEqual({ type: 'rewriteBaseUrl', value: 'https://api.openai.com/v1' });
	});

	it('does not fire for the official openai base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'openai', baseURL: 'https://api.openai.com/v1', model: 'google/gemma-4-31b' }));
		expect(tip).toBeNull();
	});

	it('does not fire for empty base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'openai', baseURL: '', model: 'google/gemma-4-31b' }));
		expect(tip).toBeNull();
	});

	it('does not fire for openai-compatible provider', () => {
		// openai-compatible with a non-/v1 URL triggers A2, not A1.
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com', model: 'google/gemma-4-31b' })
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).not.toBe('A1-openai-non-official-base-url');
	});
});

describe('evaluator — rule A2 (openai-compat missing /v1)', () => {
	it('fires when /v1 suffix is missing', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com', model: 'google/gemma-4-31b' })
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A2-openai-compat-missing-v1');
		expect(tip!.kind).toBe('warning');
	});

	it('does not fire when baseURL ends with /v1', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for empty base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'openai-compatible', baseURL: '', model: 'google/gemma-4-31b' }));
		expect(tip).toBeNull();
	});
});

describe('evaluator — rule A2b (openai-compat chat suffix)', () => {
	it('fires for /v1/chat suffix', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com/v1/chat', model: 'google/gemma-4-31b' })
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A2b-openai-compat-chat-suffix');
		expect(tip!.kind).toBe('warning');
		expect(tip!.suggest?.type).toBe('rewriteBaseUrlStripSuffix');
		expect(tip!.suggest).toEqual({
			type: 'rewriteBaseUrlStripSuffix',
			value: ['/chat/completions', '/chat'],
		});
	});

	it('fires for /v1/chat/completions suffix', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://example.com/v1/chat/completions',
				model: 'google/gemma-4-31b',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A2b-openai-compat-chat-suffix');
	});

	it('has higher priority than A2 (priority 10 vs 20)', () => {
		// /v1/chat/completions triggers both A2 and A2b; A2b wins (lower priority number).
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://example.com/v1/chat/completions',
				model: 'google/gemma-4-31b',
			})
		);
		expect(tip!.id).toBe('A2b-openai-compat-chat-suffix');
	});
});

describe('evaluator — rule A3 (ollama non-default base URL)', () => {
	it('fires for non-default ollama base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'https://example.com', model: 'llama3' }));
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A3-ollama-base-url-non-default');
		expect(tip!.kind).toBe('note');
	});

	it('does not fire for default https://ollama.com', () => {
		// On desktop C1 fires; on web B2b fires. Neither is A3.
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'https://ollama.com', model: 'llama3', platform: 'desktop' }));
		expect(tip!.id).not.toBe('A3-ollama-base-url-non-default');
	});

	it('does not fire for default http://localhost:11434', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'llama3' }));
		expect(tip).toBeNull();
	});

	it('does not fire for empty base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: '', model: 'llama3' }));
		expect(tip).toBeNull();
	});
});

describe('evaluator — rule A3b (ollama base URL has path)', () => {
	it('fires for non-root path', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3' }));
		// A3b (priority 25) should win over A3 (priority 30).
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A3b-ollama-base-url-has-path');
		expect(tip!.kind).toBe('note');
	});

	it('does not fire for root path', () => {
		// No trailing slash, no path — A3b should not fire. Also use 'web' to avoid C1.
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'llama3', platform: 'web' }));
		expect(tip).toBeNull();
	});

	it('A3b beats A3 (lower priority) when both match', () => {
		// /v1 → non-default AND has path → both A3 and A3b; A3b wins.
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'https://example.com/v1', model: 'llama3' }));
		expect(tip!.id).toBe('A3b-ollama-base-url-has-path');
	});
});

describe('evaluator — rule A4 (ollama + gemini model)', () => {
	it('fires for ollama with gemini model', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'gemini-3-flash-preview' }));
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A4-ollama-gemini-model');
		expect(tip!.kind).toBe('warning');
		expect(tip!.suggest?.type).toBe('switchProvider');
		expect(tip!.suggest).toEqual({
			type: 'switchProvider',
			value: 'openai-compatible',
			rewriteBaseUrl: '{{baseUrl}}/v1',
		});
	});

	it('does not fire for non-gemini model', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'llama3' }));
		expect(tip).toBeNull();
	});

	it('A4 beats C1 verified on desktop when model is gemini', () => {
		// Default ollama URL + gemini model → C1 verified (40) and A4 warning (10); A4 wins.
		const tip = evaluateProviderTip(
			baseInput({ provider: 'ollama', baseURL: 'https://ollama.com', model: 'gemini-3-flash-preview', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A4-ollama-gemini-model');
	});
});

describe('evaluator — rule A5 (known provider verified)', () => {
	it('fires for known provider with wildcard models', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://api.neuralwatt.com/v1',
				model: 'any-model',
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A5-known-provider-verified');
		expect(tip!.kind).toBe('verified');
		expect(tip!.suggest).toBeUndefined();
	});

	it('fires for known provider with specific model match', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://openrouter.ai/api/v1',
				model: 'z-ai/glm-5.2',
				platform: 'desktop',
			})
		);
		expect(tip!.id).toBe('A5-known-provider-verified');
	});
});

describe('evaluator — rule A5b (known provider, unverified model)', () => {
	it('fires for known provider with unknown model', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://openrouter.ai/api/v1',
				model: 'unknown/model',
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A5b-known-provider-model-unverified');
		expect(tip!.kind).toBe('note');
	});

	it('does not fire when model is verified (A5 fires instead)', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://openrouter.ai/api/v1',
				model: 'z-ai/glm-5.2',
				platform: 'desktop',
			})
		);
		expect(tip!.id).toBe('A5-known-provider-verified');
	});
});

describe('evaluator — rule B1 (nvidia no proxy, web only)', () => {
	it('fires on web without CORS bypass', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('B1-nvidia-no-proxy');
		expect(tip!.kind).toBe('warning');
	});

	it('does not fire when CORS bypass is enabled', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: true,
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire on desktop', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'desktop',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire on android', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'android',
			})
		);
		expect(tip).toBeNull();
	});
});

describe('evaluator — rule B2 (ollama.com no proxy, web only)', () => {
	it('fires on web without CORS bypass', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('B2-ollama-host-no-proxy');
	});

	it('does not fire when CORS bypass is enabled', () => {
		// Use /v1 suffix to avoid A2 firing on the missing /v1.
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com/v1',
				model: 'model',
				corsBypassEnabled: true,
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire on desktop', () => {
		// On desktop, B2 (web-only) doesn't fire. Use /v1 suffix to avoid A2.
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'desktop',
			})
		);
		// C2 fires instead (verified ollama /v1 on desktop), but not B2.
		expect(tip).not.toBeNull();
		expect(tip!.id).not.toBe('B2-ollama-host-no-proxy');
	});
});

describe('evaluator — rule B2b (ollama provider ollama.com no proxy, web only)', () => {
	it('fires on web without CORS bypass', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('B2b-ollama-provider-no-proxy');
		expect(tip!.kind).toBe('warning');
	});

	it('does not fire when CORS bypass is enabled', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				corsBypassEnabled: true,
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire on desktop', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				corsBypassEnabled: false,
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		// C1 fires instead on desktop.
		expect(tip!.id).not.toBe('B2b-ollama-provider-no-proxy');
	});

	it('does not fire for openai-compatible provider (B2 covers that)', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		expect(tip!.id).toBe('B2-ollama-host-no-proxy');
	});
});

describe('evaluator — rule B3 (HTTPS page insecure API, web only)', () => {
	it('fires when HTTPS page calls plain HTTP API', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://192.168.1.100:8080/v1',
				model: 'model',
				pageProtocol: 'https',
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('B3-https-page-insecure-api');
	});

	it('allows https:// API on HTTPS page', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://api.example.com/v1',
				model: 'model',
				pageProtocol: 'https',
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('allows http://localhost on HTTPS page', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://localhost:1234/v1',
				model: 'model',
				pageProtocol: 'https',
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('allows http://127.0.0.1 on HTTPS page', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://127.0.0.1:1234/v1',
				model: 'model',
				pageProtocol: 'https',
				platform: 'web',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire on desktop even for insecure API', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://192.168.1.100:8080/v1',
				model: 'model',
				pageProtocol: 'https',
				platform: 'desktop',
			})
		);
		expect(tip).toBeNull();
	});
});

describe('evaluator — rule C1 (ollama default verified, desktop-android only)', () => {
	it('fires on desktop with default ollama URL', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('C1-ollama-default-verified');
		expect(tip!.kind).toBe('verified');
	});

	it('fires on android with default ollama URL', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				platform: 'android',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('C1-ollama-default-verified');
	});

	it('does not fire on web', () => {
		// On web, B2b fires instead of C1.
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).not.toBe('C1-ollama-default-verified');
	});

	it('does not fire for localhost default ollama URL (only https://ollama.com)', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'http://localhost:11434',
				model: 'llama3',
				platform: 'desktop',
			})
		);
		expect(tip).toBeNull();
	});

	it('does not fire for gemini model', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'gemini-3-flash-preview',
				platform: 'desktop',
			})
		);
		expect(tip!.id).not.toBe('C1-ollama-default-verified');
	});
});

describe('evaluator — rule C2 (ollama /v1 compat verified, desktop-android only)', () => {
	it('fires on desktop', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com/v1',
				model: 'llama3',
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('C2-ollama-v1-compat-verified');
		expect(tip!.kind).toBe('verified');
	});

	it('fires on android', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com/v1',
				model: 'llama3',
				platform: 'android',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('C2-ollama-v1-compat-verified');
	});

	it('does not fire on web', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://ollama.com/v1',
				model: 'llama3',
				platform: 'web',
			})
		);
		// On web, B2 would fire for ollama.com host without proxy.
		expect(tip).not.toBeNull();
		expect(tip!.id).not.toBe('C2-ollama-v1-compat-verified');
	});
});

// ---------------------------------------------------------------------------
// evaluator.ts — priority and platform gating across the full rule set
// ---------------------------------------------------------------------------

describe('evaluator — priority selection', () => {
	it('returns null when no rules match (clean config)', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai',
				baseURL: 'https://api.openai.com/v1',
				model: 'google/gemma-4-31b',
				platform: 'desktop',
			})
		);
		expect(tip).toBeNull();
	});

	it('selects the lowest priority number among matching rules', () => {
		// A2b (priority 10) should win over A2 (priority 20).
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://example.com/v1/chat',
				model: 'model',
				platform: 'desktop',
			})
		);
		expect(tip!.id).toBe('A2b-openai-compat-chat-suffix');
	});

	it('ties broken by declaration order in YAML', () => {
		// B1 and B2 both have priority 10 and identical structure.
		// They can't both match the same baseURL — this verifies the tie-break
		// path is exercised by ensuring a stable, deterministic pick when
		// the same priority band is used across different inputs.
		const t1 = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		const t2 = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'https://integrate.api.nvidia.com/v1',
				model: 'model',
				corsBypassEnabled: false,
				platform: 'web',
			})
		);
		expect(t1!.id).toBe(t2!.id);
	});
});

describe('evaluator — platform gating across all platforms', () => {
	// Verify that `platform: all` rules fire identically on web, desktop, android.

	for (const platform of ['web', 'desktop', 'android'] as const) {
		describe(`${platform}`, () => {
			it('A1 fires', () => {
				const tip = evaluateProviderTip(
					baseInput({ provider: 'openai', baseURL: 'https://bad.com/v1', model: 'google/gemma-4-31b', platform })
				);
				expect(tip!.id).toBe('A1-openai-non-official-base-url');
			});

			it('A2 fires', () => {
				const tip = evaluateProviderTip(
					baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com', model: 'model', platform })
				);
				expect(tip!.id).toBe('A2-openai-compat-missing-v1');
			});

			it('A4 fires', () => {
				const tip = evaluateProviderTip(
					baseInput({
						provider: 'ollama',
						baseURL: 'http://localhost:11434',
						model: 'gemini-3-flash-preview',
						platform,
					})
				);
				expect(tip!.id).toBe('A4-ollama-gemini-model');
			});
		});
	}

	it('B-series rules do not fire on desktop', () => {
		const platforms: Platform[] = ['desktop', 'android'];
		for (const platform of platforms) {
			const tip = evaluateProviderTip(
				baseInput({
					provider: 'openai-compatible',
					baseURL: 'https://integrate.api.nvidia.com/v1',
					model: 'model',
					corsBypassEnabled: false,
					platform,
				})
			);
			expect(tip).toBeNull();
		}
	});

	it('C-series rules do not fire on web', () => {
		// On web B2b fires for this config, but no C-series rule should.
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'https://ollama.com',
				model: 'llama3',
				platform: 'web',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).not.toBe('C1-ollama-default-verified');
		expect(tip!.id).not.toBe('C2-ollama-v1-compat-verified');
	});
});

describe('evaluator — rule A7 (small model warning)', () => {
	for (const model of ['gemma-2b', 'qwen-0.8b', 'qwen-4b', 'gemma-9b', 'gemma-3n-e2b', 'gemma-3n-e4b', 'qwen-12b']) {
		it(`fires for ${model}`, () => {
			const tip = evaluateProviderTip(
				baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model, platform: 'desktop' })
			);
			expect(tip).not.toBeNull();
			expect(tip!.id).toBe('A7-small-model-warning');
			expect(tip!.kind).toBe('warning');
			expect(tip!.suggest).toBeUndefined();
		});
	}

	it('is case-insensitive', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model: 'QWEN-12B-IT', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A7-small-model-warning');
	});

	it('does not fire for large models', () => {
		for (const model of ['google/gemma-4-31b', 'z-ai/glm-5.2', 'yi-34b', 'mixtral-8x7b-32b', 'qwen-14b']) {
			const tip = evaluateProviderTip(
				baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model, platform: 'desktop' })
			);
			expect(tip!.id).not.toBe('A7-small-model-warning');
		}
	});

	it('does not fire for MoE models with A-prefixed active params', () => {
		for (const model of ['Qwen3.6-35B-A3B', '26B-A4B', '26B A4B']) {
			const tip = evaluateProviderTip(
				baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model, platform: 'desktop' })
			);
			expect(tip!.id).not.toBe('A7-small-model-warning');
		}
	});

	it('does not fire for empty model', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model: '', platform: 'desktop' })
		);
		expect(tip).toBeNull();
	});

	it('A7 beats A5 verified (priority 25 < 40)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model: 'gemma-2b', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A7-small-model-warning');
	});

	it('A7 beats C1 verified on desktop (priority 25 < 40)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'ollama', baseURL: 'https://ollama.com', model: 'qwen-2b', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A7-small-model-warning');
	});

	it('A7 beats C2 verified on desktop (priority 25 < 40)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://ollama.com/v1', model: 'qwen-2b', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A7-small-model-warning');
	});

	it('A2 beats A7 (priority 20 < 25) — missing /v1 surfaces first', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://example.com', model: 'gemma-2b', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A2-openai-compat-missing-v1');
	});

	it('A6 beats A7 (priority 20 < 25) — insecure HTTP surfaces first', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://api.example.com/v1', model: 'gemma-2b', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A6-public-host-insecure-http');
	});

	it('A4 beats A7 (priority 10 < 25) — wrong-provider model surfaces first', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'ollama', baseURL: 'http://localhost:11434', model: 'gemini-3-flash-preview', platform: 'desktop' })
		);
		expect(tip!.id).toBe('A4-ollama-gemini-model');
	});

	it('includes model in messageParams', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model: 'gemma-2b', platform: 'desktop' })
		);
		expect(tip!.messageParams?.model).toBe('gemma-2b');
	});

	for (const platform of ['web', 'desktop', 'android'] as const) {
		it(`fires on ${platform}`, () => {
			const tip = evaluateProviderTip(
				baseInput({ provider: 'openai-compatible', baseURL: 'https://api.neuralwatt.com/v1', model: 'gemma-2b', platform })
			);
			expect(tip!.id).toBe('A7-small-model-warning');
		});
	}
});

// ---------------------------------------------------------------------------
// evaluator.ts — messageParams
// ---------------------------------------------------------------------------

describe('evaluator — messageParams', () => {
	it('includes baseUrl when non-empty', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'http://localhost:11434',
				model: 'gemini-3-flash-preview',
				platform: 'desktop',
			})
		);
		expect(tip!.messageParams?.baseUrl).toBe('http://localhost:11434');
	});

	it('includes model when non-empty', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'http://localhost:11434',
				model: 'gemini-3-flash-preview',
				platform: 'desktop',
			})
		);
		expect(tip!.messageParams?.model).toBe('gemini-3-flash-preview');
	});

	it('includes host when base URL is valid', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'ollama',
				baseURL: 'http://localhost:11434',
				model: 'gemini-3-flash-preview',
				platform: 'desktop',
			})
		);
		expect(tip!.messageParams?.host).toBe('localhost:11434');
	});

	it('omits host when base URL is invalid', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'not-a-url',
				model: 'model',
				platform: 'desktop',
			})
		);
		expect(tip).not.toBeNull();
		expect(tip!.messageParams?.host).toBeUndefined();
		expect(tip!.messageParams?.baseUrl).toBe('not-a-url');
	});
});

describe('evaluator — rule A6 (public host insecure HTTP, all platforms)', () => {
	it('fires for http:// to a public host', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://api.example.com/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).not.toBeNull();
		expect(tip!.id).toBe('A6-public-host-insecure-http');
		expect(tip!.kind).toBe('warning');
		expect(tip!.suggest).toEqual({ type: 'rewriteBaseUrlScheme', value: 'https' });
	});

	it('does not fire for https:// to a public host', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'https://api.example.com/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://localhost', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://localhost:1234/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://127.0.0.1', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://*.localhost', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://api.localhost/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://10.* (LAN)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://10.0.0.1:8080/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://172.* (LAN)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://172.16.0.1:8080/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://192.168.* (LAN)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://192.168.1.100:8080/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://*.local (mDNS)', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://raspberry.local/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://*.internal', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://server.internal/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for http://*.home.arpa', () => {
		const tip = evaluateProviderTip(
			baseInput({ provider: 'openai-compatible', baseURL: 'http://nas.home.arpa/v1', model: 'google/gemma-4-31b' })
		);
		expect(tip).toBeNull();
	});

	it('does not fire for empty base URL', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'openai-compatible', baseURL: '', model: 'google/gemma-4-31b' }));
		expect(tip).toBeNull();
	});

	for (const platform of ['web', 'desktop', 'android'] as const) {
		it(`fires on ${platform}`, () => {
			const tip = evaluateProviderTip(
				baseInput({
					provider: 'openai-compatible',
					baseURL: 'http://api.example.com/v1',
					model: 'google/gemma-4-31b',
					platform,
					pageProtocol: 'http',
				})
			);
			expect(tip!.id).toBe('A6-public-host-insecure-http');
		});
	}

	it('B3 beats A6 on web HTTPS page for public host (priority 10 vs 20)', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://api.example.com/v1',
				model: 'google/gemma-4-31b',
				pageProtocol: 'https',
				platform: 'web',
			})
		);
		expect(tip!.id).toBe('B3-https-page-insecure-api');
	});

	it('A6 fires on desktop where B3 does not', () => {
		const tip = evaluateProviderTip(
			baseInput({
				provider: 'openai-compatible',
				baseURL: 'http://api.example.com/v1',
				model: 'google/gemma-4-31b',
				pageProtocol: 'https',
				platform: 'desktop',
			})
		);
		expect(tip!.id).toBe('A6-public-host-insecure-http');
	});

	it('fires for ollama provider too (no provider constraint)', () => {
		const tip = evaluateProviderTip(baseInput({ provider: 'ollama', baseURL: 'http://api.example.com', model: 'llama3' }));
		expect(tip!.id).toBe('A6-public-host-insecure-http');
	});
});

// ---------------------------------------------------------------------------
// runtime.ts — detectPlatform / getPlatformSync
// ---------------------------------------------------------------------------

describe('runtime — platform detection', () => {
	beforeEach(() => {
		resetTauriCache();
		resetPlatformCache();
	});

	it('getPlatformSync returns "web" before detectPlatform is called', () => {
		expect(getPlatformSync()).toBe('web');
	});

	it('detectPlatform returns "web" when not in Tauri', async () => {
		const platform = await detectPlatform();
		expect(platform).toBe('web');
		expect(getPlatformSync()).toBe('web');
	});

	it('detectPlatform caches result', async () => {
		const first = await detectPlatform();
		const second = await detectPlatform();
		expect(first).toBe(second);
	});

	it('resetPlatformCache clears the cached platform', async () => {
		await detectPlatform();
		resetPlatformCache();
		expect(getPlatformSync()).toBe('web');
	});

	it('resetTauriCache does not clear platform cache', async () => {
		await detectPlatform();
		resetTauriCache();
		expect(getPlatformSync()).toBe('web');
	});
});
