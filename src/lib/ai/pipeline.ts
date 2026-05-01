import type { ToolSet } from 'ai';
import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { streamChatResponse } from './chat-stream';
import { createModel } from './provider';
import type { PhaseName } from './narrative-types';
import type { PipelineState, PipelineCallbacks, PhaseStreamState } from './pipeline-types';
import type { StreamState } from './chat-callbacks';
import type { StreamResultMetadata } from './streaming';
import {
	loadPlotPlannerPrompt,
	loadWriterPrompt,
	loadWriterOutputTemplate,
	loadReviewerPrompt,
	loadEditorPrompt,
	loadGameMasterPrompt,
	loadSummarizerPrompt,
	loadActSummaryTemplate,
} from '$lib/fs/prompts';

export interface PipelineProviderConfigs {
	plotPlanner: ProviderConfig | undefined;
	writer: ProviderConfig | undefined;
	reviewer: ProviderConfig | undefined;
	editor: ProviderConfig | undefined;
	gameMaster: ProviderConfig | undefined;
	summarizer: ProviderConfig | undefined;
}

export interface PipelineInput {
	providerConfigs: PipelineProviderConfigs;
	systemPrompt: string;
	generalInstructions: string;
	worldContent: string;
	actPlot: string;
	actSummary: string;
	history: MessageBase[];
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
	memoryRunner?: () => void;
	completedScenes?: number;
}

function updateState(prev: PipelineState, patch: Partial<PipelineState>): PipelineState {
	return { ...prev, ...patch };
}

/**
 * Execute a streaming phase with full lifecycle management (start, stream, complete, error).
 * Returns the updated pipeline state and stream result metadata.
 */
async function executeStreamingPhase(
	phaseName: PhaseName,
	state: PipelineState,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	callbacks: PipelineCallbacks,
	buildStateUpdate: (streamState: StreamState) => Partial<PipelineState>
): Promise<{ state: PipelineState; streamState: StreamState; metadata: StreamResultMetadata }> {
	state = updateState(state, { currentPhase: phaseName });
	callbacks.onPhaseStart(phaseName);
	try {
		const result = await runStreamingPhase(phaseName, systemPrompt, messages, providerConfig, abortSignal, tools, callbacks);
		state = updateState(state, buildStateUpdate(result.state));
		callbacks.onPhaseComplete(phaseName, state);
		return { state, streamState: result.state, metadata: result.metadata };
	} catch (err: unknown) {
		callbacks.onError(phaseName, err);
		throw err;
	}
}

/**
 * Run a single streaming phase and return the accumulated stream state.
 */
async function runStreamingPhase(
	phaseName: PhaseName,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	callbacks: PipelineCallbacks
): Promise<{ state: StreamState; metadata: StreamResultMetadata }> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	const accumulator = await streamChatResponse(
		systemPrompt,
		messages,
		abortSignal,
		(streamState: StreamState) => {
			callbacks.onPhaseStream(phaseName, streamState);
		},
		(err: unknown) => {
			throw err instanceof Error ? err : new Error(String(err));
		},
		providerConfig,
		tools
	);

	const metadata = await accumulator.resultMetadata;
	return { state: accumulator.state, metadata };
}

/**
 * Run a single non-streaming phase (e.g., Summarizer) and return the generated text.
 */
async function runNonStreamingPhase(
	phaseName: string,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal
): Promise<string> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	const model = createModel(providerConfig);
	const result = await generateText({
		model,
		messages,
		system: systemPrompt,
		abortSignal,
	});

	return result.text;
}

