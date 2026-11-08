import type { CharacterProfileEntity } from '#lib/db/character-profiles.ts';
import { normalizeSceneDetailText, parseSceneDetails } from '#lib/definitions/pipeline-sections.ts';

/**
 * Locate the version a save produced. A same-scene edit keeps its id, but editing a baseline or
 * earlier version copies the profile under a new id, so the canonical identity is the stable
 * fallback. Adds are matched by the submitted name: duplicate rejection keeps it unique.
 */
export function findSavedProfile(
	profiles: CharacterProfileEntity[],
	previous: CharacterProfileEntity | null,
	preferredName: string
): CharacterProfileEntity | null {
	if (previous !== null) {
		const sameId = profiles.find((profile) => profile.id === previous.id);
		if (sameId) return sameId;
		const sameIdentity = profiles.find((profile) => profile.canonicalName === previous.canonicalName);
		if (sameIdentity) return sameIdentity;
	}
	const name = preferredName.trim();
	return profiles.find((profile) => profile.preferredName.trim() === name) ?? null;
}

/** Stored details may still be descending from older saves; display them oldest first. */
export function formatSceneDetailsAscending(sceneDetails: string): string {
	const entries = parseSceneDetails(sceneDetails);
	if (entries.length === 0) return sceneDetails.trim();
	return entries
		.sort((a, b) => a.sceneNumber - b.sceneNumber)
		.map((entry) => `- ${entry.sceneNumber}: ${normalizeSceneDetailText(entry.details)}`)
		.join('\n');
}

/**
 * Warn until the compressor has run at the selected scene: edits made after its last run may be
 * overwritten when it next runs. A disabled compressor never runs, so no warning is needed.
 */
export function shouldShowCompressionWarning(
	sceneNumber: number,
	lastCompressionScene: number | null,
	compressorInterval: number
): boolean {
	if (compressorInterval <= 0) return false;
	return lastCompressionScene !== sceneNumber;
}
