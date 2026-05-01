import type { PhaseName, UIScenePhase } from './narrative-types';

// Re-export for consumers that import from pipeline-types
export type { PhaseName, UIScenePhase };

export interface PipelineState {
	currentPhase: PhaseName | null;
	scenePlot?: string;
	writerOutput?: string;
	reviewerOutput?: string;
	editorOutput?: string;
	gameMasterOutput?: string;
	actSummary?: string;
}

export interface PipelineCallbacks {
	onPhaseStart: (phase: PhaseName) => void;
	onPhaseUpdate: (state: PipelineState) => void;
	onPhaseComplete: (phase: PhaseName, state: PipelineState) => void;
	onError: (phase: PhaseName, error: unknown) => void;
	onAllComplete: (state: PipelineState) => void;
}