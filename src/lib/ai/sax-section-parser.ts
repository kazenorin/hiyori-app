import { createMarkdownSaxParser, type ElementInfo, type ContextNode } from '$lib/markdown/markdown-sax-parser';
import type { StreamParser } from './stream-parser';
import type { GameData } from '$lib/db/messages';
import { type NarrativeSections, SECTION_ACC_PREFIX } from './parser-chain';
import { kebabCase } from 'lodash';

// Header names for section detection
const SCRATCHPAD = 'Scratchpad';
const REVIEW_SCRATCHPAD = 'Review Scratchpad';
const REVISED_NARRATIVE = 'Revised Narrative';
const GAME_DATA = 'Game Data';
const STORY_INFORMATION = 'Story Information';
const BACKGROUND = 'Background';
const NARRATIVE_BODY = 'Narrative Body';
const CG = 'CG';
const STATUS_UPDATE = 'Status Update';
const DECISION_CONTEXT = 'Decision Context';
const SCENE = 'Scene';

// Precomputed kebab-case values for header names (avoid recomputing per chunk)
const KC_BACKGROUND = kebabCase(BACKGROUND);
const KC_NARRATIVE_BODY = kebabCase(NARRATIVE_BODY);
const KC_CG = kebabCase(CG);
const KC_DECISION_CONTEXT = kebabCase(DECISION_CONTEXT);
const KC_STORY_INFORMATION = kebabCase(STORY_INFORMATION);
const KC_SCENE = kebabCase(SCENE);
const KC_STATUS_UPDATE = kebabCase(STATUS_UPDATE);
const KC_STORY_TITLE = kebabCase('Story Title');
const KC_ACT_NUMBER = kebabCase('Act Number');
const KC_SESSION_NUMBER = kebabCase('Session number');
const KC_SCENE_NUMBER = kebabCase('Scene number');
const KC_SCENE_TITLE = kebabCase('Scene title');
const KC_CURRENT_CONTEXT = kebabCase('Current Context');
const KC_ACTIVE_PLOT_THREADS = kebabCase('Active Plot Threads');

// Game data subsection names (kebab-case normalized header names)
const SUB_WORLD_STATE = 'world-state';
const SUB_DECISIONS = 'decisions';
const SUB_PLAYER_ALIASES = 'player-aliases';
const SUB_OTHER_CHAR_ALIASES = 'other-character-aliases';

type Subsection = typeof SUB_WORLD_STATE | typeof SUB_DECISIONS | typeof SUB_PLAYER_ALIASES | typeof SUB_OTHER_CHAR_ALIASES | null;

interface GameDataTracker {
	subsection: Subsection;
	aliasCharacter: string | null;
	worldState: string;
	decisions: string[];
	playerAliases: string[];
	aliases: Map<string, string[]>;
	inList: boolean;
	listItemText: string;
	skipHeaderName: boolean;
	fallbackBuffer: string;
}

type SectionField = keyof NarrativeSections;

function createGameDataTracker(): GameDataTracker {
	return {
		subsection: null,
		aliasCharacter: null,
		worldState: '',
		decisions: [],
		playerAliases: [],
		aliases: new Map(),
		inList: false,
		listItemText: '',
		skipHeaderName: false,
		fallbackBuffer: '',
	};
}

function finalizeGameData(tracker: GameDataTracker): GameData | null {
	const worldState = tracker.worldState.trim();
	if (!worldState || tracker.decisions.length === 0) return null;

	const result: GameData = { worldState, decisions: tracker.decisions };

	if (tracker.playerAliases.length > 0) {
		result.playerAliases = tracker.playerAliases;
	}

	if (tracker.aliases.size > 0) {
		result.aliases = Array.from(tracker.aliases.entries()).map(([name, aliases]) => [name, ...aliases]);
	}

	return result;
}

/**
 * Find a header in the context stack by level and/or name.
 */
function findHeaderInContext(context: readonly ContextNode[], name?: string, level?: number): ContextNode | undefined {
	for (let i = context.length - 1; i >= 0; i--) {
		const node = context[i];
		if (node.type !== 'header') continue;
		if (level !== undefined && node.headerLevel !== level) continue;
		if (name !== undefined && node.name !== name) continue;
		return node;
	}
	return undefined;
}

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