/**
 * Run the full narrative generation pipeline.
 *
 * Phases run sequentially 1-4, then Game Master, Summarizer, and Memory run in parallel.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineState & { editorMetadata?: StreamResultMetadata }> {
	const {
		providerConfigs,
		systemPrompt,
		generalInstructions,
		worldContent,
		actPlot,
		actSummary,
		history,
		abortSignal,
		tools,
		callbacks,
		memoryRunner,
		completedScenes,
	} = input;

	let state: PipelineState = { currentPhase: null };
	let editorMetadata: StreamResultMetadata | undefined;
	const writerTemplate = await loadWriterOutputTemplate();

	// --- Phase 1: Plot Planner ---
	{
		const plotPlannerSystem = [
			systemPrompt,
			generalInstructions,
			await loadPlotPlannerPrompt(),
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Act Summary\n' + actSummary,
		].join('\n\n');

		const result = await executeStreamingPhase(
			'PLOT_PLANNER',
			state,
			plotPlannerSystem,
			history,
			providerConfigs.plotPlanner,
			abortSignal,
			tools,
			callbacks,
			(ss) => ({ scenePlot: ss.content })
		);
		state = result.state;
	}

	// --- Phase 2: Writer ---
	{
		const writerPromptContent = await loadWriterPrompt();
		const writerSystem = [
			systemPrompt,
			generalInstructions,
			writerPromptContent,
			'\n## Writer Output Template\n' + writerTemplate,
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Act Summary\n' + actSummary,
			'\n## Scene Plot\n' + (state.scenePlot ?? ''),
		].join('\n\n');

		const result = await executeStreamingPhase(
			'WRITER',
			state,
			writerSystem,
			history,
			providerConfigs.writer,
			abortSignal,
			undefined,
			callbacks,
			(ss) => ({ writerOutput: ss.content })
		);
		state = result.state;
	}

	// --- Phase 3: Reviewer ---
	{
		const reviewerPromptContent = await loadReviewerPrompt();
		const reviewerSystem = [
			generalInstructions,
			reviewerPromptContent,
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Act Summary\n' + actSummary,
			'\n## Scene Plot\n' + (state.scenePlot ?? ''),
			'\n## Writer Output\n' + (state.writerOutput ?? ''),
		].join('\n\n');

		const reviewerMessages: MessageBase[] = [
			{ role: 'user' as const, content: 'Review the Writer Output above against the General Instructions and Review Rules.' },
		];

		const result = await executeStreamingPhase(
			'REVIEWER',
			state,
			reviewerSystem,
			reviewerMessages,
			providerConfigs.reviewer,
			abortSignal,
			tools,
			callbacks,
			(ss) => ({ reviewerOutput: ss.content })
		);
		state = result.state;
	}

	// --- Phase 4: Editor ---
	{
		const editorPromptContent = await loadEditorPrompt();
		const editorSystem = [
			generalInstructions,
			editorPromptContent,
			'\n## Writer Output Template\n' + writerTemplate,
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Act Summary\n' + actSummary,
			'\n## Scene Plot\n' + (state.scenePlot ?? ''),
			'\n## Writer Output\n' + (state.writerOutput ?? ''),
			'\n## Reviewer Output\n' + (state.reviewerOutput ?? ''),
		].join('\n\n');

		const editorMessages: MessageBase[] = [
			{
				role: 'user' as const,
				content: 'Revise the Writer Output based on the Reviewer Output. Fix all flagged violations with minimal changes.',
			},
		];

		const result = await executeStreamingPhase(
			'EDITOR',
			state,
			editorSystem,
			editorMessages,
			providerConfigs.editor,
			abortSignal,
			undefined,
			callbacks,
			(ss) => ({
				editorOutput: ss.content,
				editorVariables: ss.variables,
				editorReasoning: ss.reasoning,
			})
		);
		state = result.state;
		editorMetadata = result.metadata;
	}

	// --- Phase 5 & 6: Game Master + Summarizer (parallel) + Memory (fire-and-forget) ---
	callbacks.onPhaseStart('GAME_MASTER');
	callbacks.onPhaseStart('SUMMARIZER');

	const gmPromise = (async (): Promise<{ content: string; streamState: StreamState }> => {
		const gmPromptContent = await loadGameMasterPrompt();
		const gmSystem = [
			gmPromptContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Act Summary\n' + actSummary,
			'\n## Scene Plot\n' + (state.scenePlot ?? ''),
			'\n## Editor Output\n' + (state.editorOutput ?? ''),
		].join('\n\n');

		const gmMessages: MessageBase[] = [{ role: 'user' as const, content: 'Generate game data from the Editor Output above.' }];

		const result = await runStreamingPhase(
			'GAME_MASTER',
			gmSystem,
			gmMessages,
			providerConfigs.gameMaster,
			abortSignal,
			undefined,
			callbacks
		);

		return { content: result.state.content, streamState: result.state };
	})();

	const summarizerPromise = (async (): Promise<string> => {
		const summarizerPromptContent = await loadSummarizerPrompt();
		let summaryTemplate = await loadActSummaryTemplate();

		// Inject programmatic completed scenes count
		if (completedScenes != null) {
			summaryTemplate = summaryTemplate.replaceAll('{completedScenes}', String(completedScenes));
		}

		const summarizerSystem = [
			summarizerPromptContent,
			'\n## Act Summary Template\n' + summaryTemplate,
			'\n## Previous Act Summary\n' + actSummary,
			'\n## Editor Output\n' + (state.editorOutput ?? ''),
		].join('\n\n');

		const summarizerMessages: MessageBase[] = [{ role: 'user' as const, content: 'Update the Act Summary based on the new scene.' }];

		return runNonStreamingPhase('SUMMARIZER', summarizerSystem, summarizerMessages, providerConfigs.summarizer, abortSignal);
	})();

	// Fire-and-forget memory runner in parallel
	if (memoryRunner) {
		memoryRunner();
	}

	const results = await Promise.allSettled([gmPromise, summarizerPromise]);

	// Handle GM result
	if (results[0].status === 'fulfilled') {
		const gmResult = results[0].value;
		const gmVariables = gmResult.streamState.variables;
		state = updateState(state, {
			gameMasterOutput: gmResult.content,
			gameData: gmVariables?.gameData ?? null,
		});
		callbacks.onPhaseComplete('GAME_MASTER', state);
	} else {
		callbacks.onError('GAME_MASTER', results[0].reason);
	}

	// Handle Summarizer result
	if (results[1].status === 'fulfilled') {
		state = updateState(state, { actSummary: results[1].value });
		callbacks.onPhaseComplete('SUMMARIZER', state);
	} else {
		callbacks.onError('SUMMARIZER', results[1].reason);
		// Summarizer failure is non-fatal — the act summary is not essential to the immediate response
	}

	// Throw if GM failed (essential game data)
	if (results[0].status === 'rejected') {
		throw results[0].reason;
	}

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);

	return { ...state, editorMetadata };
}
