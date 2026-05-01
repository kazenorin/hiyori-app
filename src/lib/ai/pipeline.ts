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

// Markdown section headings used in phase prompts
const SECTION = {
	WORLD_CONTENT: '\n## World Content\n',
	ACT_PLOT: '\n## Act Plot\n',
	ACT_SUMMARY: '\n## Act Summary\n',
	SCENE_PLOT: '\n## Scene Plot\n',
	WRITER_OUTPUT_TEMPLATE: '\n## Writer Output Template\n',
	WRITER_OUTPUT: '\n## Writer Output\n',
	REVIEWER_OUTPUT: '\n## Reviewer Output\n',
	EDITOR_OUTPUT: '\n## Editor Output\n',
	ACT_SUMMARY_TEMPLATE: '\n## Act Summary Template\n',
	PREVIOUS_ACT_SUMMARY: '\n## Previous Act Summary\n',
};

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
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
	memoryRunner?: (actSummary: string | undefined) => void;
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
 * Convert an array of content strings into user messages.
 */
function toUserMessages(contents: string[]): MessageBase[] {
	return contents.map((content) => ({ role: 'user' as const, content }));
}

/**
 * Run the full narrative generation pipeline.
 *
 * Phases run sequentially 1-4, then Game Master, Summarizer, and Memory run in parallel.
 * Context (world content, act plot, summaries, prior phase outputs) is passed as user messages,
 * not stuffed into the system prompt. The system prompt contains only persona and general instructions.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineState & { editorMetadata?: StreamResultMetadata }> {
	const {
		providerConfigs,
		systemPrompt,
		generalInstructions,
		worldContent,
		actPlot,
		actSummary,
		abortSignal,
		tools,
		callbacks,
		memoryRunner,
		completedScenes,
	} = input;

	const baseSystem = [systemPrompt, generalInstructions].join('\n\n');

	let state: PipelineState = { currentPhase: null };
	let editorMetadata: StreamResultMetadata | undefined;
	const writerTemplate = await loadWriterOutputTemplate();

	// --- Phase 1: Plot Planner ---
	{
		const plotPlannerPrompt = toUserMessages([
			await loadPlotPlannerPrompt(),
			SECTION.WORLD_CONTENT + worldContent,
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
		]);

		const result = await executeStreamingPhase(
			'PLOT_PLANNER',
			state,
			baseSystem,
			plotPlannerPrompt,
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
		const writerPrompt = toUserMessages([
			await loadWriterPrompt(),
			SECTION.WRITER_OUTPUT_TEMPLATE + writerTemplate,
			SECTION.WORLD_CONTENT + worldContent,
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
			SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
		]);

		const result = await executeStreamingPhase(
			'WRITER',
			state,
			baseSystem,
			writerPrompt,
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
		const reviewerPrompt = toUserMessages([
			await loadReviewerPrompt(),
			SECTION.WORLD_CONTENT + worldContent,
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
			SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
			SECTION.WRITER_OUTPUT + (state.writerOutput ?? ''),
		]);

		const result = await executeStreamingPhase(
			'REVIEWER',
			state,
			baseSystem,
			reviewerPrompt,
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
		const editorPrompt = toUserMessages([
			await loadEditorPrompt(),
			SECTION.WRITER_OUTPUT_TEMPLATE + writerTemplate,
			SECTION.WORLD_CONTENT + worldContent,
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
			SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
			SECTION.WRITER_OUTPUT + (state.writerOutput ?? ''),
			SECTION.REVIEWER_OUTPUT + (state.reviewerOutput ?? ''),
		]);

		const result = await executeStreamingPhase(
			'EDITOR',
			state,
			baseSystem,
			editorPrompt,
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
		const gmSystem = [systemPrompt, await loadGameMasterPrompt()].join('\n\n');

		const gmPrompt = toUserMessages([
			SECTION.ACT_PLOT + actPlot,
			SECTION.ACT_SUMMARY + actSummary,
			SECTION.SCENE_PLOT + (state.scenePlot ?? ''),
			SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
		]);

		const result = await runStreamingPhase(
			'GAME_MASTER',
			gmSystem,
			gmPrompt,
			providerConfigs.gameMaster,
			abortSignal,
			undefined,
			callbacks
		);

		return { content: result.state.content, streamState: result.state };
	})();

	const summarizerPromise = (async (): Promise<string> => {
		let summaryTemplate = await loadActSummaryTemplate();

		// Inject programmatic completed scenes count
		if (completedScenes != null) {
			summaryTemplate = summaryTemplate.replaceAll('{completedScenes}', String(completedScenes));
		}

		const summarizerSystem = [systemPrompt, await loadSummarizerPrompt()].join('\n\n');

		const summarizerPrompt = toUserMessages([
			SECTION.ACT_SUMMARY_TEMPLATE + summaryTemplate,
			SECTION.PREVIOUS_ACT_SUMMARY + actSummary,
			SECTION.EDITOR_OUTPUT + (state.editorOutput ?? ''),
		]);

		return runNonStreamingPhase('SUMMARIZER', summarizerSystem, summarizerPrompt, providerConfigs.summarizer, abortSignal);
	})();

	await Promise.all([
		// Handle GM result
		gmPromise
			.then((gmResult) => {
				const gmVariables = gmResult.streamState.variables;
				state = updateState(state, {
					gameMasterOutput: gmResult.content,
					gameData: gmVariables?.gameData ?? null,
				});
				callbacks.onPhaseComplete('GAME_MASTER', state);
			})
			.catch((reason) => {
				callbacks.onError('GAME_MASTER', reason);
				// Throw if GM failed (essential game data)
				throw reason;
			}),
		// Handle Summarizer result
		summarizerPromise
			.then((newActSummary) => {
				state = updateState(state, { actSummary: newActSummary });
				callbacks.onPhaseComplete('SUMMARIZER', state);

				// Fire-and-forget memory runner after summary is available
				if (memoryRunner) {
					memoryRunner(newActSummary);
				}
			})
			.catch((reason) => {
				callbacks.onError('SUMMARIZER', reason);
				// Summarizer failure is non-fatal — the act summary is not essential to the immediate response
			}),
	]);

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);

	return { ...state, editorMetadata };
}
