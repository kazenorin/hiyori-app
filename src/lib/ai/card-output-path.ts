import { mkdir, BaseDirectory } from '@tauri-apps/plugin-fs';

/**
 * Compute the subdirectory name for an act line.
 * - "main-line" if the act line is the main line
 * - Last 8 characters of the act line ID if not main line
 */
export function computeLineSubdir(isMainLine: boolean, actLineId: string): string {
	if (isMainLine) return 'main-line';
	return actLineId.slice(-8);
}

/**
 * Build the full directory path for an act line's generated content.
 * Pattern: {storyFolder}/act-{actNumber}/{lineSubdir}
 */
export function buildLineDir(
	storyFolder: string,
	actNumber: number,
	isMainLine: boolean,
	actLineId: string
): string {
	const subdir = computeLineSubdir(isMainLine, actLineId);
	return `${storyFolder}/act-${actNumber}/${subdir}`;
}

export { computeLineSubdir as _computeLineSubdirForTest };