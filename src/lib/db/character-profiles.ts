import { getDatabase } from './database';
import { kebabCase } from 'lodash-es';

export type CharacterImportance = 1 | 2 | 3 | 4;

export const MAX_CHARACTER_TRAITS = 10;

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
	traits: string[];
	sceneDetails: string;
	importance: CharacterImportance;
	removed: boolean;
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
	traits: string | null;
	scene_details: string;
	importance: number;
	removed: number;
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
		traits: parseTraits(row.traits),
		sceneDetails: row.scene_details,
		importance: row.importance as CharacterImportance,
		removed: row.removed === 1,
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

/** Trim entries, drop empties, dedupe exact matches, and keep the first MAX_CHARACTER_TRAITS in order. */
export function normalizeTraits(traits: string[]): string[] {
	const cleaned = traits.map((t) => t.trim()).filter((t) => t.length > 0);
	return [...new Set(cleaned)].slice(0, MAX_CHARACTER_TRAITS);
}

export function parseTraits(raw: string | null | undefined): string[] {
	if (!raw) return [];
	return normalizeTraits(raw.split(','));
}

export function serializeTraits(traits: string[]): string | null {
	const normalized = normalizeTraits(traits);
	return normalized.length > 0 ? normalized.join(', ') : null;
}

/**
 * Normalize a character name into a stable kebab-case canonical form.
 * "Lady Shadowcrest" → "lady-shadowcrest", "Elena M. O'Brien" → "elena-m-obrien".
 */
export function toCanonicalName(name: string): string {
	return kebabCase(name);
}

/**
 * Ensure preferredName is present in the aliases array (deduplicated), with
 * preferredName positioned as the first element when non-empty. This guarantees
 * that if a future row changes preferredName, the old name remains matchable via
 * aliases, and that consumers can rely on the first alias being the preferred name.
 */
export function ensurePreferredInAliases(preferredName: string, aliases: string[]): string[] {
	return preferredName ? [...new Set([preferredName, ...aliases])] : [...new Set(aliases)];
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
	traits?: string[];
	sceneDetails: string;
	importance: CharacterImportance;
	removed?: boolean;
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
		`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, traits, scene_details, importance, created_at, updated_at, removed)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
			serializeTraits(input.traits ?? []),
			input.sceneDetails,
			input.importance,
			input.createdAt ?? now,
			input.updatedAt ?? now,
			input.removed ? 1 : 0,
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
 * "Most recent" = highest scene_number; baseline rows (NULL scene_number, treated as -1)
 * lose to any scene-numbered row. Ties broken by created_at. Tombstone winners are
 * excluded after ranking, so they cannot reveal an earlier version of the same character.
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
		 AND removed = 0
		 ORDER BY importance ASC, COALESCE(scene_number, -1) DESC`,
		[actLineId]
	);
	return rows.map(mapRowToEntity);
}

/**
 * Get the active snapshot of every character at or before a scene number.
 * Ranked history first (baseline rows precede numbered scenes), then tombstone
 * winners are excluded.
 */
