import { getDatabase } from './database';
import { kebabCase } from 'lodash-es';

export type CharacterImportance = 1 | 2 | 3 | 4;

export interface CharacterProfileEntity {
	id: string;
	actLineId: string;
	sceneNumber: number | null;
	canonicalName: string;
	preferredName: string;
	aliases: string[];
	logline: string;
	state: string | null;
	goal: string | null;
	relationships: string | null;
	voice: string | null;
	sceneDetails: string;
	importance: CharacterImportance;
	createdAt: number;
	updatedAt: number;
}

interface CharacterProfileRow {
	id: string;
	act_line_id: string;
	scene_number: number | null;
	canonical_name: string;
	preferred_name: string;
	aliases: string;
	logline: string;
	state: string | null;
	goal: string | null;
	relationships: string | null;
	voice: string | null;
	scene_details: string;
	importance: number;
	created_at: number;
	updated_at: number;
}

function mapRowToEntity(row: CharacterProfileRow): CharacterProfileEntity {
	return {
		id: row.id,
		actLineId: row.act_line_id,
		sceneNumber: row.scene_number,
		canonicalName: row.canonical_name,
		preferredName: row.preferred_name,
		aliases: parseAliases(row.aliases),
		logline: row.logline,
		state: row.state,
		goal: row.goal,
		relationships: row.relationships,
		voice: row.voice,
		sceneDetails: row.scene_details,
		importance: row.importance as CharacterImportance,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
	};
}

function parseAliases(raw: string): string[] {
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((a) => typeof a === 'string') : [];
	} catch {
		return [];
	}
}

function serializeAliases(aliases: string[]): string {
	return JSON.stringify(aliases);
}

/**
 * Normalize a character name into a stable kebab-case canonical form.
 * "Lady Shadowcrest" → "lady-shadowcrest", "Elena M. O'Brien" → "elena-m-obrien".
 */
export function toCanonicalName(name: string): string {
	return kebabCase(name);
}

/**
 * Ensure preferredName is present in the aliases array (deduplicated).
 * This guarantees that if a future row changes preferredName, the old name
 * remains matchable via aliases.
 */
export function ensurePreferredInAliases(preferredName: string, aliases: string[]): string[] {
	const set = new Set(aliases);
	if (preferredName) set.add(preferredName);
	return Array.from(set);
}

export interface InsertCharacterProfileInput {
	id: string;
	actLineId: string;
	sceneNumber: number | null;
	canonicalName: string;
	preferredName: string;
	aliases: string[];
	logline: string;
	state?: string | null;
	goal?: string | null;
	relationships?: string | null;
	voice?: string | null;
	sceneDetails: string;
	importance: CharacterImportance;
	createdAt?: number;
	updatedAt?: number;
}

/**
 * Resolve the canonical_name for a character before insert.
 * If any existing profile in this act line matches the given name (preferred or alias),
 * reuse the existing canonical_name. Otherwise, derive from the preferredName.
 */
export async function resolveCanonicalName(actLineId: string, preferredName: string): Promise<string> {
	const existing = await getLatestProfileByAlias(actLineId, preferredName);
	return existing?.canonicalName ?? toCanonicalName(preferredName);
}

export async function insertCharacterProfile(input: InsertCharacterProfileInput): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, scene_details, importance, created_at, updated_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		[
			input.id,
			input.actLineId,
			input.sceneNumber,
			input.canonicalName,
			input.preferredName,
			serializeAliases(input.aliases),
			input.logline,
			input.state ?? null,
			input.goal ?? null,
			input.relationships ?? null,
			input.voice ?? null,
			input.sceneDetails,
			input.importance,
			input.createdAt ?? now,
			input.updatedAt ?? now,
		]
	);
}

/**
 * Get all character profile rows for multiple act lines in a single query.
 * Used by the story exporter to bundle every scene's profile (not just the latest)
 * for faithful round-tripping.
 */
export async function getCharacterProfilesForActLines(actLineIds: string[]): Promise<CharacterProfileEntity[]> {
	if (actLineIds.length === 0) return [];
	const db = getDatabase();
	const placeholders = actLineIds.map((_, i) => `$${i + 1}`).join(',');
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT * FROM character_profiles WHERE act_line_id IN (${placeholders})`,
		actLineIds
	);
	return rows.map(mapRowToEntity);
}

/**
 * Get the most-recent profile per character in an act line, grouped by canonical_name.
 * "Most recent" = highest scene_number; baseline rows (NULL scene_number, treated as -1) lose to any scene-numbered row.
 * Ties broken by created_at.
 */
export async function getLatestProfilesByActLine(actLineId: string): Promise<CharacterProfileEntity[]> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE act_line_id = $1
		 AND id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 ORDER BY importance ASC, COALESCE(scene_number, -1) DESC`,
		[actLineId]
	);
	return rows.map(mapRowToEntity);
}

