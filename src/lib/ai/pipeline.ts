import type { ToolSet } from 'ai';
import { generateText } from 'ai';
import type { MessageBase } from '$lib/db/messages';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import { streamChatResponse } from './chat-stream';
import { createModel } from './provider';
import type { PhaseName } from './narrative-types';
import type { PipelineState, PipelineCallbacks } from './pipeline-types';

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
	userMessage: string;
	history: MessageBase[];
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
}

function updateState(prev: PipelineState, patch: Partial<PipelineState>): PipelineState {
	return { ...prev, ...patch };
}

/**
 * Run a single streaming phase and return the accumulated content.
 */
async function runStreamingPhase(
	phaseName: PhaseName,
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal,
	tools: ToolSet | undefined,
	onStateUpdate: (state: PipelineState) => void,
	currentState: PipelineState
): Promise<string> {
	if (!providerConfig) {
		throw new Error(`No provider configured for ${phaseName}. Please set one in Settings.`);
	}

	const accumulator = await streamChatResponse(
		systemPrompt,
		messages,
		abortSignal,
		(_streamState) => {
			onStateUpdate(currentState);
		},
		(err: unknown) => {
			throw err instanceof Error ? err : new Error(String(err));
		},
		providerConfig,
		tools
	);

	return accumulator.state.content;
}

/**
 * Run a single non-streaming phase (e.g., Summarizer) and return the generated text.
 */
