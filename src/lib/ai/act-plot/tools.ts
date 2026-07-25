import { type ToolSet } from 'ai';
import { buildSceneTools } from '$lib/ai/tools/read-scene';
import { buildCharacterDetailsTools } from '$lib/ai/tools/character-details';
import { buildIntroduceCharacterTools } from '$lib/ai/tools/introduce-character';
import type { ToolContext } from '$lib/ai/tools/tools';

/** Phases that support tools within the act-plot pipeline. */
export type ActPlotToolPhase = 'writer' | 'reviewer';

/**
 * Maps each act-plot phase to the tool names it is allowed to use.
 * Editor is intentionally omitted — it runs tool-free.
 */
export const ACT_PLOT_PHASE_TOOLS: Record<ActPlotToolPhase, readonly string[]> = {
	writer: ['read-scene', 'read-distant-scene', 'introduce-character', 'character-details'],
	reviewer: ['read-scene', 'read-distant-scene', 'character-details'],
};

/** Filter a full ToolSet down to only the tools allowed for a given act-plot phase. */
export function filterActPlotToolsForPhase(allTools: ToolSet | undefined, phase: ActPlotToolPhase): ToolSet | undefined {
	if (!allTools) return undefined;
	const allowed = ACT_PLOT_PHASE_TOOLS[phase];
	const filtered: ToolSet = {};
	for (const name of allowed) {
		if (name in allTools) {
			filtered[name] = allTools[name];
		}
	}
	return Object.keys(filtered).length > 0 ? filtered : undefined;
}

export interface BuildActPlotToolsOptions {
	/** Include `read-distant-scene`; true when generating for act > 1. */
	includeDistant?: boolean;
	/** Include `character-details`; excluded when detailed context already provides character info. */
	includeCharacterDetails?: boolean;
}

/**
 * Build the tool set available to the act-plot writer/reviewer phases.
 * Composes only the tools relevant to act-plot generation, omitting the chat
 * pipeline's assistant-context-dependent tools (advance-phase, end-act, etc.).
 */
export function buildActPlotTools(ctx: ToolContext, options: BuildActPlotToolsOptions = {}): ToolSet {
	const { includeDistant = false, includeCharacterDetails = true } = options;

	const tools: ToolSet = {
		...buildSceneTools(ctx, includeDistant),
		...buildIntroduceCharacterTools(ctx),
	};

	if (includeCharacterDetails) {
		Object.assign(tools, buildCharacterDetailsTools(ctx));
	}

	return tools;
}