export async function getProfilesAtScene(actLineId: string, sceneNumber: number): Promise<CharacterProfileEntity[]> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE cp.act_line_id = $1
		 AND (cp.scene_number IS NULL OR cp.scene_number <= $2)
		 AND cp.id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     AND (scene_number IS NULL OR scene_number <= $2)
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND cp.removed = 0
		 ORDER BY importance ASC, COALESCE(cp.scene_number, -1) DESC`,
		[actLineId, sceneNumber]
	);
	return rows.map(mapRowToEntity);
}

/**
 * Get the active profile for a single character, resolving any alias they are known by.
 * Matches on canonical_name, preferred_name OR aliases of the winning version only, so
 * obsolete aliases and tombstoned identities never match.
 */
export async function getLatestProfileByAlias(actLineId: string, nameOrAlias: string): Promise<CharacterProfileEntity | null> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE cp.act_line_id = $1
		 AND cp.id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND cp.removed = 0
		 AND (
			   cp.canonical_name = $2
				 OR cp.preferred_name = $2
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
 * Like `getLatestProfileByAlias`, but keeps tombstone winners. Callers that rebuild profiles
 * from generated content use this so a revival reuses the erased identity's canonical name and
 * aliases instead of forking a new one.
 */
export async function getLatestProfileByAliasIncludingRemoved(
	actLineId: string,
	nameOrAlias: string
): Promise<CharacterProfileEntity | null> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE cp.act_line_id = $1
		 AND cp.id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND (
			   cp.canonical_name = $2
				 OR cp.preferred_name = $2
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

/** Check whether any of the given names (preferred or alias) is active in the act line. */
export async function areAnyCharacterNamesKnown(actLineId: string, names: string[]): Promise<boolean> {
	if (names.length === 0) return false;

	const db = getDatabase();
	const placeholders = names.map((_, i) => `$${i + 2}`).join(',');

	const rows = await db.select<{ found: number }[]>(
		`SELECT 1 as found FROM character_profiles cp
		 WHERE cp.act_line_id = $1
		 AND cp.id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND cp.removed = 0
		 AND (
		     cp.preferred_name IN (${placeholders})
		     OR EXISTS (SELECT 1 FROM json_each(cp.aliases) WHERE value IN (${placeholders}))
		 )
		 LIMIT 1`,
		[actLineId, ...names]
	);

	return rows.length > 0;
}

/**
 * Resolve the canonical name of the latest erased identity matching a preferred
 * name or alias. Returns null when an active identity owns any of the names, so
 * an identity absorbed by consolidation is never revived as a duplicate.
 */
export async function resolveTombstonedCanonicalName(actLineId: string, names: string[]): Promise<string | null> {
	if (names.length === 0) return null;
	if (await areAnyCharacterNamesKnown(actLineId, names)) return null;

	const db = getDatabase();
	const placeholders = names.map((_, i) => `$${i + 2}`).join(',');

	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT cp.* FROM character_profiles cp
		 WHERE cp.act_line_id = $1
		 AND cp.id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND cp.removed = 1
		 AND (
		     cp.preferred_name IN (${placeholders})
		     OR EXISTS (SELECT 1 FROM json_each(cp.aliases) WHERE value IN (${placeholders}))
		 )
		 ORDER BY COALESCE(cp.scene_number, -1) DESC, cp.created_at DESC
		 LIMIT 1`,
		[actLineId, ...names]
	);

	return rows.length > 0 ? rows[0].canonical_name : null;
}

/**
 * Fetch all character preferred names and their merged aliases across the entire
 * app database (spanning all stories). Preferred name is folded into the alias
 * set via `ensurePreferredInAliases` so callers can match against either field.
 * Used by the `suggest-character-name` tool to avoid name collisions.
 */
export async function getAllCharacterNames(): Promise<{ preferredName: string; aliases: string[] }[]> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(`SELECT preferred_name, aliases FROM character_profiles`);
	const merged = new Map<string, Set<string>>();
	for (const row of rows) {
		const aliases = ensurePreferredInAliases(row.preferred_name, parseAliases(row.aliases));
		const existing = merged.get(row.preferred_name) ?? new Set<string>();
		for (const a of aliases) existing.add(a);
		merged.set(row.preferred_name, existing);
	}
	return Array.from(merged.entries()).map(([preferredName, set]) => ({ preferredName, aliases: Array.from(set) }));
}

export async function deleteCharacterProfilesForActLine(actLineId: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM character_profiles WHERE act_line_id = $1', [actLineId]);
}

/**
 * Delete character profile rows for a set of scene numbers in an act line.
 * Used to clean up profiles generated for scenes that are being rewound
 * (e.g. when regenerating or deleting the last chat exchange).
 * No-op when sceneNumbers is empty.
 */
export async function deleteCharacterProfilesForScenes(actLineId: string, sceneNumbers: number[]): Promise<void> {
	if (sceneNumbers.length === 0) return;
	const db = getDatabase();
	const placeholders = sceneNumbers.map((_, i) => `$${i + 2}`).join(', ');
	await db.execute(`DELETE FROM character_profiles WHERE act_line_id = $1 AND scene_number IN (${placeholders})`, [
		actLineId,
		...sceneNumbers,
	]);
}

// === Guarded, atomic profile version writes ===
//
// Profiles are scene-numbered row history, so edit/removal/consolidation must
// respect the observed version (mutation clock) and the selected scene must
// still be the act line's latest scene. The database interface has no
// transaction API and separate execute calls are not assumed to share a
// connection, so every batch is one guarded SQL statement: the whole-batch
// eligibility predicate runs before any row is touched and the upsert is
// validated by rowsAffected. A rejected batch changes nothing.

export interface ProfileVersionWrite {
	previous: CharacterProfileEntity | null;
	next: CharacterProfileEntity;
}

type ProfileWriteKind = 'insert' | 'update' | 'copy';

