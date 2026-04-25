import { createMarkdownSaxParser, type ElementInfo, type ContextNode } from '$lib/markdown/markdown-sax-parser';
import type { StreamParser } from './stream-parser';
import type { GameData } from '$lib/db/messages';
import { kebabCase } from 'lodash';

// Header names for section detection
const SCRATCHPAD = 'Scratchpad';
const REVIEW_SCRATCHPAD = 'Review Scratchpad';
const REVISED_NARRATIVE = 'Revised Narrative';
const GAME_DATA = 'Game Data';

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

type SectionMode = 'normal' | 'suppress' | 'captureReview' | 'captureRevised' | 'gameData';

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
 * Streaming parser that wraps MarkdownSaxParser for section detection
 * and text routing. Replaces HeadingSectionParser, RevisedNarrativeParser,
 * and MarkdownGameDataParser with a single SAX-based implementation.
 *
 * Section routing:
 * - ## Scratchpad → suppress text
 * - # Review Scratchpad → body streams to acc.review_scratchpad
 * - # Revised Narrative → body captured to local buffer; embedded ## Game Data parsed on flush
 * - ## Game Data (top-level or inside Revised Narrative) → parsed from SAX events
 * - All other content → passthrough as text delta
 */
export function createSaxSectionParser(): StreamParser<Record<string, unknown>> {
	// Per-call state (reset each feed/flush)
	let pendingText = '';
	let currentAcc: Record<string, unknown>;

	// Cross-call state (persists across feed calls)
	let sectionMode: SectionMode = 'normal';
	let _suppressDepth = 0;
	let skipNextText = false;

	// Revised narrative capture
	let revisedBodyBuffer = '';

	// Game data tracking (top-level)
	let topLevelGameData: GameDataTracker | null = null;

	// Game data tracking (inside revised narrative)
	let revisedGameData: GameDataTracker | null = null;

	// Active game data tracker reference (points to whichever is active)
	let activeGameData: GameDataTracker | null = null;

	// Pending game data results (set on section close, consumed on flush)
	let pendingGameData: GameData | null = null;
	let pendingRevisedGameData: GameData | null = null;

	// Accumulator key constants
	const ACC_REVIEW = 'review_scratchpad';
	const ACC_NARRATIVE = 'revised_narrative';
	const ACC_GAME_DATA = 'gameData';
	const ACC_REVISED_GAME_DATA = 'revisedGameData';

	const saxParser = createMarkdownSaxParser({
		onEnterElement(element: ElementInfo, _context: readonly ContextNode[]): void {
			if (element.type === 'page' || element.type === 'root') return;

			if (element.type === 'header') {
				const name = element.name ?? '';
				const level = element.headerLevel ?? 1;

				// Check for special sections
				if (name === SCRATCHPAD && level === 2) {
					sectionMode = 'suppress';
					_suppressDepth = element.depth;
					skipNextText = true;
					return;
				}

				if (name === REVIEW_SCRATCHPAD && level === 1) {
					sectionMode = 'captureReview';
					skipNextText = true;
					return;
				}

				if (name === REVISED_NARRATIVE && level === 1) {
					sectionMode = 'captureRevised';
					revisedBodyBuffer = '';
					skipNextText = true;
					return;
				}

				if (name === GAME_DATA && level === 2) {
					const tracker = createGameDataTracker();
					activeGameData = tracker;

					if (sectionMode === 'captureRevised') {
						revisedGameData = tracker;
						sectionMode = 'gameData';
					} else {
						topLevelGameData = tracker;
						sectionMode = 'gameData';
					}

					skipNextText = true;
					return;
				}

				// Sub-headers within game data section
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
				sectionMode = 'normal';
				return;
			}

			// Leaving Review Scratchpad
			if (name === REVIEW_SCRATCHPAD && level === 1) {
				sectionMode = 'normal';
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
					} else {
						pendingText += tracker.fallbackBuffer;
					}
				}

				if (tracker === revisedGameData) {
					revisedGameData = null;
					sectionMode = 'captureRevised';
				} else {
					topLevelGameData = null;
					sectionMode = 'normal';
				}
				activeGameData = null;
				return;
			}

			// Leaving Revised Narrative
			if (name === REVISED_NARRATIVE && level === 1) {
				sectionMode = 'normal';
				return;
			}
		},

		onText(text: string, _context: readonly ContextNode[]): void {
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

			// Section routing
			switch (sectionMode) {
				case 'suppress':
					return;

				case 'captureReview':
					currentAcc[ACC_REVIEW] = (currentAcc[ACC_REVIEW] ?? '') + text;
					return;

				case 'captureRevised':
					revisedBodyBuffer += text;
					return;

				case 'gameData':
					// Handled by activeGameData above
					return;

				case 'normal':
				default:
					pendingText += text;
					return;
			}
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

		// Write revised narrative
		if (revisedBodyBuffer) {
			accumulator[ACC_NARRATIVE] = revisedBodyBuffer;
			revisedBodyBuffer = '';
		}

		// Reset section state
		sectionMode = 'normal';

		return pendingText;
	}

	return { feed, flush };
}
