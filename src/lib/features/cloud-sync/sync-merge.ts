export type LineageDecision = 'identical' | 'remote-stale' | 'local-stale' | 'divergent';

export interface LineageComparison {
	decision: LineageDecision;
	commonPrefixLength: number;
}

/**
 * Compares ordered message-ID lineages of one act line (local vs incoming).
 * Sequential-use sync model: both sides derive from a common synced ancestor,
 * so a shared prefix is guaranteed and the comparison is prefix-based.
 */
export function compareLineages(local: string[], incoming: string[]): LineageComparison {
	let commonPrefixLength = 0;
	while (
		commonPrefixLength < local.length &&
		commonPrefixLength < incoming.length &&
		local[commonPrefixLength] === incoming[commonPrefixLength]
	) {
		commonPrefixLength++;
	}

	if (commonPrefixLength === local.length && commonPrefixLength === incoming.length) {
		return { decision: 'identical', commonPrefixLength };
	}
	if (commonPrefixLength === incoming.length) {
		return { decision: 'remote-stale', commonPrefixLength };
	}
	if (commonPrefixLength === local.length) {
		return { decision: 'local-stale', commonPrefixLength };
	}
	return { decision: 'divergent', commonPrefixLength };
}
