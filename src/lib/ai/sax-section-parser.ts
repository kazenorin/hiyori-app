import { type ContextNode, createMarkdownSaxParser, type ElementInfo } from '$lib/markdown/markdown-sax-parser';
import type { StreamParser } from './stream-parser';
import type { GameDataFields } from './narrative-types';
import { FIELD_DESCRIPTORS } from './narrative-types';
import { mergeGameDataFields } from './message-updater';
import { kebabCase } from 'lodash-es';

/** Key used on the accumulator to track which fields have been finalized with raw content. */
const FINALIZED_FIELDS_KEY = '__finalized';

// --- Element accumulator interface ---

interface ElementAccumulator {
	onEnterElement?(element: ElementInfo, context: readonly ContextNode[], acc: Record<string, unknown>): void;
	onLeaveElement?(element: ElementInfo, context: readonly ContextNode[], acc: Record<string, unknown>): void;
	onText?(text: string, context: readonly ContextNode[], acc: Record<string, unknown>): boolean;
}

// --- Header matching helpers ---

type HeaderMatcher = (normalizedName: string, context: readonly ContextNode[]) => boolean;

/**
 * Check if a header with the given kebab-case normalized name is in the context stack.
 */
function hasHeaderName(context: readonly ContextNode[], normalizedName: string): boolean {
	for (let i = context.length - 1; i >= 0; i--) {
		const node = context[i];
		if (node.type === 'header' && node.name && kebabCase(node.name) === normalizedName) {
			return true;
		}
	}
	return false;
}

// Special section name constants (kebab-case) — not field descriptors
const NAMES_GAME_DATA = kebabCase('Game Data');

// Game data subsection name constants in kebab-case
const SUB_ACTIVE_PLOT_THREADS = 'active-plot-threads' as const;
const SUB_DECISION_CONTEXT = 'decision-context' as const;
const SUB_DECISIONS = 'decisions' as const;

type Subsection = typeof SUB_ACTIVE_PLOT_THREADS | typeof SUB_DECISION_CONTEXT | typeof SUB_DECISIONS | null;

// --- Section accumulator factory ---

function createSectionAccumulator(fieldName: string, matcher: HeaderMatcher): ElementAccumulator {
	let hasCaptured = false;
	return {
		onEnterElement(element, context, _acc): void {
			// Reset capture flag when entering a fresh matching header
			if (element.type === 'header') {
				const normalized = kebabCase(element.name ?? '');
				if (matcher(normalized, context)) {
					hasCaptured = false;
				}
			}
		},
		onLeaveElement(element, context, acc): void {
			// When a matching header is finalized, override the field with raw content
			if (element.type === 'header' && element.rawContent) {
				const normalized = kebabCase(element.name ?? '');
				// Use the full matcher (which checks parent sections) to avoid
				// matching nested headers with the same name under different parents
				if (matcher(normalized, context)) {
					acc[fieldName] = element.rawContent;
					// Mark field as finalized so mergeVariables replaces instead of concatenates
					let finalized = acc[FINALIZED_FIELDS_KEY] as Set<string> | undefined;
					if (!finalized) {
						finalized = new Set<string>();
						acc[FINALIZED_FIELDS_KEY] = finalized;
					}
					finalized.add(fieldName);
				}
			}
		},
		onText(text, context, acc): boolean {
			for (let i = context.length - 1; i >= 0; i--) {
				const node = context[i];
				if (node.type === 'header') {
					const normalized = kebabCase(node.name ?? '');
					if (matcher(normalized, context)) {
						// The SAX parser emits the header name as the first text event
						// after pushing the header element. Skip it to prevent contamination.
						if (!hasCaptured) {
							hasCaptured = true;
							// If this text is exactly the header name, skip it entirely
							const headerName = node.name ?? '';
							if (text === headerName) return true;
							// Otherwise it's real content — fall through to accumulate
						}
						acc[fieldName] = ((acc[fieldName] as string | undefined) ?? '') + text;
						return true;
					}
				}
			}
			return false;
		},
	};
}

// --- Build section accumulators from field descriptors ---

const sectionAccumulators: ElementAccumulator[] = FIELD_DESCRIPTORS.map((desc) => {
	const kebabName = kebabCase(desc.headerName);
	const kebabParents = desc.parentSections.map((s) => kebabCase(s));

	const fieldName: string = desc.fieldName;
	const headerMatcher: HeaderMatcher = (name, ctx) => name === kebabName && kebabParents.every((p) => hasHeaderName(ctx, p));
	// All NarrativeVariables fields are now section (text) accumulators — no list fields at this level
	return createSectionAccumulator(fieldName, headerMatcher);
});

// --- Game Data accumulator ---

interface GameDataTracker {
	gameDataLevel: number;
	subsection: Subsection;
	/** Header name of the current subsection; used to skip the first text event (the heading itself). */
	subsectionName: string;
	decisionContext: string;
	decisions: string[];
	activePlotThreads: string[];
	inList: boolean;
	listItemText: string;
}

function createGameDataTracker(level: number): GameDataTracker {
	return {
		gameDataLevel: level,
		subsection: null,
		subsectionName: '',
		decisionContext: '',
		decisions: [],
		activePlotThreads: [],
		inList: false,
		listItemText: '',
	};
}

