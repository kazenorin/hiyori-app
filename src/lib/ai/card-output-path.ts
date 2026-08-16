import { kebabCase } from 'lodash-es';
import { fs, type DirEntry } from '$lib/fs/file-system';
import { log } from '$lib/logging/logger';

/**
 * Convert an act line name into a kebab-case suffix for the folder name.
 * Limits to the first 8 words and caps at 100 characters.
 * Returns empty string if the name produces no usable suffix.
 */
export function buildLineSubdirSuffix(name: string): string {
	if (!name || !name.trim()) return '';
	const kabob = kebabCase(name);
	if (!kabob) return '';
	const words = kabob.split('-').slice(0, 8);
	const suffix = words.join('-').slice(0, 100);
	return suffix;
}

/**
 * Compute the subdirectory name for an act line.
 * - "main-line" if the act line is the main line
 * - Last 8 characters of the act line ID, optionally with a suffix
 */
export function computeLineSubdir(isMainLine: boolean, actLineId: string, suffix?: string): string {
	if (isMainLine) return 'main-line';
	const idPart = actLineId.slice(-8);
	if (!suffix) return idPart;
	return `${idPart}-${suffix}`;
}

/**
 * Build the full directory path for an act line's generated content.
 * Pattern: {storyFolder}/act-{actNumber}/{lineSubdir}
 */
export function buildLineDir(storyFolder: string, actNumber: number, isMainLine: boolean, actLineId: string, suffix?: string): string {
	const subdir = computeLineSubdir(isMainLine, actLineId, suffix);
	return `${storyFolder}/act-${actNumber}/${subdir}`;
}

/**
 * Find an existing act line subdirectory on disk by matching the ID prefix.
 * Returns the matched subdirectory name or null if not found.
 */
export async function resolveLineSubdir(actDir: string, actLineId: string): Promise<string | null> {
	const idPart = actLineId.slice(-8);
	try {
		const entries = await fs.readDir(actDir);
		const matches = entries.filter((e: DirEntry) => e.isDirectory && e.name.startsWith(idPart)).map((e: DirEntry) => e.name);
		return matches.length === 1 ? matches[0] : null;
	} catch {
		return null;
	}
}

/**
 * Resolve the full directory path for an act line by searching for an existing folder.
 * Falls back to computing the path (without suffix) if no existing folder is found.
 */
export async function resolveLineDir(storyFolder: string, actNumber: number, actLineId: string): Promise<string> {
	const actDir = `${storyFolder}/act-${actNumber}`;
	const subdir = await resolveLineSubdir(actDir, actLineId);
	if (subdir) return `${actDir}/${subdir}`;
	return `${actDir}/${computeLineSubdir(false, actLineId)}`;
}

/**
 * Resolve the directory path for an act line, handling both main and non-main lines.
 * Uses a direct path for main lines, resolves from disk for non-main lines.
 */
export async function getLineDir(storyFolder: string, actNumber: number, isMainLine: boolean, actLineId: string): Promise<string> {
	if (isMainLine) return buildLineDir(storyFolder, actNumber, true, actLineId);
	return resolveLineDir(storyFolder, actNumber, actLineId);
}

/**
 * Copy the act-plot.md file from one act line's directory to another's,
 * creating the target directory as needed. Forked lines are mirror copies, so
 * opening a fork later must not regenerate the act plot via the LLM — except
 * interview forks, which are meant to diverge and don't call this.
 * Filesystem errors (missing source file, unready folders) are swallowed and
 * logged, same as the store's fork path.
 */
export async function copyActPlotFileBetweenLines(options: {
	storyFolder: string;
	actNumber: number;
	sourceLineId: string;
	sourceIsMainLine: boolean;
	targetLineId: string;
	targetName: string;
}): Promise<void> {
	const { storyFolder, actNumber, sourceLineId, sourceIsMainLine, targetLineId, targetName } = options;
	try {
		const fromDir = await getLineDir(storyFolder, actNumber, sourceIsMainLine, sourceLineId);
		const toDir = buildLineDir(storyFolder, actNumber, false, targetLineId, buildLineSubdirSuffix(targetName));
		const fromPath = `${fromDir}/act-plot.md`;
		const toPath = `${toDir}/act-plot.md`;

		if (await fs.exists(fromPath)) {
			await fs.mkdir(toDir);
			await fs.copyFile(fromPath, toPath);
		}
	} catch (err) {
		await log.error('fork', 'Failed to copy act-plot for fork', err);
	}
}

export { computeLineSubdir as _computeLineSubdirForTest, buildLineSubdirSuffix as _buildLineSubdirSuffixForTest };
