import { createMarkdownSaxParser, type ElementInfo, type ContextNode } from '$lib/markdown/markdown-sax-parser';
import type { StreamParser } from './stream-parser';
import type { GameDataFields } from './parser-chain';
import { mergeGameDataFields } from './message-updater';
import { kebabCase } from 'lodash';

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

// Precomputed kebab-case values for header names
const KC_STORY_INFORMATION = kebabCase('Story Information');
const KC_SCENE = kebabCase('Scene');
const KC_STATUS_UPDATE = kebabCase('Status Update');

// Header name constants (kebab-case normalized)
const NAMES_STORY_TITLE = kebabCase('Story Title');
const NAMES_ACT_NUMBER = kebabCase('Act Number');
const NAMES_SESSION_NUMBER = kebabCase('Session number');
const NAMES_SCENE_NUMBER = kebabCase('Scene number');
const NAMES_SCENE_TITLE = kebabCase('Scene title');
const NAMES_CURRENT_CONTEXT = kebabCase('Current Context');
const NAMES_ACTIVE_PLOT_THREADS = kebabCase('Active Plot Threads');
const NAMES_BACKGROUND = kebabCase('Background');
const NAMES_NARRATIVE_BODY = kebabCase('Narrative Body');
const NAMES_CG = kebabCase('CG');
const NAMES_DECISION_CONTEXT = kebabCase('Decision context');

// Special section name constants (kebab-case)
const NAMES_REVIEW_SCRATCHPAD = kebabCase('Review Scratchpad');
const NAMES_REVISED_NARRATIVE = kebabCase('Revised Narrative');
const NAMES_GAME_DATA = kebabCase('Game Data');

// Game data subsection name constants (kebab-case)
const SUB_WORLD_STATE = kebabCase('World State');
const SUB_DECISIONS = kebabCase('Decisions');
const SUB_PLAYER_ALIASES = kebabCase('Player Aliases');
const SUB_OTHER_CHAR_ALIASES = kebabCase('Other Character Aliases');

type Subsection = typeof SUB_WORLD_STATE | typeof SUB_DECISIONS | typeof SUB_PLAYER_ALIASES | typeof SUB_OTHER_CHAR_ALIASES | null;

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

// --- Build section accumulators ---

const sectionAccumulators: ElementAccumulator[] = [
	// Direct-mapped sections (any level, no parent required)
	createSectionAccumulator('background', (name) => name === NAMES_BACKGROUND),
	createSectionAccumulator('narrativeBody', (name) => name === NAMES_NARRATIVE_BODY),
	createSectionAccumulator('cg', (name) => name === NAMES_CG),
	createSectionAccumulator('decisionContext', (name) => name === NAMES_DECISION_CONTEXT),
	createSectionAccumulator('scratchpad', (name) => name === NAMES_REVIEW_SCRATCHPAD),

	// Under Story Information
	createSectionAccumulator('storyTitle', (name, ctx) => name === NAMES_STORY_TITLE && hasHeaderName(ctx, KC_STORY_INFORMATION)),
	createSectionAccumulator('actNumber', (name, ctx) => name === NAMES_ACT_NUMBER && hasHeaderName(ctx, KC_STORY_INFORMATION)),
	createSectionAccumulator('sessionNumber', (name, ctx) => name === NAMES_SESSION_NUMBER && hasHeaderName(ctx, KC_STORY_INFORMATION)),

	// Under Scene → under Story Information
	createSectionAccumulator(
		'sceneNumber',
		(name, ctx) => name === NAMES_SCENE_NUMBER && hasHeaderName(ctx, KC_SCENE) && hasHeaderName(ctx, KC_STORY_INFORMATION)
	),
	createSectionAccumulator(
		'sceneTitle',
		(name, ctx) => name === NAMES_SCENE_TITLE && hasHeaderName(ctx, KC_SCENE) && hasHeaderName(ctx, KC_STORY_INFORMATION)
	),

	// Under Status Update
	createSectionAccumulator('currentContext', (name, ctx) => name === NAMES_CURRENT_CONTEXT && hasHeaderName(ctx, KC_STATUS_UPDATE)),
	createSectionAccumulator('activePlotThreads', (name, ctx) => name === NAMES_ACTIVE_PLOT_THREADS && hasHeaderName(ctx, KC_STATUS_UPDATE)),
];

