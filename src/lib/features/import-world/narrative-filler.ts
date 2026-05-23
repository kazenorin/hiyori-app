// Narrative variable extraction pipeline
// Uses runEditorTemplateFitter to extract scene fields (sceneTitle, background, etc.)
// from raw assistant message text, producing full NarrativeVariables.

import type { NarrativeExtractionResult, ParsedMessage } from './types';
import { type RetryConfig } from '$lib/ai/chat-stream';
import { sleep } from '$lib/utils/async';
import type { StreamState } from '$lib/ai/chat-callbacks';
import { runEditorTemplateFitter, type PipelineRunContext, type TrackPhase } from '$lib/ai/pipeline/runners';
import { editorHasTemplateMetadata } from '$lib/ai/pipeline/message-builder';
import type { PipelineCallbacks, PipelineState } from '$lib/ai/pipeline/types';
import { loadWriterOutputTemplate } from '$lib/fs/prompts';
import { buildImportRunContext } from './pipeline-context';

function buildNarrativeFillerCallbacks(
	msgIndex: number,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void
): PipelineCallbacks {
	return {
		onPhaseStart: () => {},
		onPhaseStream: (_phase, streamState) => {
			onProgress(msgIndex, streamState);
		},
		onPhaseRetry: (_phase, attempt, maxAttempts) => {
			onError(msgIndex, new Error(`Template fitter retry ${attempt}/${maxAttempts}`), attempt);
		},
		onPhaseComplete: () => {},
		onError: (_phase, error) => {
			const err = error instanceof Error ? error : new Error(String(error));
			onError(msgIndex, err, 0);
		},
		onAllComplete: () => {},
	};
}

function buildNarrativeFillerRunContext(
	retryConfig: RetryConfig,
	abortSignal: AbortSignal,
	callbacks: PipelineCallbacks,
	writerOutputTemplate: string
): PipelineRunContext {
	return buildImportRunContext(retryConfig, abortSignal, callbacks, { writerOutputTemplate });
}

async function fillNarrativeVariables(
	messages: ParsedMessage[],
	indicesNeedingFilling: number[],
	retryConfig: RetryConfig,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void
): Promise<NarrativeExtractionResult[]> {
	const writerOutputTemplate = await loadWriterOutputTemplate();
	const results: NarrativeExtractionResult[] = [];

	for (let i = 0; i < indicesNeedingFilling.length; i++) {
		const msgIndex = indicesNeedingFilling[i];
		const msg = messages[msgIndex];
		if (!msg || msg.role !== 'assistant') continue;

		const abortController = new AbortController();
		const callbacks = buildNarrativeFillerCallbacks(msgIndex, onProgress, onError);
		const ctx = buildNarrativeFillerRunContext(retryConfig, abortController.signal, callbacks, writerOutputTemplate);

		let state: PipelineState = {
			currentPhase: null,
			editorOutput: msg.content,
			editorVariables: msg.variables ?? null,
		};

		const trackPhase: TrackPhase = (_phaseName, result) => result.state;

		state = await runEditorTemplateFitter(ctx, state, trackPhase);

		const variables = state.editorVariables ?? null;
		const hasMetadata = editorHasTemplateMetadata(variables);

		results.push({
			messageIndex: msgIndex,
			variables: hasMetadata ? variables : null,
			source: hasMetadata ? 'template-fitter' : 'none',
		});

		if (i < indicesNeedingFilling.length - 1) {
			await sleep(100);
		}
	}

	return results;
}

export async function runNarrativeFilling(
	messages: ParsedMessage[],
	retryConfig: RetryConfig,
	log: (msg: string) => void,
	onProgress: (msgIndex: number, state: StreamState) => void,
	onError: (msgIndex: number, err: Error, attempt: number) => void
): Promise<NarrativeExtractionResult[]> {
	const indicesNeedingFilling: number[] = [];

	for (let i = 0; i < messages.length; i++) {
		const message = messages[i];
		if (message.role !== 'assistant') continue;
		if (editorHasTemplateMetadata(message.variables)) continue;
		indicesNeedingFilling.push(i);
	}

	if (indicesNeedingFilling.length === 0) return [];

	log(`Filling narrative variables for ${indicesNeedingFilling.length} messages...`);
	return fillNarrativeVariables(messages, indicesNeedingFilling, retryConfig, onProgress, onError);
}
