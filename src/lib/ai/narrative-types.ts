/** Structured game data extracted from ## Game Data section */
export interface GameDataFields {
	activePlotThreads: string[];
	decisionContext: string | null;
	decisions: string[];
}

/** Phase names for multi-phase narrative generation. EDITOR is excluded from the `phases: UIScenePhase[]` array on UIMessage — its output is stored in top-level UIMessage fields instead. */
export type PhaseName = 'PLOT_PLANNER' | 'WRITER' | 'REVIEWER' | 'EDITOR' | 'TEMPLATE_FITTER' | 'GAME_MASTER' | 'SUMMARIZER';

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
	cg: string | null;
	gameData: GameDataFields | null;
}

// --- Field descriptors ---

/** Describes a single NarrativeVariables field for use in parsing, serialization, and validation. */
export interface FieldDescriptor {
	/** Property name in NarrativeVariables */
	fieldName: keyof NarrativeVariables;
	/** Exact casing of the markdown header as it appears in LLM output */
	headerName: string;
	/** Parent section header names, outermost to innermost. Empty for top-level ## sections. */
	parentSections: string[];
	/** Whether this field appears in LLM history serialization */
	includeInSerialization: boolean;
}

/** Single source of truth for all narrative variable fields (excluding gameData). */
export const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
	{ fieldName: 'sceneTitle', headerName: 'Scene title', parentSections: [], includeInSerialization: true },
	{ fieldName: 'background', headerName: 'Background', parentSections: [], includeInSerialization: true },
	{ fieldName: 'narrativeBody', headerName: 'Narrative Body', parentSections: [], includeInSerialization: true },
	{ fieldName: 'cg', headerName: 'CG', parentSections: [], includeInSerialization: true },
];

// --- Derived field lists ---

/** Canonical list of all NarrativeVariables keys (excluding gameData). Derived from FIELD_DESCRIPTORS. */
export const NARRATIVE_VARIABLE_FIELDS: (keyof NarrativeVariables)[] = FIELD_DESCRIPTORS.map((d) => d.fieldName);

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
		cg: null,
		gameData: null,
	};
}

/** Format a PhaseName for display (e.g., 'PLOT_PLANNER' → 'Plot Planner'). */
export function formatPhaseName(name: PhaseName): string {
	return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
