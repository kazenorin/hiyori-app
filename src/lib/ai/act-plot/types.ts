import type { ActPlotPhase } from '#lib/ai/act-plot/act-plot-generator.ts';
import type { ActLineMeta } from '#lib/db/act-lines.ts';
import type { Story } from '#lib/db/stories.ts';

export interface EnsureActPlotParams {
	story: Story;
	actLine: ActLineMeta;
	isResumeGame?: boolean;
	onStartGenerate?: () => void;
	onPhaseChange?: (phase: ActPlotPhase) => void;
	onGenerationComplete?: () => void;

	worldContent?: string;
	actNumber?: number;
	useDetailedContext?: boolean;

	abortSignal?: AbortSignal;
}