function finalizeGameDataTracker(tracker: GameDataTracker): GameDataFields {
	return {
		activePlotThreads: [...tracker.activePlotThreads],
		decisionContext: tracker.decisionContext.trim() || null,
		decisions: [...tracker.decisions],
	};
}

function createGameDataAccumulator(): ElementAccumulator {
	// Stack of trackers for nested Game Data sections
	const trackers: GameDataTracker[] = [];

	function currentTracker(): GameDataTracker | undefined {
		return trackers[trackers.length - 1];
	}

	return {
		onEnterElement(element, _context, _acc): void {
			if (element.type === 'header') {
				const normalized = kebabCase(element.name ?? '');
				const level = element.headerLevel ?? 1;

				// Entering Game Data section
				if (normalized === NAMES_GAME_DATA) {
					trackers.push(createGameDataTracker(level));
					return;
				}

				const tracker = currentTracker();
				if (!tracker) return;

				// Subsections at gameDataLevel + 1
				if (level === tracker.gameDataLevel + 1) {
					if (normalized === SUB_ACTIVE_PLOT_THREADS) {
						tracker.subsection = SUB_ACTIVE_PLOT_THREADS;
						tracker.subsectionName = element.name ?? '';
					} else if (normalized === SUB_DECISION_CONTEXT) {
						tracker.subsection = SUB_DECISION_CONTEXT;
						tracker.subsectionName = element.name ?? '';
					} else if (normalized === SUB_DECISIONS) {
						tracker.subsection = SUB_DECISIONS;
						tracker.subsectionName = element.name ?? '';
					} else {
						tracker.subsection = null;
						tracker.subsectionName = '';
					}
					return;
				}
				return;
			}

			// List element within game data
			if (element.type === 'list') {
				const tracker = currentTracker();
				if (tracker) {
					tracker.inList = true;
					tracker.listItemText = '';
				}
			}
		},

		onLeaveElement(element, _context, acc): void {
			if (element.type === 'list') {
				const tracker = currentTracker();
				if (!tracker || !tracker.inList) return;

				const text = tracker.listItemText.trimEnd();
				if (text) {
					if (tracker.subsection === SUB_DECISIONS) tracker.decisions.push(text);
					else if (tracker.subsection === SUB_ACTIVE_PLOT_THREADS) tracker.activePlotThreads.push(text);
				}
				tracker.inList = false;
				tracker.listItemText = '';
				return;
			}

			if (element.type !== 'header') return;

			const normalized = kebabCase(element.name ?? '');

			// Leaving Game Data section
			if (normalized === NAMES_GAME_DATA) {
				const tracker = trackers.pop();
				if (tracker) {
					const gd = finalizeGameDataTracker(tracker);
					const existing = acc.gameData as GameDataFields | undefined;
					acc.gameData = mergeGameDataFields(existing ?? null, gd) ?? gd;
				}
			}
		},

		onText(text, context, _acc): boolean {
			if (!hasHeaderName(context, NAMES_GAME_DATA)) return false;

			const tracker = currentTracker();
			if (!tracker) return false;

			// List item text
			if (tracker.inList) {
				tracker.listItemText += text;
				return true;
			}

			// Skip the subsection header name (e.g. "Decision Context") on first text event
			if (tracker.subsectionName && text === tracker.subsectionName) {
				tracker.subsectionName = '';
				return true;
			}

			// Decision context text
			if (tracker.subsection === SUB_DECISION_CONTEXT) {
				tracker.decisionContext += text;
				return true;
			}

			// Inside game data but not in a recognized subsection — consume to prevent passthrough
			return true;
		},
	};
}

// --- Main parser ---

/**
 * Streaming parser that wraps MarkdownSaxParser with composite accumulators
 * for section detection and game data extraction.
 *
 * No suppression logic — the parser simply routes text to accumulators.
 * Unhandled text becomes passthrough (pendingText).
 */
export function createSaxSectionParser(): StreamParser<Record<string, unknown>> {
	let pendingText = '';
	let currentAcc: Record<string, unknown>;

	const accumulators: ElementAccumulator[] = [...sectionAccumulators, createGameDataAccumulator()];

	const saxParser = createMarkdownSaxParser({
		onEnterElement(element, context): void {
			for (const acc of accumulators) acc.onEnterElement?.(element, context, currentAcc);
		},

		onLeaveElement(element, context): void {
			for (const acc of accumulators) acc.onLeaveElement?.(element, context, currentAcc);
		},

		onText(text, context): void {
			let handled = false;
			for (const acc of accumulators) {
				if (acc.onText?.(text, context, currentAcc)) handled = true;
			}
			if (!handled) pendingText += text;
		},
	});

	function feed(chunk: string, accumulator: Record<string, unknown>): string {
		currentAcc = accumulator;
		pendingText = '';
		saxParser.feed(chunk);
		return pendingText;
	}

	function flush(accumulator: Record<string, unknown>): string {
		currentAcc = accumulator;
		pendingText = '';
		saxParser.flush();
		return pendingText;
	}

	return { feed, flush };
}
