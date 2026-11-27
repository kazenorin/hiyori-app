import { describe, it, expect } from 'vitest';
import { isEligibleProvider, isEligibleModel, resolveProviderType, resolveEndpoint, resolveModelWiring } from '../eligibility';

const compatProvider = {
	id: 'test',
	name: 'Test',
	npm: '@ai-sdk/openai-compatible',
	api: 'https://api.test.com/v1',
	env: [],
	doc: '',
	models: {},
};
const openaiProvider = { ...compatProvider, id: 'openai', npm: '@ai-sdk/openai', api: undefined };
const groqProvider = { ...compatProvider, id: 'groq', npm: '@ai-sdk/groq' };
const chatModel = { id: 'm1', name: 'M1', type: undefined, provider: undefined };
const embeddingModel = { id: 'm2', name: 'M2', type: 'embedding', provider: undefined };
const overrideModel = { id: 'm3', name: 'M3', type: undefined, provider: { npm: '@ai-sdk/anthropic' } };
const responsesModel = {
	id: 'm4',
	name: 'M4',
	type: undefined,
	provider: { npm: '@ai-sdk/openai', shape: 'responses' as const },
};

describe('isEligibleProvider', () => {
	it('accepts openai-compatible', () => expect(isEligibleProvider(compatProvider)).toBe(true));
	it('accepts @ai-sdk/openai', () => expect(isEligibleProvider(openaiProvider)).toBe(true));
	it('accepts @openrouter/ai-sdk-provider', () =>
		expect(isEligibleProvider({ ...compatProvider, npm: '@openrouter/ai-sdk-provider' })).toBe(true));
	it('rejects @ai-sdk/groq', () => expect(isEligibleProvider(groqProvider)).toBe(false));
	it('rejects @ai-sdk/anthropic', () => expect(isEligibleProvider({ ...compatProvider, npm: '@ai-sdk/anthropic' })).toBe(false));
});

describe('isEligibleModel', () => {
	it('accepts chat model on eligible provider', () => expect(isEligibleModel(compatProvider, chatModel)).toBe(true));
	it('rejects non-chat type', () => expect(isEligibleModel(compatProvider, embeddingModel)).toBe(false));
	it('rejects model with unsupported override npm', () => expect(isEligibleModel(compatProvider, overrideModel)).toBe(false));
	it('accepts model with supported override npm', () =>
		expect(isEligibleModel(compatProvider, { ...chatModel, provider: { npm: '@ai-sdk/openai-compatible' } })).toBe(true));
	it('includes deprecated models (flagged, not excluded)', () =>
		expect(isEligibleModel(compatProvider, { ...chatModel, status: 'deprecated' })).toBe(true));
});

describe('resolveProviderType', () => {
	it('maps openai-compatible', () => expect(resolveProviderType('@ai-sdk/openai-compatible')).toBe('openai-compatible'));
	it('maps openai', () => expect(resolveProviderType('@ai-sdk/openai')).toBe('openai'));
	it('maps openrouter', () => expect(resolveProviderType('@openrouter/ai-sdk-provider')).toBe('openrouter'));
});

describe('resolveEndpoint', () => {
	it('uses provider.api when present', () => expect(resolveEndpoint(compatProvider)).toBe('https://api.test.com/v1'));
	it('falls back to OPENAI_BASE_URL for @ai-sdk/openai without api', () =>
		expect(resolveEndpoint(openaiProvider)).toBe('https://api.openai.com/v1'));
	it('falls back to OPENROUTER_BASE_URL for openrouter without api', () =>
		expect(resolveEndpoint({ ...compatProvider, npm: '@openrouter/ai-sdk-provider', api: undefined })).toBe(
			'https://openrouter.ai/api/v1'
		));
});

describe('resolveModelWiring', () => {
	it('chat-completions for openai-compatible', () => {
		const w = resolveModelWiring(compatProvider, chatModel);
		expect(w).toEqual({ providerType: 'openai-compatible', apiType: 'chat-completions', baseURL: undefined });
	});
	it('responses when shape=responses + @ai-sdk/openai override', () => {
		const w = resolveModelWiring(compatProvider, responsesModel);
		expect(w.apiType).toBe('responses');
		expect(w.providerType).toBe('openai');
	});
	it('per-model baseURL override', () => {
		const w = resolveModelWiring(compatProvider, { ...chatModel, provider: { api: 'https://override.test/v1' } });
		expect(w.baseURL).toBe('https://override.test/v1');
	});
});
