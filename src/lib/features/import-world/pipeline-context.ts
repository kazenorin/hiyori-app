import type { PreEditorContext } from '$lib/ai/pipeline/message-builder';
import type { PipelineRunContext } from '$lib/ai/pipeline/runners';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import type { RetryConfig } from '$lib/ai/chat-stream';

export const EMPTY_PRE_EDITOR_CONTEXT: PreEditorContext = {
	worldContent: '',
	actPlot: '',
	actSummary: '',
	previousScenePlot: undefined,
	previousNarrativeBody: undefined,
	completedScenes: 0,
	player: undefined,
	previousTurnOfEvents: undefined,
	directorNotes: '',
};

export function buildImportRunContext(
	retryConfig: RetryConfig,
	abortSignal: AbortSignal,
	callbacks: PipelineRunContext['sharedParams']['callbacks'],
	prompts: Partial<PipelineRunContext['prompts']>
): PipelineRunContext {
	return {
		sharedParams: {
			abortSignal,
			callbacks,
			retryConfig: { retryCount: retryConfig.retryCount, backoffIntervalSeconds: retryConfig.backoffIntervalSeconds },
		},
		providerConfigs: buildPipelineProviderConfigs(),
		preEditorCtx: EMPTY_PRE_EDITOR_CONTEXT,
		prompts: {
			gameMasterSystemPrompt: '',
			generalInstructions: '',
			writerOutputTemplate: '',
			reviewerPrompt: '',
			writerSystemPrompt: '',
			editorSystemPrompt: '',
			plotPlannerSystemPrompt: '',
			phaseEventPlotPlannerSystemPrompt: '',
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			...prompts,
		},
		effectiveTargetWordCount: '400',
		currentScene: '1',
		tools: undefined,
		plotMode: 'guidance',
		actPhase: undefined,
		lastPlotGeneration: undefined,
		reevaluationFrequency: 1,
	};
}
