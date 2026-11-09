import {
	areAnyCharacterNamesKnown,
	deleteProfileEntry,
	ensurePreferredInAliases,
	getLatestProfilesByActLine,
	getProfilesAtScene,
	normalizeTraits,
	resolveTombstonedCanonicalName,
	toCanonicalName,
	writeProfileVersions,
	type CharacterImportance,
	type CharacterProfileEntity,
} from '#lib/db/character-profiles.ts';
import { getLastCompressionScene, getLastSceneNumber } from '#lib/db/act-lines.ts';
import { parseSceneDetails, serializeSceneDetailEntries, type SceneDetailEntry } from '#lib/definitions/pipeline-sections.ts';

export type ProfileDraft = Omit<
	CharacterProfileEntity,
	'id' | 'actLineId' | 'sceneNumber' | 'canonicalName' | 'removed' | 'createdAt' | 'updatedAt'
>;

export interface ProfileContext {
	profiles: CharacterProfileEntity[];
	editable: boolean;
	lastCompressionScene: number | null;
}

/** Add rejected because the name or canonical form already belongs to an active profile. */
export class DuplicateProfileError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DuplicateProfileError';
	}
}

function assertActLineId(actLineId: string): void {
	if (typeof actLineId !== 'string' || actLineId.length === 0) {
		throw new Error('Character profile operation rejected: actLineId must be a non-empty string.');
	}
}

function assertSceneNumber(sceneNumber: number): void {
	if (!Number.isInteger(sceneNumber)) {
		throw new Error(`Character profile operation rejected: sceneNumber must be an integer (got ${String(sceneNumber)}).`);
	}
}

function textValue(value: unknown, label: string): string {
	if (typeof value !== 'string') {
		throw new Error(`Character profile ${label} must be a string.`);
	}
	return value.trim();
}

function requiredText(value: unknown, label: string): string {
	const trimmed = textValue(value, label);
	if (trimmed.length === 0) {
		throw new Error(`Character profile ${label} must not be empty.`);
	}
	return trimmed;
}

function optionalText(value: unknown, label: string): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') {
		throw new Error(`Character profile ${label} must be a string or null.`);
	}
	return value;
}

function normalizeImportance(value: unknown): CharacterImportance {
	if (value !== 1 && value !== 2 && value !== 3 && value !== 4) {
		throw new Error(`Character profile importance must be one of 1, 2, 3, 4 (got ${String(value)}).`);
	}
	return value;
}

function normalizeDraft(draft: ProfileDraft): ProfileDraft {
	if (!draft || typeof draft !== 'object') {
		throw new Error('Character profile draft must be an object.');
	}
	const preferredName = requiredText(draft.preferredName, 'preferred name');
	if (!Array.isArray(draft.aliases) || draft.aliases.some((alias) => typeof alias !== 'string')) {
		throw new Error('Character profile aliases must be an array of strings.');
	}
	if (!Array.isArray(draft.traits) || draft.traits.some((trait) => typeof trait !== 'string')) {
		throw new Error('Character profile traits must be an array of strings.');
	}
	if (typeof draft.sceneDetails !== 'string') {
		throw new Error('Character profile scene details must be a serialized string.');
	}
	const aliases = draft.aliases.map((alias) => alias.trim()).filter((alias) => alias.length > 0);
	return {
		preferredName,
		aliases: ensurePreferredInAliases(preferredName, aliases),
		logline: textValue(draft.logline, 'logline'),
		state: optionalText(draft.state, 'state'),
		goal: optionalText(draft.goal, 'goal'),
		relationships: optionalText(draft.relationships, 'relationships'),
		voice: optionalText(draft.voice, 'voice'),
		traits: normalizeTraits(draft.traits),
		sceneDetails: serializeSceneDetailEntries(parseSceneDetails(draft.sceneDetails)),
		importance: normalizeImportance(draft.importance),
	};
}

