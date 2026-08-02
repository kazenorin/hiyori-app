export const GENDERS = ['masculine', 'feminine', 'neutral'] as const;
export type Gender = (typeof GENDERS)[number];

/** Name forms stored in the dataset. `full` is intentionally absent — full names are composed from given + family at query time. */
export const DATA_NAME_TYPES = ['family', 'given', 'nickname'] as const;
export type DataNameType = (typeof DATA_NAME_TYPES)[number];

/** Name forms the tool accepts. `full` triggers given+family composition. */
export const TOOL_NAME_TYPES = ['full', 'family', 'given', 'nickname'] as const;
export type ToolNameType = (typeof TOOL_NAME_TYPES)[number];

export const CULTURES = [
	'european',
	'japanese',
	'chinese',
	'middle-eastern',
	'african',
	'south-asian',
	'latin',
	'elven',
	'dwarven',
	'orcish',
	'draconic',
	'celestial',
	'infernal',
] as const;
export type Culture = (typeof CULTURES)[number];

export const MEANING_TAGS = [
	'noble',
	'nature',
	'dark',
	'arcane',
	'martial',
	'serene',
	'cunning',
	'heroic',
	'mysterious',
	'pastoral',
	'royal',
	'wild',
] as const;
export type MeaningTag = (typeof MEANING_TAGS)[number];

/** How a culture orders a composed full name, or whether it uses family names at all. */
export type NameOrder = 'givenFirst' | 'familyFirst' | 'noFamily';

export const CULTURE_META: Record<Culture, { nameOrder: NameOrder }> = {
	european: { nameOrder: 'givenFirst' },
	japanese: { nameOrder: 'familyFirst' },
	chinese: { nameOrder: 'familyFirst' },
	'middle-eastern': { nameOrder: 'givenFirst' },
	african: { nameOrder: 'givenFirst' },
	'south-asian': { nameOrder: 'givenFirst' },
	latin: { nameOrder: 'givenFirst' },
	elven: { nameOrder: 'givenFirst' },
	dwarven: { nameOrder: 'givenFirst' },
	orcish: { nameOrder: 'noFamily' },
	draconic: { nameOrder: 'noFamily' },
	celestial: { nameOrder: 'givenFirst' },
	infernal: { nameOrder: 'noFamily' },
};

export const DEFAULT_COUNT = 5;
export const MAX_COUNT = 20;
export const DEFAULT_AVOIDANCE = 3;
export const MAX_AVOIDANCE = 5;

/**
 * A single curated name entry. Multi-valued dimensions (genders, themes,
 * cultures, nameTypes, meaningTags) let one name satisfy several criteria.
 * `themes` are world-template ids (see template-registry); kept as strings so
 * this module stays decoupled from the prompt-loading system.
 */
export interface NameEntry {
	name: string;
	genders: Gender[];
	themes: string[];
	cultures: Culture[];
	nameTypes: DataNameType[];
	meaningTags: MeaningTag[];
}

/** A suggested name ready for output. `name` may be a composed full name. */
export interface SuggestedName {
	name: string;
	meaningTags: MeaningTag[];
}

/**
 * Analytic suggestion query. Every dimension is optional and multi-valued;
 * a name matches a dimension when its value set intersects the query's set.
 * An omitted/empty dimension imposes no constraint. Omitting `nameTypes`
 * returns direct forms only (no full-name composition); requesting `full`
 * composes given + family pairs.
 */
export interface NameQuery {
	genders?: Gender[];
	themes?: string[];
	cultures?: Culture[];
	nameTypes?: ToolNameType[];
	count?: number;
	avoidanceLevel?: number;
}