async function runNonStreamingPhase(
	systemPrompt: string,
	messages: MessageBase[],
	providerConfig: ProviderConfig | undefined,
	abortSignal: AbortSignal
): Promise<string> {
	if (!providerConfig) {
		throw new Error('No provider configured for SUMMARIZER. Please set one in Settings.');
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
 * Phases run sequentially 1-4, then Game Master and Summarizer run in parallel.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineState> {
	const {
		providerConfigs,
		systemPrompt,
		generalInstructions,
		worldContent,
		actPlot,
		actSummary,
		userMessage,
		history,
		abortSignal,
		tools,
		callbacks,
	} = input;

	let state: PipelineState = { currentPhase: null };

	// --- Phase 1: Plot Planner ---
	state = updateState(state, { currentPhase: 'PLOT_PLANNER' });
	callbacks.onPhaseStart('PLOT_PLANNER');

	try {
		const plotPlannerSystem = [
			systemPrompt,
			generalInstructions,
			await (await import('$lib/fs/prompts')).loadPlotPlannerPrompt(),
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
		].join('\n\n');

		const plotPlannerMessages: MessageBase[] = [
			...history,
			{ role: 'user' as const, content: userMessage },
		];

		const scenePlot = await runStreamingPhase(
			'PLOT_PLANNER',
			plotPlannerSystem,
			plotPlannerMessages,
			providerConfigs.plotPlanner,
			abortSignal,
			tools,
			(state: PipelineState) => callbacks.onPhaseUpdate(state),
			state
		);

		state = updateState(state, { scenePlot });
		callbacks.onPhaseComplete('PLOT_PLANNER', state);
	} catch (err: unknown) {
		callbacks.onError('PLOT_PLANNER', err);
		throw err;
	}

	// --- Phase 2: Writer ---
	state = updateState(state, { currentPhase: 'WRITER' });
	callbacks.onPhaseStart('WRITER');

	try {
		const writerPromptContent = await (await import('$lib/fs/prompts')).loadWriterPrompt();
		const writerTemplate = await (await import('$lib/fs/prompts')).loadWriterOutputTemplate();
		const writerSystem = [
			systemPrompt,
			generalInstructions,
			writerPromptContent,
			'\n## Writer Output Template\n' + writerTemplate,
			'\n## World Content\n' + worldContent,
			'\n## Act Plot\n' + actPlot,
			'\n## Scene Plot\n' + (state.scenePlot ?? ''),
		].join('\n\n');

		const writerMessages: MessageBase[] = [
			...history,
			{ role: 'user' as const, content: userMessage },
		];

		const writerOutput = await runStreamingPhase(
			'WRITER',
			writerSystem,
			writerMessages,
			providerConfigs.writer,
			abortSignal,
			undefined,
			(state: PipelineState) => callbacks.onPhaseUpdate(state),
			state
		);

		state = updateState(state, { writerOutput });
		callbacks.onPhaseComplete('WRITER', state);
	} catch (err: unknown) {
		callbacks.onError('WRITER', err);
		throw err;
	}

	// --- Phase 3: Reviewer ---
	state = updateState(state, { currentPhase: 'REVIEWER' });
	callbacks.onPhaseStart('REVIEWER');

	try {
		const reviewerPromptContent = await (await import('$lib/fs/prompts')).loadReviewerPrompt();
		const reviewerSystem = [
			generalInstructions,
			reviewerPromptContent,
			'\n## Writer Output\n' + (state.writerOutput ?? ''),
		].join('\n\n');

		const reviewerMessages: MessageBase[] = [
			{ role: 'user' as const, content: 'Review the Writer Output above against the General Instructions and Review Rules.' },
		];

		const reviewerOutput = await runStreamingPhase(
			'REVIEWER',
			reviewerSystem,
			reviewerMessages,
			providerConfigs.reviewer,
			abortSignal,
			tools,
			(state: PipelineState) => callbacks.onPhaseUpdate(state),
			state
		);

		state = updateState(state, { reviewerOutput });
		callbacks.onPhaseComplete('REVIEWER', state);
	} catch (err: unknown) {
		callbacks.onError('REVIEWER', err);
		throw err;
	}

	// --- Phase 4: Editor ---
	state = updateState(state, { currentPhase: 'EDITOR' });
	callbacks.onPhaseStart('EDITOR');

	try {
		const editorPromptContent = await (await import('$lib/fs/prompts')).loadEditorPrompt();
		const writerTemplate = await (await import('$lib/fs/prompts')).loadWriterOutputTemplate();
		const editorSystem = [
			generalInstructions,
			editorPromptContent,
			'\n## Writer Output Template\n' + writerTemplate,
			'\n## Writer Output\n' + (state.writerOutput ?? ''),
			'\n## Reviewer Output\n' + (state.reviewerOutput ?? ''),
		].join('\n\n');

		const editorMessages: MessageBase[] = [
			{ role: 'user' as const, content: 'Revise the Writer Output based on the Reviewer Output. Fix all flagged violations with minimal changes.' },
		];

		const editorOutput = await runStreamingPhase(
			'EDITOR',
			editorSystem,
			editorMessages,
			providerConfigs.editor,
			abortSignal,
			undefined,
			(state: PipelineState) => callbacks.onPhaseUpdate(state),
			state
		);

		state = updateState(state, { editorOutput });
		callbacks.onPhaseComplete('EDITOR', state);
	} catch (err: unknown) {
		callbacks.onError('EDITOR', err);
		throw err;
	}

	// --- Phase 5 & 6: Game Master + Summarizer (parallel) ---
	state = updateState(state, { currentPhase: 'GAME_MASTER' });
	callbacks.onPhaseStart('GAME_MASTER');

	const gmPromise = (async (): Promise<string> => {
		const gmPromptContent = await (await import('$lib/fs/prompts')).loadGameMasterPrompt();
		const gmSystem = [
			gmPromptContent,
			'\n## Editor Output\n' + (state.editorOutput ?? ''),
		].join('\n\n');

		const gmMessages: MessageBase[] = [
			{ role: 'user' as const, content: 'Generate game data from the Editor Output above.' },
		];

		return runStreamingPhase(
			'GAME_MASTER',
			gmSystem,
			gmMessages,
			providerConfigs.gameMaster,
			abortSignal,
			undefined,
			(state: PipelineState) => callbacks.onPhaseUpdate(state),
			state
		);
	})();

	const summarizerPromise = (async (): Promise<string> => {
		const summarizerPromptContent = await (await import('$lib/fs/prompts')).loadSummarizerPrompt();
		const summaryTemplate = await (await import('$lib/fs/prompts')).loadActSummaryTemplate();
		const summarizerSystem = [
			summarizerPromptContent,
			'\n## Act Summary Template\n' + summaryTemplate,
			'\n## Previous Act Summary\n' + actSummary,
			'\n## Editor Output\n' + (state.editorOutput ?? ''),
		].join('\n\n');

		const summarizerMessages: MessageBase[] = [
			{ role: 'user' as const, content: 'Update the Act Summary based on the new scene.' },
		];

		return runNonStreamingPhase(
			summarizerSystem,
			summarizerMessages,
			providerConfigs.summarizer,
			abortSignal
		);
	})();

	try {
		const [gameMasterOutput, newActSummary] = await Promise.all([gmPromise, summarizerPromise]);

		state = updateState(state, { gameMasterOutput, actSummary: newActSummary });
		callbacks.onPhaseComplete('GAME_MASTER', state);
	} catch (err: unknown) {
		callbacks.onError('GAME_MASTER', err);
		throw err;
	}

	state = updateState(state, { currentPhase: null });
	callbacks.onAllComplete(state);

	return state;
}