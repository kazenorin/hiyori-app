import type { PhaseName } from '../narrative-types';
import type { NarrativeVariables, GameDataFields, PlotMode } from '../narrative-types';
import type { StreamResultMetadata } from '../streaming';
import type {ActSummary, CharacterProfile} from '../act-summary-parser';
import type {ToolSet} from 'ai';
import type {PhaseMetadata, RetryConfig} from '../chat-stream';
import type {ProviderConfig} from '$lib/stores/settings.svelte';

export interface PipelineState {
	currentPhase: PhaseName | null;
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
	actSummary: ActSummary;
	serializedSummary: string;
	metadata: StreamResultMetadata;
	characterProfiles: CharacterProfile[];
	characterProfileLastScene: number;
}

export interface AsyncPhaseResults {
	actSummary?: string;
	summarizerMetadata?: StreamResultMetadata;
	compressorMetadata?: StreamResultMetadata;
	characterProfiles?: CharacterProfile[];
	characterProfileLastScene?: number;
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
	actLineId: string;
}

export interface PipelineExecution {
	providerConfigs: PipelineProviderConfigs;
	abortSignal: AbortSignal;
	tools?: ToolSet;
	callbacks: PipelineCallbacks;
}

export interface PipelineInput {
	execution: PipelineExecution;
	worldContent: string;
	actPlot: string;
	actPhase?: string | null;
	actSummary: string;
	directorNotes: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	previousScenePlot?: string;
	player?: PlayerContext;
	story?: StoryContext;
	completedScenes: number;
	targetWordCount?: number;
	retryConfig?: RetryConfig;
	plotMode?: PlotMode;
	lastPlotGeneration?: number | null;
	reevaluationFrequency?: number;
}

export interface PipelineResult {
	state: PipelineState;
	aggregatedMetadata?: StreamResultMetadata;
	phases?: PhaseMetadata[];
	asyncPhases?: Promise<AsyncPhaseResults>;
}