/**
 * Get the most-recent profile for a single character, resolving any alias they are known by.
 * Matches on preferred_name OR aliases. Returns null if no match.
 */
export async function getLatestProfileByAlias(actLineId: string, nameOrAlias: string): Promise<CharacterProfileEntity | null> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE act_line_id = $1
		 AND (
		     cp.preferred_name = $2
		     OR EXISTS (
		         SELECT 1 FROM json_each(cp.aliases) WHERE value = $2
		     )
		 )
		 ORDER BY COALESCE(cp.scene_number, -1) DESC, cp.created_at DESC
		 LIMIT 1`,
		[actLineId, nameOrAlias]
	);
	return rows.length > 0 ? mapRowToEntity(rows[0]) : null;
}

/**
 * Get the highest scene_number among character profiles for an act line.
 * Returns null if no scene-numbered profiles exist.
 * Used by the compressor to determine the interval without relying on the act-summary blob.
 */
export async function getMaxSceneNumberForActLine(actLineId: string): Promise<number | null> {
	const db = getDatabase();
	const rows = await db.select<{ max_scene: number | null }[]>(
		`SELECT MAX(COALESCE(scene_number, -1)) as max_scene FROM character_profiles WHERE act_line_id = $1`,
		[actLineId]
	);
	if (rows.length === 0 || rows[0].max_scene === null) return null;
	const max = rows[0].max_scene;
	return max < 0 ? null : max;
}

/** Check whether any of the given names (preferred or alias) exists in the act line. */
export async function areAnyCharacterNamesKnown(actLineId: string, names: string[]): Promise<boolean> {
	if (names.length === 0) return false;

	const db = getDatabase();
	const placeholders = names.map((_, i) => `$${i + 2}`).join(',');

	const rows = await db.select<{ found: number }[]>(
		`SELECT 1 as found FROM character_profiles
		 WHERE act_line_id = $1
		 AND (
		     preferred_name IN (${placeholders})
		     OR EXISTS (SELECT 1 FROM json_each(aliases) WHERE value IN (${placeholders}))
		 )
		 LIMIT 1`,
		[actLineId, ...names]
	);

	return rows.length > 0;
}

export async function deleteCharacterProfilesForActLine(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM character_profiles WHERE act_line_id = $1', [actLineId]);
}

/**
 * Clone character profiles from one act line to another, limited to profiles
 * at or before maxSceneNumber. Baseline (NULL scene_number) rows are always
 * included; scene-numbered rows beyond maxSceneNumber are excluded.
 * Canonical names and aliases are preserved as-is.
 */
export async function cloneCharacterProfiles(fromActLineId: string, toActLineId: string, maxSceneNumber: number): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT * FROM character_profiles WHERE act_line_id = $1 AND (scene_number IS NULL OR scene_number <= $2)`,
		[fromActLineId, maxSceneNumber]
	);
	for (const row of rows) {
		await db.execute(
			`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, scene_details, importance, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			[
				crypto.randomUUID(),
				toActLineId,
				row.scene_number,
				row.canonical_name,
				row.preferred_name,
				row.aliases,
				row.logline,
				row.state,
				row.goal,
				row.relationships,
				row.voice,
				row.scene_details,
				row.importance,
				now,
				now,
			]
		);
	}
}

/**
 * Inherit the most-recent profile per character from a source act line into a destination act line.
 * Used when continuing from a concluded act into a new act (Trigger #3).
 * Baseline (scene_number = NULL) rows written to destination; canonical_name preserved.
 * preferredName folded into aliases via ensurePreferredInAliases.
 */
export async function inheritProfilesFromActLine(fromActLineId: string, toActLineId: string): Promise<void> {
	const db = getDatabase();
	const now = Date.now();
	const rows = await db.select<
		{
			canonical_name: string;
			preferred_name: string;
			aliases: string;
			logline: string;
			state: string | null;
			goal: string | null;
			relationships: string | null;
			voice: string | null;
			importance: number;
		}[]
	>(
		`SELECT canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, importance FROM character_profiles cp
		 WHERE act_line_id = $1
		 AND id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )`,
		[fromActLineId]
	);
	for (const row of rows) {
		const aliases = ensurePreferredInAliases(row.preferred_name, parseAliases(row.aliases));
		await db.execute(
			`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, scene_details, importance, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
			[
				crypto.randomUUID(),
				toActLineId,
				null,
				row.canonical_name,
				row.preferred_name,
				serializeAliases(aliases),
				row.logline,
				row.state,
				row.goal,
				row.relationships,
				row.voice,
				'',
				row.importance,
				now,
				now,
			]
		);
	}
}
