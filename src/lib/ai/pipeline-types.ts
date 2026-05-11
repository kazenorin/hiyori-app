import type { PhaseName, UIScenePhase } from './narrative-types';
import type { NarrativeVariables, GameDataFields } from './narrative-types';

// Re-export for consumers that import from pipeline-types
export type { PhaseName, UIScenePhase };

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

export interface AsyncPhaseResults {
	actSummary?: string;
}
