import { marked, type Tokens } from 'marked';
import { kebabCase } from 'lodash';

// === Existing interface and function (used by memory-extraction-pipeline) ===

export interface CharacterAliasEntry {
	characterName: string;
	aliases: string[];
}

/**
 * Parse character aliases from act summary markdown.
 * Expects `### [Character Name]` headers followed by `- Aliases: [alias1, alias2]` lines.
 */
export function parseCharacterAliases(actSummaryMarkdown: string): CharacterAliasEntry[] {
	const entries: CharacterAliasEntry[] = [];
	let currentName: string | null = null;
	let currentAliases: string[] = [];

	const lines = actSummaryMarkdown.split('\n');

	for (const line of lines) {
		// Match ### Character Name headers (h3 level)
		const headerMatch = line.match(/^###\s+(.+)$/);
		if (headerMatch) {
			// Flush previous entry
			if (currentName !== null) {
				entries.push({ characterName: currentName, aliases: currentAliases });
			}
			currentName = headerMatch[1].trim();
			currentAliases = [];
			continue;
		}

		// Match "- Aliases: [alias1, alias2]" or "- Aliases: alias1, alias2"
		if (currentName !== null) {
			const aliasMatch = line.match(/^-?\s*Aliases:\s*\[?(.+?)\]?$/i);
			if (aliasMatch) {
				const aliasesStr = aliasMatch[1].trim();
				currentAliases = aliasesStr
					.split(',')
					.map((a) => a.trim())
					.filter((a) => a.length > 0);
			}
		}
	}

	// Flush last entry
	if (currentName !== null) {
		entries.push({ characterName: currentName, aliases: currentAliases });
	}

	return entries;
}

// === New structured types ===

export interface SceneSummary {
	sceneNumber: number;
	title: string;
	location: string;
	summary: string;
}

export interface CharacterSceneEntry {
	sceneNumber: number;
	summary: string;
}

export interface CharacterSummary {
	characterName: string;
	aliases: string[];
	sceneEntries: CharacterSceneEntry[];
}

export interface ActSummary {
	completedScenes: number;
	scenes: SceneSummary[];
	characters: CharacterSummary[];
}

export interface IncrementalUpdate {
	completedScenes?: number;
	newScene?: SceneSummary;
	characterUpdates: CharacterSummary[];
}

// === Section tracking for marked.lexer() token walking ===

type Section = 'progress' | 'scenes' | 'characters';

const SECTION_HEADERS: Record<string, Section | undefined> = {
	progress: 'progress',
	'scene-summaries': 'scenes',
	'character-summaries': 'characters',
};

// === Parsing ===

const COMPLETED_SCENES_LABEL = 'Completed scenes';

/**
 * Strip code block fences wrapping the markdown.
 * LLMs sometimes wrap output in ``` or ```lang ... ``` blocks.
 */
function stripCodeFences(text: string): string {
	return text.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '');
}

/**
 * Parse a full act summary markdown string into structured data.
 * Uses marked.lexer() to tokenize, then walks tokens to extract
 * Progress, Scene Summaries, and Character Summaries sections.
 */
export function parseActSummary(markdown: string): ActSummary {
	const tokens = marked.lexer(stripCodeFences(markdown));
	const result: ActSummary = { completedScenes: 0, scenes: [], characters: [] };

	let currentSection: Section | null = null;
	let currentScene: SceneSummary | null = null;
	let currentCharacter: CharacterSummary | null = null;

	for (const token of tokens) {
		if (token.type === 'heading') {
			const heading = token as Tokens.Heading;

			if (heading.depth === 2) {
				// Flush any pending entity before switching sections
				flushScene();
				flushCharacter();

				currentSection = SECTION_HEADERS[kebabCase(heading.text)] ?? null;
				continue;
			}

			if (heading.depth === 3) {
				if (currentSection === 'scenes') {
					flushScene();
					currentScene = parseSceneHeader(heading.text);
				} else if (currentSection === 'characters') {
					flushCharacter();
					currentCharacter = { characterName: heading.text.trim(), aliases: [], sceneEntries: [] };
				}
				continue;
			}
		}

		if (token.type === 'list') {
			const list = token as Tokens.List;

			if (currentSection === 'progress') {
				for (const item of list.items) {
					const match = item.text.match(new RegExp(`${COMPLETED_SCENES_LABEL}:\\s*(\\d+)`, 'i'));
					if (match) {
						result.completedScenes = parseInt(match[1], 10);
					}
				}
				continue;
			}

			if (currentSection === 'scenes' && currentScene) {
				for (const item of list.items) {
					applySceneListItem(currentScene, item.text);
				}
				continue;
			}

			if (currentSection === 'characters' && currentCharacter) {
				for (const item of list.items) {
					applyCharacterListItem(currentCharacter, item.text);
				}
				continue;
			}
		}

		// Handle Location/Summary as paragraphs (not list items)
		// Paragraphs may contain multiple lines (e.g., "Location: ...\nSummary: ...")
		if (token.type === 'paragraph' && currentSection === 'scenes' && currentScene) {
			const text = (token as Tokens.Paragraph).text;
			for (const line of text.split('\n')) {
				applySceneListItem(currentScene, line.trim());
			}
			continue;
		}
	}

	// Flush final pending entities
	flushScene();
	flushCharacter();

	return result;

	function flushScene() {
		if (currentScene) {
			result.scenes = [...result.scenes, currentScene];
			currentScene = null;
		}
	}

	function flushCharacter() {
		if (currentCharacter) {
			result.characters = [...result.characters, currentCharacter];
			currentCharacter = null;
		}
	}
}

