import {
	createActLine,
	getActLine,
	getMessagesForLine,
	insertActLineEntries,
	removeMessagesFromActLine,
} from '$lib/db/act-lines';
import { getMessagesByIds, insertMessage, type Message } from '$lib/db/messages';

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

export type MergeAction = 'no-op' | 'fast-forward' | 'forked';

export interface MergeIncomingInput {
	actLineId: string;
	incomingEntries: { actLineId: string; messageId: string; sequence: number }[];
	incomingMessages: Message[];
	forkNameSuffix: string;
}

export interface MergeResult {
	action: MergeAction;
	forkActLineId?: string;
}

export async function mergeIncomingActLine(input: MergeIncomingInput): Promise<MergeResult> {
	const localIds = (await getMessagesForLine(input.actLineId)).map((m) => m.id);
	const incomingSorted = [...input.incomingEntries].sort((a, b) => a.sequence - b.sequence);
	const incomingIds = incomingSorted.map((e) => e.messageId);

	const { decision } = compareLineages(localIds, incomingIds);
	if (decision === 'identical' || decision === 'remote-stale') {
		return { action: 'no-op' };
	}

	// Add-only message rule: only insert IDs missing locally; never overwrite.
	const existing = new Set((await getMessagesByIds(incomingIds)).map((m) => m.id));
	for (const message of input.incomingMessages) {
		if (!existing.has(message.id)) await insertMessage(message);
	}

	if (decision === 'local-stale') {
		const newEntries = incomingSorted
			.filter((e) => e.sequence >= localIds.length)
			.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }));
		await insertActLineEntries(newEntries);
		return { action: 'fast-forward' };
	}

	// Divergent: fork local first so message reference counts stay > 0, then
	// yield the original act-line ID to the incoming lineage.
	const meta = await getActLine(input.actLineId);
	if (!meta) throw new Error(`Act line ${input.actLineId} not found during merge`);

	const fork = await createActLine(
		crypto.randomUUID(),
		meta.actId,
		`${meta.name} ${input.forkNameSuffix}`,
		false,
		meta.plotMode
	);
	await insertActLineEntries(
		localIds.map((messageId, sequence) => ({ actLineId: fork.id, messageId, sequence }))
	);
	await removeMessagesFromActLine(input.actLineId, localIds);
	await insertActLineEntries(
		incomingSorted.map((e) => ({ actLineId: input.actLineId, messageId: e.messageId, sequence: e.sequence }))
	);

	return { action: 'forked', forkActLineId: fork.id };
}
