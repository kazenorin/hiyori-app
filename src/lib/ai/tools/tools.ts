import { buildMemoryTools } from '#lib/ai/tools/query-memories.ts';
import { buildInventoryTools } from '#lib/ai/tools/query-inventory.ts';
import { buildUpdateInventoryTools } from '#lib/ai/tools/update-inventory.ts';
import { buildActPlotTools } from '#lib/ai/tools/read-act-plot.ts';
import { buildSceneTools } from '#lib/ai/tools/read-scene.ts';
import { buildRiskTools } from '#lib/ai/tools/evaluate-risk.ts';
import { allowAdvancePhaseTools, buildAdvancePhaseTools } from '#lib/ai/tools/advance-phase.ts';
import { allowEndActTools, buildEndActTools } from '#lib/ai/tools/end-act.ts';
import { buildIntroduceCharacterTools } from '#lib/ai/tools/introduce-character.ts';
import { buildCharacterDetailsTools } from '#lib/ai/tools/character-details.ts';
import { buildSetSceneTitleTools } from '#lib/ai/tools/set-scene-title.ts';
import { buildSuggestCharacterNameTools } from '#lib/ai/tools/suggest-character-name.ts';
import { buildUpdateCharacterProfileTools } from '#lib/ai/tools/update-character-profile.ts';
import { getStory, type Story } from '#lib/db/stories.ts';
import type { ActLineContext, AssistantContext, ProfileCompressionState } from '#lib/ai/pipeline/types.ts';
import { getSceneCountInCurrentPhase, isActLineEnded } from '#lib/db/act-lines.ts';
import { type Act, getAct } from '#lib/db/acts.ts';
import { type ToolSet } from 'ai';
import { formatPhaseName, type NarrativeOverrides, type PhaseName, type ActPhase } from '#lib/ai/narrative-types.ts';
import { isInventoryAvailable } from '#lib/stores/settings.svelte.ts';
import { ls } from '#lib/localization/index.ts';
import { withPhaseGuards } from './phase-guard';

export interface ToolContext {
	story: Story;
	actLine: ActLineContext;
	act: Act;
}

/** Maps each pipeline phase to the tool names it is allowed to use. */
export const PHASE_TOOLS: Record<PhaseName, readonly string[]> = {
	SUMMARIZER: [],
	PLOT_PLANNER: ['read-scene', 'read-distant-scene', 'query-memories', 'query-inventory', 'character-details'],
	WRITER: [
		'read-scene',
		'read-distant-scene',
		'query-memories',
		'query-inventory',
		'evaluate-risk',
		'advance-phase',
		'end-act',
		'introduce-character',
		'character-details',
		'set-scene-title',
		'suggest-character-name',
	],
	REVIEWER: ['read-scene', 'read-distant-scene', 'query-memories', 'query-inventory', 'character-details'],
	EDITOR: [],
	TEMPLATE_FITTER: [],
	GAME_MASTER: ['read-scene', 'read-distant-scene', 'query-memories', 'query-inventory', 'update-inventory', 'character-details'],
	CHARACTER_PROFILE_COMPRESSOR: [],
};

/** Side-effecting tools whose no-op result is `{ result }` rather than a bare string. */
const RESULT_SHAPED_TOOLS: ReadonlySet<string> = new Set(['advance-phase', 'end-act', 'set-scene-title']);

function phaseGuardNoOp(phase: PhaseName) {
	return (name: string) => {
		const msg = ls('tools.guarded.notAllowed', { tool: name, phase: formatPhaseName(phase) });
		return RESULT_SHAPED_TOOLS.has(name) ? { result: msg } : msg;
	};
}

/**
 * Phase-gated view of the full tool superset: identical schema for every phase (so the
 * tool block stays inside the cacheable prefix), but side-effecting tools outside their
 * allowed phase no-op with a short explanatory message.
 */
export function guardToolsForPhase(allTools: ToolSet | undefined, phase: PhaseName): ToolSet | undefined {
	if (!allTools) return undefined;
	return withPhaseGuards(allTools, PHASE_TOOLS[phase], phaseGuardNoOp(phase));
}

/** Async compression phases: every tool outside the allow-list no-ops, read-only included (design D5). */
export function guardToolsForAsyncPhase(allTools: ToolSet | undefined, phase: PhaseName): ToolSet | undefined {
	if (!allTools) return undefined;
	return withPhaseGuards(allTools, PHASE_TOOLS[phase], phaseGuardNoOp(phase), true);
}

export async function buildTools(
	storyId: string,
	actLine: ActLineContext,
	assistant: AssistantContext,
	overrides: NarrativeOverrides,
	compression: ProfileCompressionState
): Promise<ToolSet | undefined> {
	const story = await getStory(storyId);

	if (!story) return undefined;

	const act = await getAct(actLine.actId);
	if (!act) return undefined;

	const ctx: ToolContext = { story, actLine, act };

	const includeDistantScene = act.actNumber > 1;

	const tools: ToolSet = {
		...buildMemoryTools(storyId, actLine.id),
		...buildInventoryTools(storyId, actLine.id, act.actNumber),
		...buildActPlotTools(ctx),
		...buildSceneTools(ctx, includeDistantScene),
		...buildRiskTools(ctx),
		...buildIntroduceCharacterTools(ctx),
		...buildCharacterDetailsTools(ctx),
		...buildSetSceneTitleTools(ctx, overrides),
		...buildSuggestCharacterNameTools(ctx),
		...buildUpdateCharacterProfileTools(ctx, compression),
	};

	if (isInventoryAvailable()) {
		Object.assign(tools, buildUpdateInventoryTools({ ...ctx, messageId: assistant.messageId }));
	}

	const currentPhase: ActPhase | null = actLine.currentActPhase;
	const ended = await isActLineEnded(actLine.id);
	const currentPhaseSceneCount = await getSceneCountInCurrentPhase(actLine.id);

	if (allowAdvancePhaseTools(actLine.plotMode, currentPhase, currentPhaseSceneCount, actLine.currentActPhaseLengthEstimate)) {
		Object.assign(tools, buildAdvancePhaseTools(actLine, assistant));
	}

	if (allowEndActTools(ended)) {
		Object.assign(tools, buildEndActTools(actLine.id, actLine.plotMode, currentPhase, ended, assistant));
	}

	return Object.keys(tools).length > 0 ? tools : undefined;
}
