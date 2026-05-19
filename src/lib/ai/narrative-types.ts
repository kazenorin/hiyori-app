import { sceneTitleHeader, backgroundHeader, narrativeBodyHeader, turnOfEventsHeader, cgHeader } from '$lib/definitions/common-headers';

/** Structured game data extracted from ## Game Data section */
export interface GameDataFields {
	activePlotThreads: string[];
	decisionContext: string | null;
	decisions: string[];
}

/** Phase names for multi-phase narrative generation. EDITOR is excluded from the `phases: UIScenePhase[]` array on UIMessage — its output is stored in top-level UIMessage fields instead. */
export type PhaseName = 'PLOT_PLANNER' | 'WRITER' | 'REVIEWER' | 'EDITOR' | 'TEMPLATE_FITTER' | 'GAME_MASTER' | 'SUMMARIZER' | 'CHARACTER_PROFILE_COMPRESSOR';

/** A single phase within a UI scene, produced during streaming */
export interface UIScenePhase {
	phaseName: PhaseName;
	reasoning?: string;
	content: string;
}

/** All narrative variables with proper types per field */
export interface NarrativeVariables {
	sceneTitle: string | null;
	background: string | null;
	narrativeBody: string | null;
	turnOfEvents: string | null;
	cg: string | null;
	gameData: GameDataFields | null;
}

// --- Field descriptors ---

/** Describes a single NarrativeVariables field for use in parsing, serialization, and validation. */
export interface FieldDescriptor {
	/** Property name in NarrativeVariables */
	fieldName: keyof NarrativeVariables;
	/** Localized header name, resolved lazily via common-headers */
	headerName: () => string;
	/** Parent section header names, outermost to innermost. Empty for top-level ## sections. */
	parentSections: string[];
	/** Whether this field appears in LLM history serialization */
	includeInSerialization: boolean;
}

/** Single source of truth for all narrative variable fields (excluding gameData). */
export const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
	{ fieldName: 'sceneTitle', headerName: sceneTitleHeader, parentSections: [], includeInSerialization: true },
	{ fieldName: 'background', headerName: backgroundHeader, parentSections: [], includeInSerialization: true },
	{ fieldName: 'narrativeBody', headerName: narrativeBodyHeader, parentSections: [], includeInSerialization: true },
	{ fieldName: 'turnOfEvents', headerName: turnOfEventsHeader, parentSections: [], includeInSerialization: true },
	{ fieldName: 'cg', headerName: cgHeader, parentSections: [], includeInSerialization: true },
];

// --- Derived field lists ---

/** Canonical list of all NarrativeVariables keys (excluding gameData). Derived from FIELD_DESCRIPTORS. */
export const NARRATIVE_VARIABLE_FIELDS: (keyof NarrativeVariables)[] = FIELD_DESCRIPTORS.map((d) => d.fieldName);

// --- Assembly helpers ---

/** Assemble GameDataFields from a flat parsed result. */
function assembleGameData(result: Record<string, unknown>): GameDataFields | null {
	const threads = result.activePlotThreads as string[] | undefined;
	const context = result.decisionContext as string | undefined;
	const decisions = result.decisions as string[] | undefined;
	const hasAny = (threads && threads.length > 0) || context || (decisions && decisions.length > 0);
	if (!hasAny) return null;
	return {
		activePlotThreads: threads ?? [],
		decisionContext: context ?? null,
		decisions: decisions ?? [],
	};
}

/** Map a flat parseContent result to NarrativeVariables. */
export function assembleVariables(result: Record<string, unknown>): NarrativeVariables {
	return {
		sceneTitle: (result.sceneTitle as string) ?? null,
		background: (result.background as string) ?? null,
		narrativeBody: (result.narrativeBody as string) ?? null,
		turnOfEvents: (result.turnOfEvents as string) ?? null,
		cg: (result.cg as string) ?? null,
		gameData: assembleGameData(result),
	};
}

// --- Helpers ---

/** Type-safe setter for NarrativeVariables fields, bypassing the index signature constraint. */
export function setField(obj: NarrativeVariables, key: keyof NarrativeVariables, value: string | string[] | GameDataFields | null): void {
	(obj as unknown as Record<string, unknown>)[key] = value;
}

/** Create an empty GameDataFields. */
export function emptyGameDataFields(): GameDataFields {
	return {
		activePlotThreads: [],
		decisionContext: null,
		decisions: [],
	};
}

/** Create a NarrativeVariables with all fields set to null/empty. */
export function emptyVariables(): NarrativeVariables {
	return {
		sceneTitle: null,
		background: null,
		narrativeBody: null,
		turnOfEvents: null,
		cg: null,
		gameData: null,
	};
}

/** Format a PhaseName for display (e.g., 'PLOT_PLANNER' → 'Plot Planner'). */
export function formatPhaseName(name: PhaseName): string {
	return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Plot Mode and Act Phase ---

/** How the plot planner generates scene plots. */
export type PlotMode = 'guidance' | 'phaseEvent';

/** Narrative phases for event-based plot mode. */
export type ActPhase = 'introduction' | 'rising-action' | 'climax' | 'falling-action' | 'resolution';

/** Ordered phases for forward-only advancement. */
export const ACT_PHASE_ORDER: readonly ActPhase[] = ['introduction', 'rising-action', 'climax', 'falling-action', 'resolution'];

/** Index of a phase in ACT_PHASE_ORDER, or -1 if invalid. */
export function getActPhaseIndex(phase: string): number {
	return ACT_PHASE_ORDER.indexOf(phase as ActPhase);
}

/** Next phase after the current one, or null if at resolution. */
export function getNextActPhase(current: ActPhase): ActPhase | null {
	const idx = getActPhaseIndex(current);
	if (idx < 0 || idx >= ACT_PHASE_ORDER.length - 1) return null;
	return ACT_PHASE_ORDER[idx + 1];
}
