/**
 * Convert a string to kebab-case.
 * Lowercases, replaces spaces and special chars with hyphens, collapses multiple hyphens.
 * Preserves Unicode letters.
 */
export function toKebabCase(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[/\\<>:"|?*]/g, '-')
		.replace(/[^a-z0-9\p{L}]+/gu, '-')
		.replace(/^-+|-+$/g, '');
}