/**
 * Determine which section field a header maps to, based on header name and context hierarchy.
 */
function resolveSectionField(name: string, level: number, context: readonly ContextNode[]): SectionField | null {
	const normalized = kebabCase(name);

	// H2 direct-mapped sections
	if (level === 2) {
		if (normalized === KC_BACKGROUND) return 'background';
		if (normalized === KC_NARRATIVE_BODY) return 'narrativeBody';
		if (normalized === KC_CG) return 'cg';
		if (normalized === KC_DECISION_CONTEXT) return 'decisionContext';
		return null;
	}

	// H3 under Story Information
	if (level === 3 && hasHeaderName(context, KC_STORY_INFORMATION)) {
		if (normalized === KC_STORY_TITLE) return 'storyTitle';
		if (normalized === KC_ACT_NUMBER) return 'actNumber';
		if (normalized === KC_SESSION_NUMBER) return 'sessionNumber';
		return null;
	}

	// H4 under Scene (under Story Information)
	if (level === 4 && hasHeaderName(context, KC_SCENE) && hasHeaderName(context, KC_STORY_INFORMATION)) {
		if (normalized === KC_SCENE_NUMBER) return 'sceneNumber';
		if (normalized === KC_SCENE_TITLE) return 'sceneTitle';
		return null;
	}

	// H3 under Status Update
	if (level === 3 && hasHeaderName(context, KC_STATUS_UPDATE)) {
		if (normalized === KC_CURRENT_CONTEXT) return 'currentContext';
		if (normalized === KC_ACTIVE_PLOT_THREADS) return 'activePlotThreads';
		return null;
	}

	return null;
}

/**
 * Streaming parser that wraps MarkdownSaxParser for section detection
 * and text routing. Uses the SAX context stack to determine which section
 * text belongs to, eliminating manual mode tracking.
 *
 * Section routing:
 * - ## Scratchpad → suppress text
 * - # Review Scratchpad → body streams to acc.review_scratchpad
 * - # Revised Narrative → body captured to local buffer; embedded ## Game Data parsed on flush
 * - ## Game Data (top-level or inside Revised Narrative) → parsed from SAX events
 * - Narrative sections (Background, Narrative Body, CG, etc.) → captured as individual fields
 * - All other content → passthrough as text delta
 */
