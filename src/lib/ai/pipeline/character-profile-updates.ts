import { marked } from 'marked';
import { parseContent } from '#lib/utils/chat-stream-parser/index.ts';
import {
	ensurePreferredInAliases,
	getLatestProfileByAlias,
	getLatestProfilesByActLine,
	toCanonicalName,
	type CharacterProfileEntity,
} from '#lib/db/character-profiles.ts';
import type { ProfileUpdateInput } from '#lib/ai/pipeline/types.ts';
import type { ProfileUpdateLabels } from '#lib/definitions/pipeline-prompts.ts';

export type ProfileUpdateBatchResult = { ok: true; updates: ProfileUpdateInput[] } | { ok: false; errors: string[] };

type ScalarField = 'preferredName' | 'logline' | 'state' | 'goal' | 'relationships' | 'voice' | 'importance';
type CollectionField = 'aliases' | 'traits';
type ClearField = 'logline' | 'state' | 'goal' | 'relationships' | 'voice' | 'traits';

const SCALAR_FIELDS: ScalarField[] = ['preferredName', 'logline', 'state', 'goal', 'relationships', 'voice', 'importance'];
const CLEAR_FIELDS: ClearField[] = ['logline', 'state', 'goal', 'relationships', 'voice', 'traits'];
const COLLECTION_FIELDS: CollectionField[] = ['aliases', 'traits'];

const assignScalar: Record<ScalarField, (update: ProfileUpdateInput, value: string) => void> = {
	preferredName: (update, value) => (update.preferredName = value),
	logline: (update, value) => (update.logline = value),
	state: (update, value) => (update.state = value),
	goal: (update, value) => (update.goal = value),
	relationships: (update, value) => (update.relationships = value),
	voice: (update, value) => (update.voice = value),
	importance: (update, value) => (update.importance = Number(value)),
};

const assignCollection: Record<CollectionField, (update: ProfileUpdateInput, items: string[]) => void> = {
	aliases: (update, items) => (update.aliases = items),
	traits: (update, items) => (update.traits = items),
};

const assignClear: Record<ClearField, (update: ProfileUpdateInput) => void> = {
	logline: (update) => (update.logline = null),
	state: (update) => (update.state = null),
	goal: (update) => (update.goal = null),
	relationships: (update) => (update.relationships = null),
	voice: (update) => (update.voice = null),
	traits: (update) => (update.traits = []),
};

interface MarkedToken {
	type: string;
	depth?: number;
	text?: string;
	items?: { task?: boolean; tokens?: { type: string }[] }[];
}

const PLAIN_ITEM_TOKENS = new Set(['text', 'paragraph', 'space', 'escape', 'br']);

function normalizeLabel(label: string): string {
	return label.trim().toLowerCase();
}

function fail(errors: string[]): { ok: false; errors: string[] } {
	return { ok: false, errors };
}

function isScalarField(value: string): value is ScalarField {
	return (SCALAR_FIELDS as string[]).includes(value);
}

function isCollectionField(value: string): value is CollectionField {
	return (COLLECTION_FIELDS as string[]).includes(value);
}

function isClearField(value: string): value is ClearField {
	return (CLEAR_FIELDS as string[]).includes(value);
}

