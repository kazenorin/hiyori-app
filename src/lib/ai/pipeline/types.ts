import type { ActPhase, GameDataFields, NarrativeVariables, PhaseName } from '../narrative-types';
import type { StreamResultMetadata } from '../streaming';
import type { ActSummary } from '../act-summary-parser';
import type { ToolSet } from 'ai';
import type { PhaseMetadata, RetryConfig } from '../chat-stream';
import type { ProviderConfig } from '$lib/stores/settings.svelte';
import type { ActLineMeta, ActPhaseBoundary } from '$lib/db/act-lines';

export interface ActLineContext extends ActLineMeta {
	currentActPhase: ActPhase | null;
	actPhaseBoundaries: ActPhaseBoundary[];
	lastPlotGeneration: number | null;
	actNumber: number;
	currentActPhaseLengthEstimate: number | null;
	currentScene: number | null;
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
	/**
	 * Called after every completed phase step with the latest accumulated
	 * state and phase metadata entries. Used to persist a resumable phase
	 * cache. Failures are logged by the pipeline and never fatal.
	 */
	onPhaseCommit?: (state: PipelineState, phases: PhaseMetadata[]) => void | Promise<void>;
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
	/**
	 * Resume support: outputs of phases completed by an earlier (interrupted)
	 * run. Phases whose output already exists are skipped; see the resume
	 * gates in the pipeline README.
	 */
	initialState?: PipelineState;
	/** Phase metadata entries from the earlier run, seeded into the tracker. */
	initialPhases?: PhaseMetadata[];
	/** Shared-prefix context (Tiers 0–2) reused by every phase this run. */
	context: PipelineContext;
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
	actPhaseBoundaries: ActPhaseBoundary[];
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
	actPhaseBoundaries: ActPhaseBoundary[];
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

/**
 * Shared context (Tiers 0–2), assembled once per run and reused by every phase so
 * their request prefixes are byte-identical for prompt caching.
 */
export interface PipelineContext {
	// Tier 0 — Main Context (frozen for the act)
	worldContent: string;
	actPlot: string;
	previousActSummaries: { actNumber: number; summary: string }[];
	actNumber: number;
	// Tier 1 — Summaries (frozen until the SP advances)
	summarizationPoint: number;
	characterProfiles: string[]; // formatted, as of SP
	actSummary: string; // as of SP
	// Tier 2 — Scenes (append-only)
	scenesSections: string[];
}

export type PreEditorContextFactory = new (input: CommonPipelineInput) => PreEditorContext;