function assertPreviousEligible(actLineId: string, sceneNumber: number, previous: CharacterProfileEntity): void {
	if (!previous || typeof previous !== 'object') {
		throw new Error('Character profile operation rejected: the observed profile version is required.');
	}
	if (typeof previous.id !== 'string' || previous.id.length === 0) {
		throw new Error('Character profile operation rejected: the observed profile version has no id.');
	}
	if (typeof previous.canonicalName !== 'string' || previous.canonicalName.length === 0) {
		throw new Error(`Character profile operation rejected: the observed version "${previous.id}" has no canonical name.`);
	}
	if (previous.actLineId !== actLineId) {
		throw new Error(
			`Character profile operation rejected: the observed version "${previous.id}" belongs to act line "${previous.actLineId}", but the operation targets act line "${actLineId}".`
		);
	}
	if (!Number.isFinite(previous.updatedAt) || !Number.isFinite(previous.createdAt)) {
		throw new Error(`Character profile operation rejected: the observed version "${previous.id}" has invalid timestamps.`);
	}
	if (previous.sceneNumber !== null && !Number.isInteger(previous.sceneNumber)) {
		throw new Error(
			`Character profile operation rejected: the observed version "${previous.id}" has an invalid scene number (${String(previous.sceneNumber)}).`
		);
	}
	if (previous.sceneNumber !== null && previous.sceneNumber > sceneNumber) {
		throw new Error(
			`Character profile operation rejected: the observed version "${previous.id}" belongs to scene ${previous.sceneNumber}, which is later than the selected scene ${sceneNumber}.`
		);
	}
}

/**
 * Build the selected-scene version for an edit. A same-scene row is updated in place;
 * a baseline or earlier row is copied under a fresh id so history stays immutable.
 * The update clock always advances past the observed version so guarded writes can
 * detect stale callers.
 */
function buildEditedVersion(
	actLineId: string,
	sceneNumber: number,
	previous: CharacterProfileEntity | null,
	draft: ProfileDraft,
	canonicalName: string,
	now: number = Date.now()
): CharacterProfileEntity {
	if (previous === null) {
		return {
			id: crypto.randomUUID(),
			actLineId,
			sceneNumber,
			canonicalName,
			...draft,
			removed: false,
			createdAt: now,
			updatedAt: now,
		};
	}

	assertPreviousEligible(actLineId, sceneNumber, previous);
	const updatedAt = Math.max(now, previous.updatedAt + 1);
	if (previous.sceneNumber === sceneNumber) {
		return {
			id: previous.id,
			actLineId,
			sceneNumber,
			canonicalName,
			...draft,
			removed: false,
			createdAt: previous.createdAt,
			updatedAt,
		};
	}
	return {
		id: crypto.randomUUID(),
		actLineId,
		sceneNumber,
		canonicalName,
		...draft,
		removed: false,
		createdAt: now,
		updatedAt,
	};
}

function buildTombstoneVersion(
	actLineId: string,
	sceneNumber: number,
	previous: CharacterProfileEntity,
	now: number = Date.now()
): CharacterProfileEntity {
	assertPreviousEligible(actLineId, sceneNumber, previous);
	const updatedAt = Math.max(now, previous.updatedAt + 1);
	if (previous.sceneNumber === sceneNumber) {
		return { ...previous, removed: true, updatedAt };
	}
	return {
		...previous,
		id: crypto.randomUUID(),
		sceneNumber,
		removed: true,
		createdAt: now,
		updatedAt,
	};
}

async function resolveAddedCanonicalName(actLineId: string, draft: ProfileDraft): Promise<string> {
	const derived = toCanonicalName(draft.preferredName);
	if (derived.length === 0) {
		throw new Error(`Character profile preferred name "${draft.preferredName}" has no usable canonical form.`);
	}
	// Add is for new characters only; matching an active profile must go through edit or consolidation.
	const names = ensurePreferredInAliases(draft.preferredName, draft.aliases);
	if (await areAnyCharacterNamesKnown(actLineId, names)) {
		throw new DuplicateProfileError(
			`Character profile "${draft.preferredName}" matches an active character in this act line; edit that profile or consolidate instead of adding a duplicate.`
		);
	}
	const active = await getLatestProfilesByActLine(actLineId);
	if (active.some((profile) => profile.canonicalName === derived)) {
		throw new DuplicateProfileError(
			`Character profile canonical name "${derived}" is already active in this act line; edit that profile or consolidate instead of adding a duplicate.`
		);
	}
	const tombstoned = await resolveTombstonedCanonicalName(actLineId, names);
	return tombstoned ?? derived;
}

