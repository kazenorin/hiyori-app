import type { PipelinePrompts, PipelineRunContext } from '$lib/ai/pipeline/runners';
import { buildPipelineProviderConfigs } from '$lib/ai/chat/pipeline-config';
import type { RetryConfig } from '$lib/ai/chat-stream';
import type { AssistantContext, PipelineCallbacks, PipelineContext, StoryContext } from '$lib/ai/pipeline/types';
import { createNarrativeOverrides } from '$lib/ai/narrative-types';

export const EMPTY_PIPELINE_CONTEXT: PipelineContext = {
	worldContent: '',
	actPlot: '',
	previousActSummaries: [],
	summarizationPoint: 0,
	characterProfiles: [],
	actSummaryAtSP: '',
	scenesSections: [],
	plotMode: 'guidance',
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
		actPhaseBoundaries: [],
		lastPlotGeneration: null,
		actNumber: 1,
		currentActPhaseLengthEstimate: null,
		currentScene: null,
	},
};

const IMPORT_ASSISTANT_CONTEXT: AssistantContext = {
	messageId: '',
	messageSequence: 0,
};

export function buildImportRunContext(
	retryConfig: RetryConfig,
	abortSignal: AbortSignal,
	callbacks: PipelineCallbacks,
	prompts: Partial<PipelinePrompts>,
	overrides: {
		story?: StoryContext;
		currentScene?: string;
		context?: PipelineContext;
		completedScenes?: number;
		directorNotes?: string;
		previousScenePlot?: string;
		previousTurnOfEvents?: string;
	} = {}
): PipelineRunContext {
	return {
		sharedParams: {
			abortSignal,
			callbacks,
			retryConfig: { retryCount: retryConfig.retryCount, backoffIntervalSeconds: retryConfig.backoffIntervalSeconds },
		},
		providerConfigs: buildPipelineProviderConfigs(),
		prompts: {
			generalInstructions: '',
			mainChatSystemPrompt: '',
			writerOutputTemplate: '',
			writerRole: '',
			guidanceWriterExtractionPrompt: '',
			phaseEventWriterExtractionPrompt: '',
			epilogueWriterExtractionPrompt: '',
			reviewerExtractionPrompt: '',
			quickReviewerExtractionPrompt: '',
			editorExtractionPrompt: '',
			guidancePlotPlannerExtractionPrompt: '',
			phaseEventPlotPlannerExtractionPrompt: '',
			guidanceGameMasterExtractionPrompt: '',
			phaseEventGameMasterExtractionPrompt: '',
			...prompts,
		},
		effectiveTargetWordCount: '400',
		currentScene: overrides.currentScene ?? '1',
		completedScenes: overrides.completedScenes ?? 0,
		directorNotes: overrides.directorNotes ?? '',
		previousScenePlot: overrides.previousScenePlot,
		previousTurnOfEvents: overrides.previousTurnOfEvents,
		tools: undefined,
		story: overrides.story ?? IMPORT_STORY_CONTEXT,
		assistant: IMPORT_ASSISTANT_CONTEXT,
		narrativeOverrides: createNarrativeOverrides(),
		context: overrides.context ?? EMPTY_PIPELINE_CONTEXT,
	};
}