/** Structural allow-list: envelope, count list, level-two records, direct scalars, level-three collections. */
function auditStructure(text: string, labels: ProfileUpdateLabels): string | null {
	const tokens = marked.lexer(text) as unknown as MarkedToken[];
	let seenEnvelope = false;
	let seenCount = false;
	let phase: 'start' | 'envelope' | 'record' | 'collection' = 'start';
	let listSeen = false;
	const seenSections = new Set<string>();

	const allowedSections = [labels.fields.aliases, labels.fields.traits, labels.clearFields].map(normalizeLabel);

	for (const token of tokens) {
		if (token.type === 'space') continue;

		if (token.type === 'heading') {
			const depth = token.depth ?? 1;
			const heading = normalizeLabel(token.text ?? '');
			if (depth === 1) {
				if (seenEnvelope) return 'Unexpected extra level-one heading.';
				if (phase !== 'start') return 'The envelope heading must come first.';
				if (heading !== normalizeLabel(labels.envelope)) return `Unknown envelope heading "${token.text ?? ''}".`;
				seenEnvelope = true;
				phase = 'envelope';
				listSeen = false;
				continue;
			}
			if (depth === 2) {
				if (!seenEnvelope || !seenCount) return 'Character records must follow the envelope update count.';
				phase = 'record';
				listSeen = false;
				seenSections.clear();
				continue;
			}
			if (depth === 3) {
				if (phase !== 'record' && phase !== 'collection') return 'A section heading must belong to a character record.';
				if (!allowedSections.includes(heading)) return `Unknown section heading "${token.text ?? ''}".`;
				if (seenSections.has(heading)) return `Duplicate section "${token.text ?? ''}".`;
				seenSections.add(heading);
				phase = 'collection';
				listSeen = false;
				continue;
			}
			return `Unsupported heading depth ${depth}.`;
		}

		if (token.type === 'list') {
			if (phase === 'envelope') {
				if (seenCount) return 'Unexpected extra list in the envelope.';
				seenCount = true;
			} else if (phase === 'record' || phase === 'collection') {
				if (listSeen) return 'Unexpected extra list in a character record.';
				listSeen = true;
			} else {
				return 'Unexpected list before the envelope.';
			}
			for (const item of token.items ?? []) {
				if (item.task) return 'Task-list syntax is not supported.';
				for (const inner of item.tokens ?? []) {
					if (!PLAIN_ITEM_TOKENS.has(inner.type)) {
						return `Unsupported nested content "${inner.type}" in a list item.`;
					}
				}
			}
			continue;
		}

		return `Unsupported content block "${token.type}".`;
	}

	if (!seenEnvelope) return 'Missing the character profile updates envelope.';
	if (!seenCount) return 'Missing the update count.';
	return null;
}

function extractListItems(source: string): string[] {
	return parseContent<{ items: string[] }>(source, [
		{ outputPath: 'items', match: { type: 'list' }, bodyOnly: true, currentLevelOnly: true },
	]).items;
}

function collectionItems(source: string | null): string[] {
	if (source === null) return [];
	return extractListItems(source);
}

interface ParsedRecord {
	name: string;
	scalars: Map<ScalarField, string>;
	collections: Map<CollectionField, string[]>;
	clears: ClearField[];
}

function parseRecord(block: string, labels: ProfileUpdateLabels, index: number): ParsedRecord | string {
	const extracted = parseContent<{
		name: string | null;
		scalars: string | null;
		aliases: string | null;
		traits: string | null;
		clear: string | null;
	}>(block, [
		{ outputPath: 'name', match: { type: 'header', headerLevel: 2 }, currentLevelOnly: true, selfContentOnly: true },
		{ outputPath: 'scalars', match: { type: 'header', headerLevel: 2 }, bodyOnly: true, currentLevelOnly: true },
		{
			outputPath: 'aliases',
			match: { type: 'header', content: labels.fields.aliases, headerLevel: 3 },
			bodyOnly: true,
			currentLevelOnly: true,
		},
		{
			outputPath: 'traits',
			match: { type: 'header', content: labels.fields.traits, headerLevel: 3 },
			bodyOnly: true,
			currentLevelOnly: true,
		},
		{
			outputPath: 'clear',
			match: { type: 'header', content: labels.clearFields, headerLevel: 3 },
			bodyOnly: true,
			currentLevelOnly: true,
		},
	]);

	const name = (extracted.name ?? '').trim();
	const where = `Record ${index + 1}${name ? ` ("${name}")` : ''}`;
	if (!name) return `${where}: the character name is blank.`;

	const scalars = new Map<ScalarField, string>();
	const labelToScalar = new Map(SCALAR_FIELDS.map((field) => [normalizeLabel(labels.fields[field]), field]));
	for (const item of extractListItems(extracted.scalars ?? '')) {
		const colon = item.indexOf(':');
		if (colon < 0) return `${where}: "${item.trim()}" is not a "Label: value" item.`;
		const label = normalizeLabel(item.slice(0, colon));
		const value = item.slice(colon + 1).trim();
		if (isCollectionField(label) || label === normalizeLabel(labels.clearFields)) {
			return `${where}: "${item.slice(0, colon).trim()}" belongs in its own section, not a scalar item.`;
		}
		const field = labelToScalar.get(label);
		if (!field || !isScalarField(field)) return `${where}: unknown field "${item.slice(0, colon).trim()}".`;
		if (scalars.has(field)) return `${where}: duplicate field "${labels.fields[field]}".`;
		scalars.set(field, value);
	}

	const collections = new Map<CollectionField, string[]>();
	for (const field of COLLECTION_FIELDS) {
		if (extracted[field] === null) continue;
		const items = collectionItems(extracted[field]).map((item) => item.trim());
		const seen = new Set<string>();
		for (const item of items) {
			const key = item.toLowerCase();
			if (seen.has(key)) return `${where}: duplicate ${labels.fields[field]} item "${item}".`;
			seen.add(key);
		}
		if (field === 'aliases' && items.some((item) => item.length === 0)) return `${where}: an alias is blank.`;
		collections.set(field, items);
	}

	const clears: ClearField[] = [];
	const clearSeen = new Set<string>();
	for (const item of collectionItems(extracted.clear)) {
		const key = normalizeLabel(item);
		const field = CLEAR_FIELDS.find((f) => normalizeLabel(labels.fields[f]) === key);
		if (!field || !isClearField(field)) return `${where}: unknown clear field "${item.trim()}".`;
		if (clearSeen.has(field)) return `${where}: duplicate clear field "${item.trim()}".`;
		clearSeen.add(field);
		clears.push(field);
	}

	for (const field of clears) {
		if (field === 'traits') {
			if (collections.has('traits')) return `${where}: traits are both supplied and cleared.`;
			continue;
		}
		if (scalars.has(field)) return `${where}: "${labels.fields[field]}" is both supplied and cleared.`;
	}

	if (scalars.get('preferredName') !== undefined && scalars.get('preferredName')!.length === 0) {
		return `${where}: the preferred name is blank.`;
	}
	const importance = scalars.get('importance');
	if (importance !== undefined) {
		if (!/^\d+$/.test(importance) || Number(importance) < 1 || Number(importance) > 4) {
			return `${where}: importance must be an integer from 1 to 4.`;
		}
	}

	return { name, scalars, collections, clears };
}