export async function loadProfileContext(actLineId: string, sceneNumber: number): Promise<ProfileContext> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	const [profiles, lastSceneNumber, lastCompressionScene] = await Promise.all([
		getProfilesAtScene(actLineId, sceneNumber),
		getLastSceneNumber(actLineId),
		getLastCompressionScene(actLineId),
	]);
	return { profiles, editable: lastSceneNumber === sceneNumber, lastCompressionScene };
}

export async function saveProfile(
	actLineId: string,
	sceneNumber: number,
	previous: CharacterProfileEntity | null,
	draft: ProfileDraft
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	const normalized = normalizeDraft(draft);
	let canonicalName: string;
	if (previous === null) {
		canonicalName = await resolveAddedCanonicalName(actLineId, normalized);
	} else {
		assertPreviousEligible(actLineId, sceneNumber, previous);
		canonicalName = previous.canonicalName;
	}
	const next = buildEditedVersion(actLineId, sceneNumber, previous, normalized, canonicalName);
	await writeProfileVersions(actLineId, sceneNumber, [{ previous, next }]);
}

export async function removeProfile(
	actLineId: string,
	sceneNumber: number,
	previous: CharacterProfileEntity,
	mode: 'entry' | 'context'
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	if (mode !== 'entry' && mode !== 'context') {
		throw new Error(`Character profile removal mode must be "entry" or "context" (got ${String(mode)}).`);
	}
	if (!previous || typeof previous !== 'object') {
		throw new Error('Character profile removal rejected: the observed profile version is required.');
	}

	if (mode === 'entry') {
		if (previous.sceneNumber !== sceneNumber) {
			const origin = previous.sceneNumber === null ? 'the baseline' : `scene ${previous.sceneNumber}`;
			throw new Error(
				`Cannot remove the profile entry for "${previous.preferredName}": the observed version belongs to ${origin}, not the selected scene ${sceneNumber}. Only a selected-scene row can be deleted; erase any other version from context instead.`
			);
		}
		await deleteProfileEntry(actLineId, sceneNumber, previous);
		return;
	}

	const next = buildTombstoneVersion(actLineId, sceneNumber, previous);
	await writeProfileVersions(actLineId, sceneNumber, [{ previous, next }]);
}

interface RankedProfile {
	profile: CharacterProfileEntity;
	isDestination: boolean;
}

/**
 * Consolidation precedence: later profile scene first (baseline before numbered scenes),
 * then the destination on a scene tie, then the later update clock, then canonical name
 * ascending so a full tie still resolves reproducibly.
 */
function rankProfiles(destination: CharacterProfileEntity, sources: CharacterProfileEntity[]): RankedProfile[] {
	const candidates: RankedProfile[] = [
		{ profile: destination, isDestination: true },
		...sources.map((profile) => ({ profile, isDestination: false })),
	];
	return candidates.sort((a, b) => {
		const sceneA = a.profile.sceneNumber ?? -1;
		const sceneB = b.profile.sceneNumber ?? -1;
		if (sceneA !== sceneB) return sceneB - sceneA;
		if (a.isDestination !== b.isDestination) return a.isDestination ? -1 : 1;
		if (a.profile.updatedAt !== b.profile.updatedAt) return b.profile.updatedAt - a.profile.updatedAt;
		if (a.profile.canonicalName < b.profile.canonicalName) return -1;
		if (a.profile.canonicalName > b.profile.canonicalName) return 1;
		return 0;
	});
}

function assertMergeProfile(profile: CharacterProfileEntity, label: string): void {
	if (!profile || typeof profile !== 'object') {
		throw new Error(`Consolidation ${label} must be a character profile.`);
	}
	if (typeof profile.id !== 'string' || profile.id.length === 0) {
		throw new Error(`Consolidation ${label} has no id.`);
	}
	if (typeof profile.canonicalName !== 'string' || profile.canonicalName.length === 0) {
		throw new Error(`Consolidation ${label} "${profile.id}" has no canonical name.`);
	}
	if (typeof profile.preferredName !== 'string' || profile.preferredName.length === 0) {
		throw new Error(`Consolidation ${label} "${profile.id}" has no preferred name.`);
	}
	if (!Array.isArray(profile.aliases) || profile.aliases.some((alias) => typeof alias !== 'string')) {
		throw new Error(`Consolidation ${label} "${profile.id}" has invalid aliases.`);
	}
	if (!Array.isArray(profile.traits) || profile.traits.some((trait) => typeof trait !== 'string')) {
		throw new Error(`Consolidation ${label} "${profile.id}" has invalid traits.`);
	}
	if (profile.sceneNumber !== null && !Number.isInteger(profile.sceneNumber)) {
		throw new Error(`Consolidation ${label} "${profile.id}" has an invalid scene number.`);
	}
	if (!Number.isFinite(profile.updatedAt)) {
		throw new Error(`Consolidation ${label} "${profile.id}" has no valid update clock.`);
	}
	if (typeof profile.sceneDetails !== 'string' || typeof profile.logline !== 'string') {
		throw new Error(`Consolidation ${label} "${profile.id}" has invalid serialized content.`);
	}
	normalizeImportance(profile.importance);
}

