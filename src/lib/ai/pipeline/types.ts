import type { ActPhase, GameDataFields, NarrativeVariables, PhaseName } from '../narrative-types';
import type { StreamResultMetadata } from '../streaming';
import type { ActSummary } from '../act-summary-parser';
import type { ToolSet } from 'ai';
import type { PhaseMetadata, RetryConfig } from '../chat-stream';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import type { ActLineMeta } from '$lib/db/act-lines';

export interface ActLineContext extends ActLineMeta {
	currentActPhase: ActPhase | null;
	lastPlotGeneration: number | null;
	actNumber: number;
}

export interface PipelineState {
	scenePlot?: string;
	writerOutput?: string;
	writerVariables?: NarrativeVariables | null;
	reviewerOutput?: string;
	editorOutput?: string;
	editorVariables?: NarrativeVariables | null;
	editorReasoning?: string | null;
	gameMasterOutput?: string;
	gameData?: GameDataFields | null;
	actSummary?: string;
}

/** Stream state for a single phase during streaming */
export interface PhaseStreamState {
	content: string;
	reasoning: string | null;
	variables: NarrativeVariables | null;
}

export interface PipelineCallbacks {
	onPhaseStart: (phase: PhaseName) => void;
	onPhaseStream: (phase: PhaseName, streamState: PhaseStreamState) => void;
	onPhaseRetry: (phase: PhaseName, attempt: number, maxAttempts: number) => void;
	onPhaseComplete: (phase: PhaseName, state: PipelineState) => void;
	onError: (phase: PhaseName, error: unknown) => void;
	onPhrasesExtracted?: (phrases: string[]) => void;
	onAllComplete: (state: PipelineState) => void;
}

export interface SummarizerResult {
	actSummary?: ActSummary;
	serializedSummary: string;
	metadata: StreamResultMetadata;
}

export interface CompressorResult {
	metadata: StreamResultMetadata;
}

export interface AsyncPhaseResults {
	actSummary?: string;
	summarizerMetadata?: StreamResultMetadata;
	compressorMetadata?: StreamResultMetadata;
}

/** Player response context. Both fields are present together or both absent. */
export interface PlayerContext {
	playerResponse: string;
	playerMessageId: string;
}

export interface PipelineProviderConfigs {
	plotPlanner: ProviderConfig | undefined;
	writer: ProviderConfig | undefined;
	reviewer: ProviderConfig | undefined;
	editor: ProviderConfig | undefined;
	gameMaster: ProviderConfig | undefined;
	summarizer: ProviderConfig | undefined;
	minorTaskAgent: ProviderConfig | undefined;
}

/** Story identification context. All fields are present together or all absent. */
export interface StoryContext {
	storyId: string;
	storyName: string;
	actLine: ActLineContext;
}

/** Assistant message identification for tool event recording. */
export interface AssistantContext {
	messageId: string;
	messageSequence: number;
}

export interface PipelineExecution {
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
}

export interface CommonPipelineInput {
	execution: PipelineExecution;
	worldContent: string;
	actPlot: string;
	actSummary: string;
	characterProfiles: string[];
	directorNotes: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	previousActSummaries: { actNumber: number; summary: string }[];
	story: StoryContext;
	assistant: AssistantContext;
	completedScenes: number;
	targetWordCount?: number;
	retryConfig?: RetryConfig;
}

export interface PipelineInput extends CommonPipelineInput {
	previousScenePlot?: string;
	player?: PlayerContext;
}

export interface PipelineResult {
	state: PipelineState;
	aggregatedMetadata?: StreamResultMetadata;
	phases?: PhaseMetadata[];
	asyncPhases?: Promise<AsyncPhaseResults>;
}
/** Context shared by Writer, Reviewer, and Editor phases. */
export interface PreEditorContext {
	worldContent: string;
	actPlot: string;
	actPhase?: ActPhase | null;
	actSummary: string;
	characterProfiles: string[];
	previousScenePlot: string | undefined;
	previousNarrativeBody: string | undefined;
	completedScenes: number;
	player: PlayerContext | undefined;
	previousTurnOfEvents: string | undefined;
	directorNotes: string;
	previousActSummaries: { actNumber: number; summary: string }[];
	actNumber: number;
}

/** Context shared by Game Master and Plot Planner phases. */
export interface PostEditorContext {
	actPlot: string;
	actPhase?: ActPhase | null;
	actSummary: string;
	characterProfiles: string[];
	previousScenePlot: string | undefined;
	previousNarrativeBody: string | undefined;
	completedScenes: number;
	player: PlayerContext | undefined;
	previousTurnOfEvents: string | undefined;
	editorOutput: string | undefined;
	directorNotes: string;
	previousActSummaries: { actNumber: number; summary: string }[];
	actNumber: number;
}

export type PreEditorContextFactory = new (input: CommonPipelineInput) => PreEditorContext;
