import { describe, it, expect, vi } from 'vitest';
import type { ProviderConfig } from '#lib/stores/settings.svelte.ts';
import type { PipelineProviderConfigs } from '#lib/ai/pipeline/types.ts';

// The settings store has import-time side effects (localStorage, theme, logger);
// the resolver is pure and never reads it.
vi.mock('#lib/stores/settings.svelte.ts', () => ({}));

import { resolveParallelRunMode } from '#lib/ai/chat/pipeline-config.ts';

function makeConfig(overrides: Partial<ProviderConfig>): ProviderConfig {
	return {
		id: 'provider-1',
		name: 'Provider',
		provider: 'openai-compatible',
		apiType: 'chat-completions',
		baseURL: 'https://api.example.com/v1',
		model: 'model-a',
		corsBypassEnabled: false,
		wispProxyUrl: 'ws://localhost:6001',
		...overrides,
	};
}

function makeConfigs(writer: ProviderConfig | undefined, summarizer: ProviderConfig | undefined): PipelineProviderConfigs {
	return {
		plotPlanner: undefined,
		writer,
		reviewer: undefined,
		editor: undefined,
		gameMaster: undefined,
		summarizer,
		minorTaskAgent: undefined,
	};
}

describe('resolveParallelRunMode explicit modes', () => {
	it.each(['singleThreaded', 'parallelAfterWriter', 'parallelWithWriter'] as const)(
		'passes %s through unchanged even when Auto would pick differently',
		(mode) => {
			const local = makeConfig({ baseURL: 'http://localhost:11434/v1' });
			expect(resolveParallelRunMode(mode, makeConfigs(local, local))).toBe(mode);
		}
	);
});

describe('resolveParallelRunMode auto', () => {
	it('runs with the Writer when the endpoints differ (no shared cache or context pool)', () => {
		const configs = makeConfigs(
			makeConfig({ baseURL: 'https://api.example.com/v1' }),
			makeConfig({ baseURL: 'https://other.example.com/v1' })
		);
		expect(resolveParallelRunMode('auto', configs)).toBe('parallelWithWriter');
	});

	it('runs with the Writer when only the port differs (distinct local servers)', () => {
		const configs = makeConfigs(makeConfig({ baseURL: 'http://localhost:11434/v1' }), makeConfig({ baseURL: 'http://localhost:11435/v1' }));
		expect(resolveParallelRunMode('auto', configs)).toBe('parallelWithWriter');
	});

	it('runs single-threaded on a local server even when the models differ (local check precedes model check)', () => {
		const configs = makeConfigs(
			makeConfig({ baseURL: 'http://localhost:11434/v1', model: 'gemma' }),
			makeConfig({ baseURL: 'http://localhost:11434/v1', model: 'llama' })
		);
		expect(resolveParallelRunMode('auto', configs)).toBe('singleThreaded');
	});

	it.each([
		'http://localhost:11434/v1',
		'http://127.0.0.1:11434/v1',
		'http://[::1]:11434/v1',
		'http://192.168.1.50:8080/v1',
		'http://10.0.0.5:8080/v1',
		'http://my-server.local:8080/v1',
	])('treats %s as local', (baseURL) => {
		const config = makeConfig({ baseURL });
		expect(resolveParallelRunMode('auto', makeConfigs(config, config))).toBe('singleThreaded');
	});

	it('runs after the Writer for the same cloud endpoint and model (shared prefix cache)', () => {
		const config = makeConfig({ baseURL: 'https://api.example.com/v1', model: 'model-a' });
		expect(resolveParallelRunMode('auto', makeConfigs(config, config))).toBe('parallelAfterWriter');
	});

	it('runs with the Writer for the same cloud endpoint but different models (caches are per-model)', () => {
		const configs = makeConfigs(
			makeConfig({ baseURL: 'https://api.example.com/v1', model: 'model-a' }),
			makeConfig({ baseURL: 'https://api.example.com/v1', model: 'model-b' })
		);
		expect(resolveParallelRunMode('auto', configs)).toBe('parallelWithWriter');
	});

	it('falls back to after the Writer when the writer config is missing', () => {
		expect(resolveParallelRunMode('auto', makeConfigs(undefined, makeConfig({})))).toBe('parallelAfterWriter');
	});

	it('falls back to after the Writer when the summarizer config is missing', () => {
		expect(resolveParallelRunMode('auto', makeConfigs(makeConfig({}), undefined))).toBe('parallelAfterWriter');
	});

	it('falls back to after the Writer when both configs are missing', () => {
		expect(resolveParallelRunMode('auto', makeConfigs(undefined, undefined))).toBe('parallelAfterWriter');
	});

	it('does not throw on an unparseable baseURL and falls through to the model comparison', () => {
		const sameModel = makeConfigs(makeConfig({ baseURL: 'not-a-url' }), makeConfig({ baseURL: 'not-a-url' }));
		expect(resolveParallelRunMode('auto', sameModel)).toBe('parallelAfterWriter');

		const differentModel = makeConfigs(
			makeConfig({ baseURL: 'not-a-url', model: 'model-a' }),
			makeConfig({ baseURL: 'not-a-url', model: 'model-b' })
		);
		expect(resolveParallelRunMode('auto', differentModel)).toBe('parallelWithWriter');
	});
});