interface SerializedProfileWrite {
	kind: ProfileWriteKind;
	id: string;
	prevId: string | null;
	prevUpdatedAt: number | null;
	canonicalName: string;
	preferredName: string;
	aliases: string;
	logline: string;
	state: string | null;
	goal: string | null;
	relationships: string | null;
	voice: string | null;
	traits: string | null;
	sceneDetails: string;
	importance: number;
	removed: number;
	createdAt: number;
	updatedAt: number;
}

const PROFILE_WRITE_SQL = `
INSERT INTO character_profiles (
	id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline,
	state, goal, relationships, voice, traits, scene_details, importance, removed,
	created_at, updated_at
)
SELECT
	json_extract(input.value, '$.id'),
	$1,
	$2,
	json_extract(input.value, '$.canonicalName'),
	json_extract(input.value, '$.preferredName'),
	json_extract(input.value, '$.aliases'),
	json_extract(input.value, '$.logline'),
	json_extract(input.value, '$.state'),
	json_extract(input.value, '$.goal'),
	json_extract(input.value, '$.relationships'),
	json_extract(input.value, '$.voice'),
	json_extract(input.value, '$.traits'),
	json_extract(input.value, '$.sceneDetails'),
	json_extract(input.value, '$.importance'),
	json_extract(input.value, '$.removed'),
	json_extract(input.value, '$.createdAt'),
	json_extract(input.value, '$.updatedAt')
FROM json_each($3) AS input
WHERE (SELECT COUNT(*) FROM json_each($3)) = $4
	AND (
		SELECT m.scene_number
		FROM act_lines al
		JOIN messages m ON al.message_id = m.id
		WHERE al.act_line_id = $1 AND m.scene_number IS NOT NULL
		ORDER BY al.sequence DESC
		LIMIT 1
	) = $2
	AND NOT EXISTS (
		SELECT 1
		FROM json_each($3) AS observed
		WHERE (
			(
				json_extract(observed.value, '$.kind') = 'insert'
				AND json_extract(observed.value, '$.prevId') IS NULL
				AND NOT EXISTS (
					SELECT 1 FROM character_profiles existing
					WHERE existing.id = json_extract(observed.value, '$.id')
				)
			)
			OR (
				json_extract(observed.value, '$.kind') = 'update'
				AND json_extract(observed.value, '$.prevId') = json_extract(observed.value, '$.id')
				AND EXISTS (
					SELECT 1 FROM character_profiles existing
					WHERE existing.id = json_extract(observed.value, '$.id')
						AND existing.act_line_id = $1
						AND existing.scene_number = $2
						AND existing.updated_at = json_extract(observed.value, '$.prevUpdatedAt')
				)
			)
			OR (
				json_extract(observed.value, '$.kind') = 'copy'
				AND json_extract(observed.value, '$.prevId') IS NOT NULL
				AND json_extract(observed.value, '$.prevId') <> json_extract(observed.value, '$.id')
				AND NOT EXISTS (
					SELECT 1 FROM character_profiles existing
					WHERE existing.id = json_extract(observed.value, '$.id')
				)
				AND EXISTS (
					SELECT 1 FROM character_profiles existing
					WHERE existing.id = json_extract(observed.value, '$.prevId')
						AND existing.act_line_id = $1
						AND existing.updated_at = json_extract(observed.value, '$.prevUpdatedAt')
				)
			)
		) IS NOT 1
	)
ON CONFLICT(id) DO UPDATE SET
	canonical_name = excluded.canonical_name,
	preferred_name = excluded.preferred_name,
	aliases = excluded.aliases,
	logline = excluded.logline,
	state = excluded.state,
	goal = excluded.goal,
	relationships = excluded.relationships,
	voice = excluded.voice,
	traits = excluded.traits,
	scene_details = excluded.scene_details,
	importance = excluded.importance,
	removed = excluded.removed,
	updated_at = excluded.updated_at
WHERE character_profiles.act_line_id = $1
	AND character_profiles.scene_number = $2
	AND EXISTS (
		SELECT 1 FROM json_each($3) AS input
		WHERE json_extract(input.value, '$.kind') = 'update'
			AND json_extract(input.value, '$.id') = character_profiles.id
			AND json_extract(input.value, '$.prevUpdatedAt') = character_profiles.updated_at
	)`;

const DELETE_PROFILE_ENTRY_SQL = `
DELETE FROM character_profiles
WHERE id = $3
	AND act_line_id = $1
	AND scene_number = $2
	AND updated_at = $4
	AND (
		SELECT m.scene_number
		FROM act_lines al
		JOIN messages m ON al.message_id = m.id
		WHERE al.act_line_id = $1 AND m.scene_number IS NOT NULL
		ORDER BY al.sequence DESC
		LIMIT 1
	) = $2`;