/** Parse one complete compressor batch; no storage or counters are touched. */
export function parseProfileUpdates(text: string, labels: ProfileUpdateLabels): ProfileUpdateBatchResult {
	const structureError = auditStructure(text, labels);
	if (structureError) return fail([structureError]);

	const { envelopes } = parseContent<{ envelopes: string[] }>(text, [
		{ outputPath: 'envelopes', match: { type: 'multi-headers', headerLevel: 1 } },
	]);
	const countItems = extractListItems(envelopes[0] ?? '');
	if (countItems.length !== 1) return fail([`The envelope must contain exactly one "${labels.count}" item.`]);
	const countItem = countItems[0]!;
	const colon = countItem.indexOf(':');
	if (colon < 0) return fail([`"${countItem.trim()}" is not a "${labels.count}: value" item.`]);
	if (normalizeLabel(countItem.slice(0, colon)) !== normalizeLabel(labels.count)) {
		return fail([`The envelope must start with "${labels.count}".`]);
	}
	const countText = countItem.slice(colon + 1).trim();
	if (!/^\d+$/.test(countText)) return fail([`"${labels.count}" must be a non-negative integer.`]);
	const count = Number(countText);

	const { blocks } = parseContent<{ blocks: string[] }>(text, [{ outputPath: 'blocks', match: { type: 'multi-headers', headerLevel: 2 } }]);
	if (count !== blocks.length) {
		return fail([`"${labels.count}" is ${count} but the batch has ${blocks.length} character record(s).`]);
	}

	const updates: ProfileUpdateInput[] = [];
	const names = new Set<string>();
	for (const [index, block] of blocks.entries()) {
		const record = parseRecord(block, labels, index);
		if (typeof record === 'string') return fail([record]);
		const key = record.name.toLowerCase();
		if (names.has(key)) return fail([`Duplicate character record "${record.name}".`]);
		names.add(key);

		const update: ProfileUpdateInput = { name: record.name };
		for (const [field, value] of record.scalars) assignScalar[field](update, value);
		for (const [field, items] of record.collections) assignCollection[field](update, items);
		for (const field of record.clears) assignClear[field](update);
		updates.push(update);
	}

	return { ok: true, updates };
}

interface IdentityView {
	canonicalName: string;
	preferredName: string;
	aliases: string[];
}