export function mergeProfileContent(destination: CharacterProfileEntity, sources: CharacterProfileEntity[]): ProfileDraft {
	assertMergeProfile(destination, 'destination');
	if (!Array.isArray(sources)) {
		throw new Error('Consolidation sources must be an array of character profiles.');
	}
	for (const source of sources) assertMergeProfile(source, 'source');

	const ranked = rankProfiles(destination, sources);
	const winner = ranked[0].profile;

	const aliases = ensurePreferredInAliases(destination.preferredName, [
		...destination.aliases,
		...sources.flatMap((source) => [source.preferredName, ...source.aliases]),
	]);

	// Scene entries are keyed by scene number, not by profile freshness: the top-ranked
	// profile supplies the base, then lower-ranked profiles fill only missing scenes.
	const entries: SceneDetailEntry[] = [];
	const seenScenes = new Set<number>();
	for (const candidate of ranked) {
		for (const entry of parseSceneDetails(candidate.profile.sceneDetails)) {
			if (seenScenes.has(entry.sceneNumber)) continue;
			seenScenes.add(entry.sceneNumber);
			entries.push(entry);
		}
	}

	return {
		preferredName: destination.preferredName,
		aliases,
		logline: winner.logline,
		state: winner.state,
		goal: winner.goal,
		relationships: winner.relationships,
		voice: winner.voice,
		traits: normalizeTraits(winner.traits),
		sceneDetails: serializeSceneDetailEntries(entries),
		importance: normalizeImportance(winner.importance),
	};
}

function assertConsolidationProfile(profile: CharacterProfileEntity, actLineId: string, sceneNumber: number, label: string): void {
	assertMergeProfile(profile, label);
	if (profile.actLineId !== actLineId) {
		throw new Error(
			`Consolidation ${label} "${profile.id}" belongs to act line "${profile.actLineId}", but the operation targets act line "${actLineId}".`
		);
	}
	if (profile.removed) {
		throw new Error(`Consolidation ${label} "${profile.id}" is already removed; only active profiles can be consolidated.`);
	}
	if (profile.sceneNumber !== null && profile.sceneNumber > sceneNumber) {
		throw new Error(
			`Consolidation ${label} "${profile.id}" belongs to scene ${profile.sceneNumber}, which is later than the selected scene ${sceneNumber}.`
		);
	}
}

export async function consolidateProfiles(
	actLineId: string,
	sceneNumber: number,
	destination: CharacterProfileEntity,
	sources: CharacterProfileEntity[]
): Promise<void> {
	assertActLineId(actLineId);
	assertSceneNumber(sceneNumber);
	if (!Array.isArray(sources) || sources.length === 0) {
		throw new Error('Consolidation requires at least one source profile.');
	}
	assertConsolidationProfile(destination, actLineId, sceneNumber, 'destination');
	const seenIds = new Set<string>([destination.id]);
	for (const source of sources) {
		assertConsolidationProfile(source, actLineId, sceneNumber, 'source');
		if (seenIds.has(source.id)) {
			throw new Error(
				`Consolidation sources must be distinct active profiles and must exclude the destination; "${source.id}" appears more than once.`
			);
		}
		seenIds.add(source.id);
	}

	const now = Date.now();
	const draft = normalizeDraft(mergeProfileContent(destination, sources));
	const destinationNext = buildEditedVersion(actLineId, sceneNumber, destination, draft, destination.canonicalName, now);
	const writes = [
		{ previous: destination, next: destinationNext },
		...sources.map((source) => ({
			previous: source,
			next: buildTombstoneVersion(actLineId, sceneNumber, source, now),
		})),
	];
	await writeProfileVersions(actLineId, sceneNumber, writes);
}