function assertActLineAndScene(actLineId: string, sceneNumber: number): void {
	if (typeof actLineId !== 'string' || actLineId.length === 0) {
		throw new Error('Character profile write rejected: actLineId must be a non-empty string.');
	}
	if (!Number.isInteger(sceneNumber)) {
		throw new Error(`Character profile write rejected: sceneNumber must be an integer (got ${String(sceneNumber)}).`);
	}
}

function assertObservedVersion(actLineId: string, previous: CharacterProfileEntity): void {
	if (typeof previous.id !== 'string' || previous.id.length === 0) {
		throw new Error('Character profile write rejected: the observed profile version has no id.');
	}
	if (previous.actLineId !== actLineId) {
		throw new Error(
			`Character profile write rejected: the observed version "${previous.id}" belongs to act line "${previous.actLineId}", but the write is for act line "${actLineId}".`
		);
	}
	if (!Number.isFinite(previous.updatedAt)) {
		throw new Error(`Character profile write rejected: the observed version "${previous.id}" has no valid updatedAt clock.`);
	}
}

function serializeProfileWrite(
	next: CharacterProfileEntity,
	kind: ProfileWriteKind,
	prevId: string | null,
	prevUpdatedAt: number | null
): SerializedProfileWrite {
	return {
		kind,
		id: next.id,
		prevId,
		prevUpdatedAt,
		canonicalName: next.canonicalName,
		preferredName: next.preferredName,
		aliases: serializeAliases(next.aliases ?? []),
		logline: next.logline,
		state: next.state ?? null,
		goal: next.goal ?? null,
		relationships: next.relationships ?? null,
		voice: next.voice ?? null,
		traits: serializeTraits(next.traits ?? []),
		sceneDetails: next.sceneDetails ?? '',
		importance: next.importance,
		removed: next.removed ? 1 : 0,
		createdAt: next.createdAt,
		updatedAt: next.updatedAt,
	};
}

/**
 * Apply a batch of profile version writes atomically at the selected scene.
 * `previous === null` inserts a new row; a same-scene `previous` updates in
 * place (id/creation time preserved, update clock advanced); an earlier or
 * baseline `previous` inserts a copied row with the fresh `next.id`. Any stale
 * observed version, duplicate target id or changed latest scene rejects the
 * whole batch and changes no rows.
 */
export async function writeProfileVersions(actLineId: string, sceneNumber: number, writes: ProfileVersionWrite[]): Promise<void> {
	assertActLineAndScene(actLineId, sceneNumber);
	if (!Array.isArray(writes) || writes.length === 0) {
		throw new Error('Character profile write rejected: no profile versions were supplied.');
	}

	const seenIds = new Set<string>();
	const rows = writes.map((write): SerializedProfileWrite => {
		const { previous, next } = write ?? {};
		if (!next || typeof next.id !== 'string' || next.id.length === 0) {
			throw new Error('Character profile write rejected: every write requires a next version with an id.');
		}
		if (next.actLineId !== actLineId) {
			throw new Error(
				`Character profile write rejected: next version "${next.id}" targets act line "${next.actLineId}", but the write is for act line "${actLineId}".`
			);
		}
		if (next.sceneNumber !== sceneNumber) {
			throw new Error(
				`Character profile write rejected: next version "${next.id}" targets scene ${String(next.sceneNumber)}, but the write is for scene ${sceneNumber}.`
			);
		}
		if (!Number.isFinite(next.createdAt) || !Number.isFinite(next.updatedAt)) {
			throw new Error(`Character profile write rejected: next version "${next.id}" requires finite createdAt/updatedAt values.`);
		}
		if (seenIds.has(next.id)) {
			throw new Error(`Character profile write rejected: duplicate target id "${next.id}" in one batch.`);
		}
		seenIds.add(next.id);

		if (previous === null) {
			return serializeProfileWrite(next, 'insert', null, null);
		}

		assertObservedVersion(actLineId, previous);
		if (previous.sceneNumber === sceneNumber) {
			if (next.id !== previous.id) {
				throw new Error(
					`Character profile write rejected: same-scene update must keep the observed id "${previous.id}" (got "${next.id}").`
				);
			}
			if (next.updatedAt <= previous.updatedAt) {
				throw new Error(
					`Character profile write rejected: same-scene update of "${previous.id}" must advance updatedAt beyond ${previous.updatedAt}.`
				);
			}
			return serializeProfileWrite(next, 'update', previous.id, previous.updatedAt);
		}
		if (previous.sceneNumber === null || previous.sceneNumber < sceneNumber) {
			if (next.id === previous.id) {
				throw new Error(
					`Character profile write rejected: copying the earlier version "${previous.id}" requires a fresh id for the new scene ${sceneNumber} row.`
				);
			}
			return serializeProfileWrite(next, 'copy', previous.id, previous.updatedAt);
		}
		throw new Error(
			`Character profile write rejected: the observed version "${previous.id}" belongs to scene ${previous.sceneNumber}, which is later than selected scene ${sceneNumber}.`
		);
	});

	const db = getDatabase();
	const result = await db.execute(PROFILE_WRITE_SQL, [actLineId, sceneNumber, JSON.stringify(rows), rows.length]);
	if (result.rowsAffected !== rows.length) {
		throw new Error(
			`Character profile write rejected (act line "${actLineId}", scene ${sceneNumber}): the latest scene changed, an expected id is already present, or an observed profile version is stale or missing. No rows were changed; re-read the snapshot and retry.`
		);
	}
}

