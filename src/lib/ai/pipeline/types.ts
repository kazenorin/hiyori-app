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
	story: StoryContext;
	assistant: AssistantContext;
	completedScenes: number;
	directorNotes: string;
	previousNarrativeVariables: NarrativeVariables | undefined;
	/**
	 * The CURRENT act's latest summary (as of `completedScenes`), consumed by the async
	 * Summarizer. Not derivable from `previousActSummaries` (prior acts) or from
	 * `context.actSummaryAtSP` (the current act, frozen at the older summarization point).
	 */
	latestActSummary: string;
	/** Main runs pass the plot that plans the upcoming scene; undefined for the epilogue. */
	previousScenePlot?: string;
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
	/** Shared prompt-prefix context (Tiers 0–2) reused byte-identically by every phase. */
	context: PipelineContext;
}

export interface PipelineInput extends CommonPipelineInput {
	player?: PlayerContext;
}

export interface PipelineResult {
	state: PipelineState;
	aggregatedMetadata?: StreamResultMetadata;
	phases?: PhaseMetadata[];
	asyncPhases?: Promise<AsyncPhaseResults>;
}
/**
 * Shared prompt-prefix context (Tiers 0–2), assembled once per run by the run manager
 * and reused byte-identically by every phase so their request prefixes are cache-stable.
 */
export interface PipelineContext {
	// --- Tier 0: Main Context (frozen for the act) ---
	/** World document content. */
	worldContent: string;
	/** Act plot markdown for the current act. */
	actPlot: string;
	/** Short summaries of PRIOR acts (the "Story So Far" section), by act number. Excludes the current act. */
	previousActSummaries: { actNumber: number; summary: string }[];
	// --- Tier 1: Summaries (frozen until the summarization point advances) ---
	/**
	 * The last SCENE NUMBER (within the current act) covered by the frozen Summaries snapshot:
	 * `floor(currentScene / interval) * interval`. This is a scene number, not a message sequence.
	 * `0` means no summarization point has been reached, so the Summaries message is omitted.
	 */
	summarizationPoint: number;
	/** Latest character profiles; per-scene details at or before `summarizationPoint` are truncated. */
	characterProfiles: string[];
	/**
	 * The CURRENT act's summary, frozen as of `summarizationPoint` (scene ≤ SP). Distinct from
	 * `previousActSummaries` (prior acts) and `CommonPipelineInput.latestActSummary` (current act,
	 * as of now); not derivable from either.
	 */
	actSummaryAtSP: string;
	// --- Tier 2: Scenes (append-only since the summarization point) ---
	/** Raw scene blocks (title / background / narrative / turn-of-events, with folded player responses). */
	scenesSections: string[];
	/**
	 * The Scene Plot planning the scene being generated, emitted as its own `# Upcoming Scene Plot`
	 * message after Scenes. Volatile (may change every few turns), so it sits outside the append-only Scenes
	 * block. Absent for reduced-scope contexts (e.g. headless regeneration) and the first planning pass.
	 */
	upcomingScenePlot?: string;
}
