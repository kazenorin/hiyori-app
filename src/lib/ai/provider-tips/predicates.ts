// noinspection RedundantIfStatementJS

import type { Provider } from '$lib/stores/settings.svelte';
import { isInKnownProviders, isModelVerifiedForBaseUrl } from './known-providers';

/**
 * Predicate DSL matchers. Each matcher checks a single field of the
 * TipEvaluationInput against a condition object from rules.yaml.
 *
 * Condition object shapes (all fields optional; multiple keys AND together)
 */

export type FieldCondition = {
	equals?: string;
	notEquals?: string;
	isNonEmpty?: true;
	in?: string[];
	notIn?: string[];
	startsWith?: string;
	notStartsWith?: string;
	endsWith?: string;
	notEndsWith?: string;
	startsWithAny?: string[];
	notStartsWithAny?: string[];
	endsWithAny?: string[];
	hostEquals?: string;
	hasNonRootPath?: true;
	hostNotLocalNotLan?: true;
	inKnownProviders?: true;
	inKnownProvidersForBaseUrl?: true;
};

/**
 * Evaluate a field condition against a string value.
 * For inKnownProviders / inKnownProvidersForBaseUrl the boolean baseURL / model
 * context is passed via the second argument.
 */
export function matchField(value: string, cond: FieldCondition, context: { baseURL: string; model: string }): boolean {
	if (cond.isNonEmpty !== undefined && !isNonEmpty(value)) return false;

	if (cond.equals !== undefined && !matchesEquals(value, cond.equals)) return false;
	if (cond.notEquals !== undefined && matchesEquals(value, cond.notEquals)) return false;

	if (cond.in !== undefined && !cond.in.includes(value)) return false;
	if (cond.notIn !== undefined && cond.notIn.includes(value)) return false;

	if (cond.startsWith !== undefined && !value.startsWith(cond.startsWith)) return false;
	if (cond.notStartsWith !== undefined && value.startsWith(cond.notStartsWith)) return false;

	if (cond.endsWith !== undefined && !value.endsWith(cond.endsWith)) return false;
	if (cond.notEndsWith !== undefined && value.endsWith(cond.notEndsWith)) return false;

	if (cond.startsWithAny !== undefined && !cond.startsWithAny.some((p) => value.startsWith(p))) {
		return false;
	}
	if (cond.notStartsWithAny !== undefined && cond.notStartsWithAny.some((p) => value.startsWith(p))) {
		return false;
	}

	if (cond.endsWithAny !== undefined && !cond.endsWithAny.some((s) => value.endsWith(s))) {
		return false;
	}

	if (cond.hostEquals !== undefined && !matchesHostEquals(value, cond.hostEquals)) return false;
	if (cond.hasNonRootPath !== undefined && !matchesHasNonRootPath(value)) return false;
	if (cond.hostNotLocalNotLan !== undefined && !matchesHostNotLocalNotLan(value)) return false;

	if (cond.inKnownProviders !== undefined) {
		const inList = isInKnownProviders(value);
		if (cond.inKnownProviders !== inList) return false;
	}
	if (cond.inKnownProvidersForBaseUrl !== undefined) {
		const isVerified = isModelVerifiedForBaseUrl(context.baseURL, context.model);
		if (cond.inKnownProvidersForBaseUrl !== isVerified) return false;
	}

	return true;
}

function isNonEmpty(value: string): boolean {
	return value.trim().length > 0;
}

function matchesEquals(value: string, expected: string): boolean {
	return value === expected;
}

/**
 * Parse the URL and compare host (hostname:port if port is non-default).
 */
function matchesHostEquals(value: string, expectedHost: string): boolean {
	try {
		const url = new URL(value);
		return url.host === expectedHost || url.hostname === expectedHost;
	} catch {
		return false;
	}
}

function matchesHasNonRootPath(value: string): boolean {
	try {
		const url = new URL(value);
		const path = url.pathname;
		return path.length > 1 && path !== '/';
	} catch {
		return false;
	}
}

/**
 * Check whether the host is NOT local and NOT LAN.
 * Local: localhost, 127.0.0.1, *.localhost
 * LAN: 10.*, 172.*, 192.168.*, *.local, *.internal, *.home.arpa
 */
function matchesHostNotLocalNotLan(value: string): boolean {
	try {
		const url = new URL(value);
		const host = url.hostname;

		if (host === 'localhost' || host === '127.0.0.1' || host.endsWith('.localhost')) return false;
		if (host.startsWith('10.') || host.startsWith('172.') || host.startsWith('192.168.')) return false;
		if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return false;

		return true;
	} catch {
		return false;
	}
}

/**
 * A `when` block is a record of field-name → FieldCondition plus the special
 * `pageProtocol` top-level key. All entries must match (AND).
 */
export interface WhenBlock {
	provider?: FieldCondition;
	baseURL?: FieldCondition;
	model?: FieldCondition;
	corsBypassEnabled?: { equals?: boolean };
	pageProtocol?: { equals?: 'http' | 'https' };
}

/**
 * Evaluate an entire `when` block against the input snapshot.
 */
export function matchWhen(
	when: WhenBlock,
	input: {
		provider: Provider;
		baseURL: string;
		model: string;
		corsBypassEnabled: boolean;
		pageProtocol?: 'http' | 'https';
	}
): boolean {
	if (when.provider && !matchField(input.provider, when.provider, input)) return false;
	if (when.baseURL && !matchField(input.baseURL, when.baseURL, input)) return false;
	if (when.model && !matchField(input.model, when.model, input)) return false;
	if (when.corsBypassEnabled && when.corsBypassEnabled.equals !== undefined && input.corsBypassEnabled !== when.corsBypassEnabled.equals) {
		return false;
	}
	if (when.pageProtocol && when.pageProtocol.equals !== undefined && input.pageProtocol !== when.pageProtocol.equals) {
		return false;
	}
	return true;
}