export function createSaxSectionParser(): StreamParser<Record<string, unknown>> {
	// Per-call state (reset each feed/flush)
	let pendingText = '';
	let currentAcc: Record<string, unknown>;

	// Suppress state (Scratchpad sections)
	let suppressing = false;
	let _suppressDepth = 0;

	// Skip header name text within special sections
	let skipNextText = false;

	// Revised narrative capture
	let revisedBodyBuffer = '';
	let revisedSentLength = 0;

	// Game data tracking (top-level)
	let topLevelGameData: GameDataTracker | null = null;

	// Game data tracking (inside revised narrative)
	let revisedGameData: GameDataTracker | null = null;

	// Active game data tracker reference (points to whichever is active)
	let activeGameData: GameDataTracker | null = null;

	// Pending game data results (set on section close, consumed on flush)
	let pendingGameData: GameData | null = null;
	let pendingRevisedGameData: GameData | null = null;

	// Current narrative section field being captured
	let currentSectionField: SectionField | null = null;

	// Accumulator key constants
	const ACC_REVIEW = 'review_scratchpad';
	const ACC_NARRATIVE = 'revised_narrative';
	const ACC_GAME_DATA = 'gameData';
	const ACC_REVISED_GAME_DATA = 'revisedGameData';

	const saxParser = createMarkdownSaxParser({
		onEnterElement(element: ElementInfo, context: readonly ContextNode[]): void {
			if (element.type === 'page' || element.type === 'root') return;

			if (element.type === 'header') {
				const name = element.name ?? '';
				const level = element.headerLevel ?? 1;

				// Check for special sections
				if (name === SCRATCHPAD && level === 2) {
					suppressing = true;
					_suppressDepth = element.depth;
					skipNextText = true;
					return;
				}

				if (name === REVIEW_SCRATCHPAD && level === 1) {
					skipNextText = true;
					return;
				}

				if (name === REVISED_NARRATIVE && level === 1) {
					revisedBodyBuffer = '';
					skipNextText = true;
					return;
				}

				if (name === GAME_DATA && level === 2) {
					const tracker = createGameDataTracker();
					activeGameData = tracker;

					const inRevised = !!findHeaderInContext(context, REVISED_NARRATIVE, 1);
					if (inRevised) {
						revisedGameData = tracker;
					} else {
						topLevelGameData = tracker;
					}

					skipNextText = true;
					return;
				}

				// Game data sub-headers
				if (activeGameData) {
					const tracker = activeGameData;

					if (level === 3) {
						const normalized = kebabCase(name);
						if (normalized === SUB_WORLD_STATE) tracker.subsection = SUB_WORLD_STATE;
						else if (normalized === SUB_DECISIONS) tracker.subsection = SUB_DECISIONS;
						else if (normalized === SUB_PLAYER_ALIASES) tracker.subsection = SUB_PLAYER_ALIASES;
						else if (normalized === SUB_OTHER_CHAR_ALIASES) tracker.subsection = SUB_OTHER_CHAR_ALIASES;
						else tracker.subsection = null;
						tracker.aliasCharacter = null;
					} else if (level === 4 && tracker.subsection === SUB_OTHER_CHAR_ALIASES) {
						tracker.aliasCharacter = name;
						if (!tracker.aliases.has(name)) {
							tracker.aliases.set(name, []);
						}
					}

					tracker.skipHeaderName = true;
					return;
				}

				// Inside Revised Narrative or Review Scratchpad — don't capture narrative sections,
				// and include header names as content (not suppressed)
				const inRevisedNarrative = !!findHeaderInContext(context, REVISED_NARRATIVE, 1);
				const inReviewScratchpad = !!findHeaderInContext(context, REVIEW_SCRATCHPAD, 1);
				if (inRevisedNarrative || inReviewScratchpad) {
					return;
				}

				// Narrative section headers (only outside special sections)
				const field = resolveSectionField(name, level, context);
				if (field) {
					currentSectionField = field;
					skipNextText = true;
					return;
				}

				// Grouping headers (Story Information, Scene, Status Update) — skip name text
				if (currentSectionField !== null || activeGameData !== null) {
					skipNextText = true;
				}
				return;
			}

			// List element within game data
			if (element.type === 'list' && activeGameData) {
				activeGameData.inList = true;
				activeGameData.listItemText = '';
			}
		},

		onLeaveElement(element: ElementInfo, _context: readonly ContextNode[]): void {
			if (element.type === 'page' || element.type === 'root') return;

			if (element.type === 'list' && activeGameData) {
				const tracker = activeGameData;
				const text = tracker.listItemText.trimEnd();
				if (text) {
					if (tracker.subsection === SUB_DECISIONS) tracker.decisions.push(text);
					else if (tracker.subsection === SUB_PLAYER_ALIASES) tracker.playerAliases.push(text);
					else if (tracker.subsection === SUB_OTHER_CHAR_ALIASES && tracker.aliasCharacter) {
						const charAliases = tracker.aliases.get(tracker.aliasCharacter);
						if (charAliases) charAliases.push(text);
					}
				}
				tracker.inList = false;
				tracker.listItemText = '';
				return;
			}

			if (element.type !== 'header') return;

			const name = element.name ?? '';
			const level = element.headerLevel ?? 1;

			// Leaving Scratchpad
			if (name === SCRATCHPAD && level === 2) {
				suppressing = false;
				return;
			}

			// Leaving Game Data section
			if (name === GAME_DATA && level === 2 && activeGameData) {
				const tracker = activeGameData;
				const gameData = finalizeGameData(tracker);
				if (gameData) {
					if (tracker === revisedGameData) {
						pendingRevisedGameData = gameData;
					} else {
						pendingGameData = gameData;
					}
				} else {
					// Invalid game data — emit buffered text as passthrough
					if (tracker === revisedGameData) {
						revisedBodyBuffer += tracker.fallbackBuffer;
						currentAcc[ACC_NARRATIVE] = (currentAcc[ACC_NARRATIVE] ?? '') + tracker.fallbackBuffer;
						revisedSentLength = revisedBodyBuffer.length;
					} else {
						pendingText += tracker.fallbackBuffer;
					}
				}

				if (tracker === revisedGameData) {
					revisedGameData = null;
				} else {
					topLevelGameData = null;
				}
				activeGameData = null;
				return;
			}

			// Leaving a narrative section header — clear field tracking
			if (currentSectionField !== null) {
				const field = resolveSectionField(name, level, _context);
				if (field === currentSectionField) {
					currentSectionField = null;
				}
				return;
			}
		},

		onText(text: string, context: readonly ContextNode[]): void {
			// Skip header names within special sections
			if (skipNextText) {
				skipNextText = false;
				// Still add to fallback buffer for game data
				if (activeGameData) {
					activeGameData.fallbackBuffer += text;
				}
				return;
			}

			// Game data text
			if (activeGameData) {
				const tracker = activeGameData;
				tracker.fallbackBuffer += text;

				if (tracker.skipHeaderName) {
					tracker.skipHeaderName = false;
					return;
				}

				if (tracker.inList) {
					tracker.listItemText += text;
					return;
				}

				if (tracker.subsection === SUB_WORLD_STATE) {
					tracker.worldState += text;
					return;
				}

				return;
			}

			// Suppress Scratchpad text
			if (suppressing) return;

			// Review Scratchpad — check context
			if (findHeaderInContext(context, REVIEW_SCRATCHPAD, 1)) {
				currentAcc[ACC_REVIEW] = (currentAcc[ACC_REVIEW] ?? '') + text;
				return;
			}

			// Revised Narrative — check context (but not if game data is active)
			if (findHeaderInContext(context, REVISED_NARRATIVE, 1)) {
				revisedBodyBuffer += text;
				currentAcc[ACC_NARRATIVE] = (currentAcc[ACC_NARRATIVE] ?? '') + text;
				revisedSentLength = revisedBodyBuffer.length;
				return;
			}

			// Narrative section field
			if (currentSectionField) {
				currentAcc[SECTION_ACC_PREFIX + currentSectionField] = (currentAcc[SECTION_ACC_PREFIX + currentSectionField] ?? '') + text;
				return;
			}

			// Default: passthrough
			pendingText += text;
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

		// Finalize any open game data trackers (section never closed)
		if (topLevelGameData) {
			const gameData = finalizeGameData(topLevelGameData);
			if (gameData) {
				pendingGameData = gameData;
			} else {
				pendingText += topLevelGameData.fallbackBuffer;
			}
			topLevelGameData = null;
			activeGameData = null;
		}

		if (revisedGameData) {
			const gameData = finalizeGameData(revisedGameData);
			if (gameData) {
				pendingRevisedGameData = gameData;
			} else {
				revisedBodyBuffer += revisedGameData.fallbackBuffer;
			}
			revisedGameData = null;
			activeGameData = null;
		}

		// Write game data results to accumulator
		if (pendingGameData) {
			accumulator[ACC_GAME_DATA] = pendingGameData;
			pendingGameData = null;
		}

		if (pendingRevisedGameData) {
			accumulator[ACC_REVISED_GAME_DATA] = pendingRevisedGameData;
			pendingRevisedGameData = null;
		}

		// Write remaining revised narrative not yet sent via feed
		const unsent = revisedBodyBuffer.slice(revisedSentLength);
		if (unsent) {
			accumulator[ACC_NARRATIVE] = (accumulator[ACC_NARRATIVE] ?? '') + unsent;
		}
		revisedBodyBuffer = '';
		revisedSentLength = 0;

		// Reset state
		suppressing = false;
		currentSectionField = null;

		return pendingText;
	}

	return { feed, flush };
}
