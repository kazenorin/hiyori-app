import type { PipelineRunContext } from '$lib/ai/pipeline/runners';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import type { RetryConfig } from '$lib/ai/chat-stream';
import type { AssistantContext, PreEditorContext, StoryContext } from '$lib/ai/pipeline/types';

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
	previousActSummaries: [],
	actNumber: 1,
};

const IMPORT_STORY_CONTEXT: StoryContext = {
	storyId: '',
	storyName: '',
	actLine: {
		id: '',
		actId: '',
		name: '',
		isMainLine: true,
		createdAt: 0,
		plotMode: 'guidance',
		currentActPhase: null,
		lastPlotGeneration: null,
		actNumber: 1,
	},
};

const IMPORT_ASSISTANT_CONTEXT: AssistantContext = {
	messageId: '',
	messageSequence: 0,
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
		story: IMPORT_STORY_CONTEXT,
		assistant: IMPORT_ASSISTANT_CONTEXT,
	};
}