/**
 * Parse "Scene N: Title" from an H3 heading text.
 * Tolerates variations like "Scene 3 - Title" or just "Title".
 */
function parseSceneHeader(text: string): SceneSummary {
	const match = text.match(/^Scene\s+(\d+)\s*[:\-–]\s*(.+)$/i);
	if (match) {
		return { sceneNumber: parseInt(match[1], 10), title: match[2].trim(), location: '', summary: '' };
	}
	return { sceneNumber: 0, title: text.trim(), location: '', summary: '' };
}

/**
 * Apply a list item or paragraph text to a scene summary.
 * Handles "Location: ..." and "Summary: ..." patterns.
 */
function applySceneListItem(scene: SceneSummary, text: string): void {
	const locationMatch = text.match(/^Location:\s*(.+)$/i);
	if (locationMatch) {
		scene.location = locationMatch[1].trim();
		return;
	}
	const summaryMatch = text.match(/^Summary:\s*(.+)$/i);
	if (summaryMatch) {
		scene.summary = summaryMatch[1].trim();
		return;
	}
	// If no prefix, append to whichever field is empty
	if (!scene.summary) {
		scene.summary = text.trim();
	} else if (!scene.location) {
		scene.location = text.trim();
	}
}

/**
 * Apply a list item to a character summary.
 * Handles "Aliases: [...]" and "Scene N: ..." patterns.
 */
function applyCharacterListItem(character: CharacterSummary, text: string): void {
	const aliasMatch = text.match(/^Aliases?:\s*\[?(.+?)\]?$/i);
	if (aliasMatch) {
		character.aliases = aliasMatch[1]
			.split(',')
			.map((a) => a.trim())
			.filter((a) => a.length > 0);
		return;
	}
	const sceneMatch = text.match(/^Scene\s+(\d+)\s*[:\-–]\s*(.+)$/i);
	if (sceneMatch) {
		character.sceneEntries = [...character.sceneEntries, { sceneNumber: parseInt(sceneMatch[1], 10), summary: sceneMatch[2].trim() }];
	}
}

// === Serialization ===

/**
 * Serialize structured act summary data back to markdown.
 * Output matches the act-summary-template format.
 */
export function serializeActSummary(data: ActSummary): string {
	const lines: string[] = [];

	lines.push('# Act Summary');
	lines.push('');
	lines.push('## Progress');
	lines.push(`- ${COMPLETED_SCENES_LABEL}: ${data.completedScenes}`);
	lines.push('');
	lines.push('## Scene Summaries');

	for (const scene of data.scenes) {
		lines.push(`### Scene ${scene.sceneNumber}: ${scene.title}`);
		if (scene.location) {
			lines.push(`Location: ${scene.location}`);
		}
		if (scene.summary) {
			lines.push(`Summary: ${scene.summary}`);
		}
		lines.push('');
	}

	lines.push('## Character Summaries');

	for (const character of data.characters) {
		lines.push(`### ${character.characterName}`);
		if (character.aliases.length > 0) {
			lines.push(`- Aliases: [${character.aliases.join(', ')}]`);
		}
		for (const entry of character.sceneEntries) {
			lines.push(`- Scene ${entry.sceneNumber}: ${entry.summary}`);
		}
		lines.push('');
	}

	return lines.join('\n').trimEnd();
}