// --- Revised Narrative accumulator ---

function createRevisedNarrativeAccumulator(): ElementAccumulator {
	return {
		onText(text, context, _acc): boolean {
			// When inside Revised Narrative (and not inside Game Data),
			// consume the text so it doesn't passthrough as pendingText.
			// Section accumulators will still capture individual fields.
			if (hasHeaderName(context, NAMES_REVISED_NARRATIVE)) {
				// Check if we're also inside Game Data — if so, let game data handle it
				if (hasHeaderName(context, NAMES_GAME_DATA)) {
					return false;
				}
				return true; // consume text, don't passthrough
			}
			return false;
		},
	};
}

// --- Game Data accumulator ---

interface GameDataTracker {
	gameDataLevel: number;
	subsection: Subsection;
	aliasCharacter: string | null;
	worldState: string;
	decisions: string[];
	playerAliases: string[];
	otherCharacterAliases: Record<string, string[]>;
	inList: boolean;
	listItemText: string;
}

function createGameDataTracker(level: number): GameDataTracker {
	return {
		gameDataLevel: level,
		subsection: null,
		aliasCharacter: null,
		worldState: '',
		decisions: [],
		playerAliases: [],
		otherCharacterAliases: {},
		inList: false,
		listItemText: '',
	};
}

function finalizeGameDataTracker(tracker: GameDataTracker): GameDataFields {
	return {
		worldState: tracker.worldState.trim() || null,
		decisions: [...tracker.decisions],
		playerAliases: [...tracker.playerAliases],
		otherCharacterAliases: { ...tracker.otherCharacterAliases },
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
					if (normalized === SUB_WORLD_STATE) tracker.subsection = SUB_WORLD_STATE;
					else if (normalized === SUB_DECISIONS) tracker.subsection = SUB_DECISIONS;
					else if (normalized === SUB_PLAYER_ALIASES) tracker.subsection = SUB_PLAYER_ALIASES;
					else if (normalized === SUB_OTHER_CHAR_ALIASES) tracker.subsection = SUB_OTHER_CHAR_ALIASES;
					else tracker.subsection = null;
					tracker.aliasCharacter = null;
					return;
				}

				// Character name headers at gameDataLevel + 2 (under Other Character Aliases)
				if (level === tracker.gameDataLevel + 2 && tracker.subsection === SUB_OTHER_CHAR_ALIASES) {
					const charName = element.name ?? '';
					tracker.aliasCharacter = charName;
					if (!tracker.otherCharacterAliases[charName]) {
						tracker.otherCharacterAliases[charName] = [];
					}
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
					else if (tracker.subsection === SUB_PLAYER_ALIASES) tracker.playerAliases.push(text);
					else if (tracker.subsection === SUB_OTHER_CHAR_ALIASES && tracker.aliasCharacter) {
						const charAliases = tracker.otherCharacterAliases[tracker.aliasCharacter];
						if (charAliases) charAliases.push(text);
					}
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

			// World state text
			if (tracker.subsection === SUB_WORLD_STATE) {
				tracker.worldState += text;
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
 * for section detection, game data extraction, and review content capture.
 *
 * No suppression logic — the parser simply routes text to accumulators.
 * Unhandled text becomes passthrough (pendingText).
 */
export function createSaxSectionParser(): StreamParser<Record<string, unknown>> {
	let pendingText = '';
	let currentAcc: Record<string, unknown>;

	const accumulators: ElementAccumulator[] = [...sectionAccumulators, createGameDataAccumulator(), createRevisedNarrativeAccumulator()];

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