/**
 * Physically delete a same-scene profile version. An older version may become
 * visible afterwards; older/baseline versions are never deletable. Rejected
 * when the observed id/update clock is stale or the scene is no longer latest.
 */
export async function deleteProfileEntry(actLineId: string, sceneNumber: number, previous: CharacterProfileEntity): Promise<void> {
	assertActLineAndScene(actLineId, sceneNumber);
	if (!previous) {
		throw new Error('Character profile deletion rejected: the observed profile version is required.');
	}
	assertObservedVersion(actLineId, previous);
	if (previous.sceneNumber !== sceneNumber) {
		throw new Error(
			`Character profile deletion rejected: version "${previous.id}" belongs to scene ${String(previous.sceneNumber)}; only scene ${sceneNumber} rows can be deleted. No rows were deleted.`
		);
	}

	const db = getDatabase();
	const result = await db.execute(DELETE_PROFILE_ENTRY_SQL, [actLineId, sceneNumber, previous.id, previous.updatedAt]);
	if (result.rowsAffected !== 1) {
		throw new Error(
			`Character profile deletion rejected (act line "${actLineId}", scene ${sceneNumber}): the latest scene changed or the observed version is stale or missing. No rows were deleted; re-read the snapshot and retry.`
		);
	}
}

/**
 * Clone character profiles from one act line to another, limited to profiles
 * at or before maxSceneNumber. Baseline (NULL scene_number) rows are always
 * included; scene-numbered rows beyond maxSceneNumber are excluded. Tombstones
 * and their version timestamps are preserved so relative precedence survives.
 * Canonical names and aliases are preserved as-is.
 */
export async function cloneCharacterProfiles(fromActLineId: string, toActLineId: string, maxSceneNumber: number): Promise<void> {
	const db = getDatabase();
	const rows = await db.select<CharacterProfileRow[]>(
		`SELECT * FROM character_profiles WHERE act_line_id = $1 AND (scene_number IS NULL OR scene_number <= $2)`,
		[fromActLineId, maxSceneNumber]
	);
	for (const row of rows) {
		await db.execute(
			`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, traits, scene_details, importance, created_at, updated_at, removed)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
				row.traits,
				row.scene_details,
				row.importance,
				row.created_at,
				row.updated_at,
				row.removed,
			]
		);
	}
}

/**
 * Inherit the most-recent active profile per character from a source act line into a destination act line.
 * Used when continuing from a concluded act into a new act (Trigger #3).
 * Baseline (scene_number = NULL) active rows written to destination; canonical_name preserved.
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
			traits: string | null;
			importance: number;
		}[]
	>(
		`SELECT canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, traits, importance FROM character_profiles cp
		 WHERE act_line_id = $1
		 AND id = (
		     SELECT id FROM character_profiles
		     WHERE act_line_id = cp.act_line_id AND canonical_name = cp.canonical_name
		     ORDER BY COALESCE(scene_number, -1) DESC, created_at DESC LIMIT 1
		 )
		 AND removed = 0`,
		[fromActLineId]
	);
	for (const row of rows) {
		const aliases = ensurePreferredInAliases(row.preferred_name, parseAliases(row.aliases));
		await db.execute(
			`INSERT INTO character_profiles (id, act_line_id, scene_number, canonical_name, preferred_name, aliases, logline, state, goal, relationships, voice, traits, scene_details, importance, created_at, updated_at, removed)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
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
				row.traits,
				'',
				row.importance,
				now,
				now,
				0,
			]
		);
	}
}
