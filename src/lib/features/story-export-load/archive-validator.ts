import type JSZip from 'jszip';
import type { StoryExportData } from './archive-schema';

export interface ValidationResult {
	isValid: boolean;
	errors: string[];
	warnings: string[];
}

export function validateStoryData(data: unknown): ValidationResult {
	const errors: string[] = [];
	const warnings: string[] = [];

	if (!data || typeof data !== 'object') {
		return { isValid: false, errors: ['story-data.json is not a valid JSON object'], warnings };
	}

	const d = data as Record<string, unknown>;

	if (d.version !== 1) {
		errors.push(`Unsupported archive version: ${d.version ?? 'missing'}. Only version 1 is supported.`);
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
