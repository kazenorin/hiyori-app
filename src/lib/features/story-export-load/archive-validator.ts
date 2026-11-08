import type JSZip from 'jszip';
import type { StoryExportData } from './archive-schema';
import { CURRENT_ARCHIVE_VERSION } from './archive-schema';

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}

const isNullableString = (value: unknown): boolean => value === null || value === undefined || typeof value === 'string';

/**
 * Shape check for one `characterProfiles` entry. `removed` is optional for
 * v1–v4 archives; when present it must be a real boolean (no coercion).
 */
function isCharacterProfileEntry(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const p = value as Record<string, unknown>;
	return (
		typeof p.id === 'string' &&
		typeof p.actLineId === 'string' &&
		(p.sceneNumber === null || (typeof p.sceneNumber === 'number' && Number.isInteger(p.sceneNumber))) &&
		typeof p.canonicalName === 'string' &&
		typeof p.preferredName === 'string' &&
		Array.isArray(p.aliases) &&
		p.aliases.every((alias) => typeof alias === 'string') &&
		typeof p.logline === 'string' &&
		isNullableString(p.state) &&
		isNullableString(p.goal) &&
		isNullableString(p.relationships) &&
		isNullableString(p.voice) &&
		(p.traits === undefined || (Array.isArray(p.traits) && p.traits.every((trait) => typeof trait === 'string'))) &&
		typeof p.sceneDetails === 'string' &&
		(p.importance === 1 || p.importance === 2 || p.importance === 3 || p.importance === 4) &&
		(p.removed === undefined || typeof p.removed === 'boolean') &&
		Number.isFinite(p.createdAt) &&
		Number.isFinite(p.updatedAt)
	);
}

export function validateStoryData(data: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!data || typeof data !== 'object') {
		return { isValid: false, errors: ['story-data.json is not a valid JSON object'], warnings };
	}

	const d = data as Record<string, unknown>;

	if (typeof d.version !== 'number' || d.version < 1 || d.version > CURRENT_ARCHIVE_VERSION) {
		errors.push(`Unsupported archive version: ${d.version ?? 'missing'}. Supported versions: 1–${CURRENT_ARCHIVE_VERSION}.`);
		return { isValid: false, errors, warnings };
	}

	if (!d.story || typeof d.story !== 'object') {
		errors.push('Missing or invalid "story" field');
	}
	if (!d.storyFolder || typeof d.storyFolder !== 'object') {
		errors.push('Missing or invalid "storyFolder" field');
	}
	if (!Array.isArray(d.acts)) {
		errors.push('Missing or invalid "acts" field (expected array)');
	}
	if (!Array.isArray(d.actLineMeta)) {
		errors.push('Missing or invalid "actLineMeta" field (expected array)');
	}
	if (!Array.isArray(d.messages)) {
		errors.push('Missing or invalid "messages" field (expected array)');
	}

	if (d.story && typeof d.story === 'object') {
		const s = d.story as Record<string, unknown>;
		if (!s.id || typeof s.id !== 'string') errors.push('story.id is missing or not a string');
		if (!s.name || typeof s.name !== 'string') errors.push('story.name is missing or not a string');
	}

	if (d.storyFolder && typeof d.storyFolder === 'object') {
		const sf = d.storyFolder as Record<string, unknown>;
		if (!sf.folderName || typeof sf.folderName !== 'string') errors.push('storyFolder.folderName is missing or not a string');
	}

	if (d.messagePhases !== undefined) {
		if (!Array.isArray(d.messagePhases)) {
			errors.push('Invalid "messagePhases" field (expected array)');
		} else {
			const hasMalformed = d.messagePhases.some((p) => {
				if (!p || typeof p !== 'object') return true;
				const r = p as Record<string, unknown>;
				return (
					typeof r.messageId !== 'string' ||
					typeof r.phaseName !== 'string' ||
					typeof r.content !== 'string' ||
					typeof r.sequence !== 'number' ||
					!(r.reasoning === null || r.reasoning === undefined || typeof r.reasoning === 'string')
				);
			});
			if (hasMalformed) {
				errors.push(
					'messagePhases contains malformed elements (expected {messageId, phaseName, content: string, sequence: number, reasoning: string|null})'
				);
			}
		}
	}

	if (d.characterProfiles !== undefined) {
		if (!Array.isArray(d.characterProfiles)) {
			errors.push('Invalid "characterProfiles" field (expected array)');
		} else if (!d.characterProfiles.every(isCharacterProfileEntry)) {
			errors.push(
				'characterProfiles contains malformed elements (expected {id, actLineId, sceneNumber, canonicalName, preferredName, aliases: string[], logline, state, goal, relationships, voice, sceneDetails: string, importance: number, createdAt: number, updatedAt: number, optional traits: string[], removed: boolean})'
			);
		}
	}

	if (Array.isArray(d.actLineMeta) && d.actLineMeta.length === 0) {
		warnings.push('Archive contains no act lines');
	}

	return { isValid: errors.length === 0, errors, warnings };
}

export async function validateArchive(zip: JSZip): Promise<ValidationResult & { data?: StoryExportData }> {
	const warnings: string[] = [];

	const storyDataFile = zip.file('story-data.json');
	if (!storyDataFile) {
		return { isValid: false, errors: ['story-data.json not found in archive root'], warnings };
	}

	let parsed: unknown;
	try {
		const content = await storyDataFile.async('string');
		parsed = JSON.parse(content);
	} catch {
		return { isValid: false, errors: ['story-data.json is not valid JSON'], warnings };
	}

	const result = validateStoryData(parsed);
	if (!result.isValid) {
		return { isValid: false, errors: result.errors, warnings: result.warnings };
	}

	const data = parsed as StoryExportData;

	if (data.storyFolder.folderName) {
		const folderPrefix = data.storyFolder.folderName + '/';
		const hasFolderFiles = Object.keys(zip.files).some((path) => path.startsWith(folderPrefix));
		if (!hasFolderFiles) {
			warnings.push('Story folder not found in archive, but DB data is valid. File system files will not be restored.');
		}
	}

	return { isValid: true, errors: [], warnings, data };
}
