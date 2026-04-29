/** Structured game data extracted from ## Game Data section */
export interface GameDataFields {
	worldState: string | null;
	decisions: string[]; // parsed from list items (ordered/unordered)
	playerAliases: string[]; // parsed from list items
	otherCharacterAliases: Record<string, string[]>; // character name → aliases
}

/** All narrative variables with proper types per field */
export interface NarrativeVariables {
	scratchpad: string | null;
	reviewScratchpad: string | null;
	storyTitle: string | null;
	actNumber: number | null;
	sessionNumber: number | null;
	sceneNumber: number | null;
	sceneTitle: string | null;
	background: string | null;
	narrativeBody: string | null;
	cg: string | null;
	currentContext: string | null;
	activePlotThreads: string[] | null;
	decisionContext: string | null;
	gameData: GameDataFields | null;
}

// --- Field descriptors ---

/** Describes a single NarrativeVariables field for use in parsing, serialization, and validation. */
export interface FieldDescriptor {
	/** Property name in NarrativeVariables */
	fieldName: keyof NarrativeVariables;
	/** Exact casing of the markdown header as it appears in LLM output */
	headerName: string;
	/** Whether this field is a number (parsed via parseInt, defaults to 1 in templates) */
	isNumber: boolean;
	/** Parent section header names, outermost to innermost. Empty for top-level ## sections. */
	parentSections: string[];
	/** Whether this field appears in LLM history serialization */
	includeInSerialization: boolean;
	/** Whether this field is a list type (parsed from list items, rendered as bullet list) */
	isList?: boolean;
}

/** Single source of truth for all narrative variable fields (excluding gameData). */
export const FIELD_DESCRIPTORS: readonly FieldDescriptor[] = [
	{ fieldName: 'scratchpad', headerName: 'Scratchpad', isNumber: false, parentSections: [], includeInSerialization: false },
	{ fieldName: 'reviewScratchpad', headerName: 'Review Scratchpad', isNumber: false, parentSections: [], includeInSerialization: false },
	{
		fieldName: 'storyTitle',
		headerName: 'Story Title',
		isNumber: false,
		parentSections: ['Story Information'],
		includeInSerialization: true,
	},
	{ fieldName: 'actNumber', headerName: 'Act Number', isNumber: true, parentSections: ['Story Information'], includeInSerialization: true },
	{
		fieldName: 'sessionNumber',
		headerName: 'Session number',
		isNumber: true,
		parentSections: ['Story Information'],
		includeInSerialization: true,
	},
	{
		fieldName: 'sceneNumber',
		headerName: 'Scene number',
		isNumber: true,
		parentSections: ['Story Information', 'Scene'],
		includeInSerialization: true,
	},
	{
		fieldName: 'sceneTitle',
		headerName: 'Scene title',
		isNumber: false,
		parentSections: ['Story Information', 'Scene'],
		includeInSerialization: true,
	},
	{ fieldName: 'background', headerName: 'Background', isNumber: false, parentSections: [], includeInSerialization: true },
	{ fieldName: 'narrativeBody', headerName: 'Narrative Body', isNumber: false, parentSections: [], includeInSerialization: true },
	{ fieldName: 'cg', headerName: 'CG', isNumber: false, parentSections: [], includeInSerialization: true },
	{
		fieldName: 'currentContext',
		headerName: 'Current Context',
		isNumber: false,
		parentSections: ['Status Update'],
		includeInSerialization: true,
	},
	{
		fieldName: 'activePlotThreads',
		headerName: 'Active Plot Threads',
		isNumber: false,
		isList: true,
		parentSections: ['Status Update'],
		includeInSerialization: true,
	},
	{ fieldName: 'decisionContext', headerName: 'Decision context', isNumber: false, parentSections: [], includeInSerialization: true },
];

// --- Derived field lists ---

/** Canonical list of all NarrativeVariables keys (excluding gameData). Derived from FIELD_DESCRIPTORS. */
export const NARRATIVE_VARIABLE_FIELDS: (keyof NarrativeVariables)[] = FIELD_DESCRIPTORS.map((d) => d.fieldName);

/** Number fields that need parseInt conversion from accumulated text. Derived from FIELD_DESCRIPTORS. */
export const NUMBER_FIELDS: ReadonlySet<keyof NarrativeVariables> = new Set(
	FIELD_DESCRIPTORS.filter((d) => d.isNumber).map((d) => d.fieldName)
);

/** List fields that are parsed from bullet items. Derived from FIELD_DESCRIPTORS. */
export const LIST_FIELDS: ReadonlySet<keyof NarrativeVariables> = new Set(
	FIELD_DESCRIPTORS.filter((d) => d.isList).map((d) => d.fieldName)
);

// --- Helpers ---

/** Type-safe setter for NarrativeVariables fields, bypassing the index signature constraint. */
export function setField(obj: NarrativeVariables, key: keyof NarrativeVariables, value: string | number | string[]): void {
	(obj as unknown as Record<string, unknown>)[key] = value;
}

/** Create an empty GameDataFields. */
export function emptyGameDataFields(): GameDataFields {
	return {
		worldState: null,
		decisions: [],
		playerAliases: [],
		otherCharacterAliases: {},
	};
}

/** Create a NarrativeVariables with all fields set to null/empty. */
export function emptyVariables(): NarrativeVariables {
	return {
		scratchpad: null,
		reviewScratchpad: null,
		storyTitle: null,
		actNumber: null,
		sessionNumber: null,
		sceneNumber: null,
		sceneTitle: null,
		background: null,
		narrativeBody: null,
		cg: null,
		currentContext: null,
		activePlotThreads: [],
		decisionContext: null,
		gameData: null,
	};
}