// === Incremental parsing ===

/**
 * Parse the LLM's incremental output (new scene entry + character updates).
 * Uses the same tokenization as parseActSummary but expects a subset.
 */
export function parseIncrementalOutput(markdown: string): IncrementalUpdate {
	const tokens = marked.lexer(stripCodeFences(markdown));
	const result: IncrementalUpdate = { characterUpdates: [] };

	let currentSection: Section | null = null;
	let currentCharacter: CharacterSummary | null = null;

	for (const token of tokens) {
		if (token.type === 'heading') {
			const heading = token as Tokens.Heading;

			if (heading.depth === 2) {
				// Flush pending character
				if (currentCharacter) {
					result.characterUpdates = [...result.characterUpdates, currentCharacter];
					currentCharacter = null;
				}
				currentSection = SECTION_HEADERS[kebabCase(heading.text)] ?? null;
				continue;
			}

			if (heading.depth === 3) {
				if (currentSection === 'scenes') {
					// Flush previous scene (only one expected in incremental output)
					if (currentCharacter) {
						result.characterUpdates = [...result.characterUpdates, currentCharacter];
						currentCharacter = null;
					}
					result.newScene = parseSceneHeader(heading.text);
				} else if (currentSection === 'characters') {
					if (currentCharacter) {
						result.characterUpdates = [...result.characterUpdates, currentCharacter];
					}
					currentCharacter = { characterName: heading.text.trim(), aliases: [], sceneEntries: [] };
				}
				continue;
			}
		}

		if (token.type === 'list') {
			const list = token as Tokens.List;

			if (currentSection === 'progress') {
				for (const item of list.items) {
					const match = item.text.match(new RegExp(`${COMPLETED_SCENES_LABEL}:\\s*(\\d+)`, 'i'));
					if (match) {
						result.completedScenes = parseInt(match[1], 10);
					}
				}
				continue;
			}

			if (currentSection === 'scenes' && result.newScene) {
				for (const item of list.items) {
					applySceneListItem(result.newScene, item.text);
				}
				continue;
			}

			if (currentSection === 'characters' && currentCharacter) {
				for (const item of list.items) {
					applyCharacterListItem(currentCharacter, item.text);
				}
				continue;
			}
		}

		// Handle Location/Summary as paragraphs
		// Paragraphs may contain multiple lines (e.g., "Location: ...\nSummary: ...")
		if (token.type === 'paragraph' && currentSection === 'scenes' && result.newScene) {
			const text = (token as Tokens.Paragraph).text;
			for (const line of text.split('\n')) {
				applySceneListItem(result.newScene, line.trim());
			}
			continue;
		}
	}

	// Flush final pending character
	if (currentCharacter) {
		result.characterUpdates = [...result.characterUpdates, currentCharacter];
	}

	return result;
}

// === Merging ===

/**
 * Merge incremental updates into an existing act summary.
 * - completedScenes: overridden from incremental (if present)
 * - newScene: appended to scenes
 * - Characters: matched by exact name; aliases merged (union),
 *   scene entries appended. New characters added.
 */
export function mergeActSummary(existing: ActSummary, incremental: IncrementalUpdate): ActSummary {
	const result: ActSummary = {
		completedScenes: incremental.completedScenes ?? existing.completedScenes,
		scenes: incremental.newScene ? [...existing.scenes, incremental.newScene] : [...existing.scenes],
		characters: [...existing.characters.map((c) => ({ ...c, aliases: [...c.aliases], sceneEntries: [...c.sceneEntries] }))],
	};

	for (const update of incremental.characterUpdates) {
		const existingIdx = result.characters.findIndex((c) => c.characterName === update.characterName);

		if (existingIdx >= 0) {
			const existingChar = result.characters[existingIdx];
			// Merge aliases: union preserving existing order, then new aliases
			const mergedAliases = [...existingChar.aliases];
			for (const alias of update.aliases) {
				if (!mergedAliases.includes(alias)) {
					mergedAliases.push(alias);
				}
			}
			result.characters[existingIdx] = {
				...existingChar,
				aliases: mergedAliases,
				sceneEntries: [...existingChar.sceneEntries, ...update.sceneEntries],
			};
		} else {
			result.characters = [...result.characters, { ...update, aliases: [...update.aliases], sceneEntries: [...update.sceneEntries] }];
		}
	}

	return result;
}