function toIdentityView(profiles: CharacterProfileEntity[]): Map<string, IdentityView> {
	return new Map(
		profiles.map((profile) => [
			profile.canonicalName,
			{ canonicalName: profile.canonicalName, preferredName: profile.preferredName, aliases: profile.aliases },
		])
	);
}

/** Same matching rules as getLatestProfileByAlias, applied to an in-memory view. */
function matchesName(identity: IdentityView, name: string): boolean {
	const canonical = toCanonicalName(name);
	return (
		identity.canonicalName === canonical ||
		identity.preferredName === name ||
		identity.aliases.some((alias) => toCanonicalName(alias) === canonical)
	);
}

function matchingIdentities(view: Map<string, IdentityView>, name: string): IdentityView[] {
	return [...view.values()].filter((identity) => matchesName(identity, name));
}

function sameIdentities(a: IdentityView[], b: IdentityView[]): boolean {
	const setA = new Set(a.map((identity) => identity.canonicalName));
	const setB = new Set(b.map((identity) => identity.canonicalName));
	return setA.size === setB.size && [...setA].every((canonical) => setB.has(canonical));
}

function cleanupPreferredName(preferred: string): string {
	return preferred.replace(/^\[(.+)\]$/, '$1').trim();
}

/**
 * Read-only identity preflight. Applies the batch to an identity-only view in
 * output order and rejects any lookup the earlier additions would redefine.
 */
export async function validateProfileUpdateTargets(actLineId: string, updates: ProfileUpdateInput[]): Promise<ProfileUpdateBatchResult> {
	if (updates.length === 0) return { ok: true, updates };

	const latest = await getLatestProfilesByActLine(actLineId);
	const baseline = toIdentityView(latest);
	const view = toIdentityView(latest);
	const targets = new Set<string>();

	for (const [index, update] of updates.entries()) {
		const where = `Update ${index + 1} ("${update.name}")`;
		const baselineMatches = matchingIdentities(baseline, update.name);
		const simulatedMatches = matchingIdentities(view, update.name);
		const baselineTarget = await getLatestProfileByAlias(actLineId, update.name);

		let target: IdentityView;
		if (simulatedMatches.length === 0) {
			if (baselineTarget) {
				return fail([`${where}: earlier updates changed which identity this name resolves to.`]);
			}
			const canonical = toCanonicalName(update.name);
			if (!canonical) return fail([`${where}: the name does not canonicalize to an identity.`]);
			target = { canonicalName: canonical, preferredName: '', aliases: [] };
		} else if (simulatedMatches.length === 1) {
			target = simulatedMatches[0]!;
			if (!baselineTarget || baselineTarget.canonicalName !== target.canonicalName) {
				return fail([`${where}: earlier updates changed which identity this name resolves to.`]);
			}
			if (baselineMatches.length > 1 && !sameIdentities(baselineMatches, simulatedMatches)) {
				return fail([`${where}: earlier updates changed the identities this name resolves to.`]);
			}
		} else {
			if (!baselineTarget || !sameIdentities(baselineMatches, simulatedMatches)) {
				return fail([`${where}: earlier updates made this name ambiguous between multiple identities.`]);
			}
			target = view.get(baselineTarget.canonicalName)!;
		}

		if (targets.has(target.canonicalName)) {
			return fail([`${where}: duplicates the target identity of an earlier update.`]);
		}

		const preferredName = cleanupPreferredName(update.preferredName ?? (target.preferredName || update.name));
		if (!preferredName) return fail([`${where}: the preferred name is blank.`]);
		const aliases = ensurePreferredInAliases(preferredName, [...new Set([...target.aliases, ...(update.aliases ?? [])])]);

		const owned = new Set([target.preferredName, ...target.aliases].filter(Boolean).map(toCanonicalName));
		const added = [preferredName, ...(update.aliases ?? [])];
		for (const name of added) {
			const canonical = toCanonicalName(name);
			if (!canonical || owned.has(canonical)) continue;
			const collisions = matchingIdentities(view, name).filter((identity) => identity.canonicalName !== target.canonicalName);
			if (collisions.length > 0) {
				return fail([`${where}: "${name}" would make multiple identities share a name.`]);
			}
		}

		targets.add(target.canonicalName);
		view.set(target.canonicalName, { canonicalName: target.canonicalName, preferredName, aliases });
	}

	return { ok: true, updates };
}
