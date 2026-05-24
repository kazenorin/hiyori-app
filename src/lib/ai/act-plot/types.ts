import type { ActPlotPhase } from '$lib/ai/act-plot/act-plot-generator';
import type { ActLineMeta } from '$lib/db/act-lines';
import type { Story } from '$lib/db/stories';

export interface EnsureActPlotParams {
	story: Story;
	actLine: ActLineMeta;
	isResumeGame?: boolean;
	onStartGenerate?: () => void;
	onPhaseChange?: (phase: ActPlotPhase) => void;
	onGenerationComplete?: () => void;

	worldContent?: string;
	actNumber?: number;

	abortSignal?: AbortSignal;
}
