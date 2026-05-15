import { actSummaryHeader, turnOfEventsHeader, summaryHeader, sectionFormat } from '$lib/definitions/common-headers';
import { sceneWithNumberLabel, locationLabel, aliasesLabel } from '$lib/definitions/common-labels';
import { sceneSummariesHeader, characterSummariesHeader } from '$lib/definitions/pipeline-prompts';

// === Types ===

export interface CharacterAliasEntry {
	characterName: string;
	aliases: string[];
}

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
	turnOfEvents: string | null;
	turnOfEventsSceneNumber: number | null;
	turnOfEventsSceneTitle: string | null;
}

export interface IncrementalUpdate {
	completedScenes?: number;
	newScene?: SceneSummary;
	characterUpdates: CharacterSummary[];
}

// === Helpers ===

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripCodeFences(text: string): string {
	return text.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '');
}

function stripListMarker(text: string): string {
	return text.replace(/^[-*]\s+/, '');
}

/** Build a locale-aware regex matching "Scene N: Title" / "場景 N: Title" / etc. */
function buildSceneHeaderRegex(): RegExp {
	const sample = sceneWithNumberLabel(0);
	const numMatch = sample.match(/^(.*?)0(.*)$/);
	if (!numMatch) return /^(\d+)\s*[:\-–]\s*(.+)$/;
	const [, prefix, suffix] = numMatch;
	return new RegExp(`^${escapeRegex(prefix)}(\\d+)${escapeRegex(suffix)}\\s*[:\\-–]\\s*(.+)$`, 'i');
}

function extractLabeledValue(text: string, label: string): string | null {
	const regex = new RegExp(`^${escapeRegex(label)}:\\s*(.+)$`, 'i');
	const match = text.match(regex);
	return match ? match[1].trim() : null;
}

// === H2 Section Splitter ===

function splitByH2Sections(content: string): Map<string, string> {
	const sections = new Map<string, string>();
	const h2Regex = /^## (.+)$/;
	let currentHeader: string | null = null;
	const currentLines: string[] = [];

	for (const line of content.split('\n')) {
		const match = line.match(h2Regex);
		if (match) {
			if (currentHeader !== null) {
				sections.set(currentHeader, currentLines.join('\n').trim());
			}
			currentHeader = match[1].trim();
			currentLines.length = 0;
		} else if (currentHeader !== null) {
			currentLines.push(line);
		}
	}

	if (currentHeader !== null) {
		sections.set(currentHeader, currentLines.join('\n').trim());
	}

	return sections;
}

// === Sub-parsers ===

function parseScenesBody(body: string): SceneSummary[] {
	const scenes: SceneSummary[] = [];
	const sceneHeaderRegex = buildSceneHeaderRegex();
	let currentScene: SceneSummary | null = null;

	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		const h3Match = trimmed.match(/^###\s+(.+)$/);
		if (h3Match) {
			if (currentScene) scenes.push(currentScene);
			const headerText = h3Match[1];
			const sceneMatch = headerText.match(sceneHeaderRegex);
			currentScene = sceneMatch
				? { sceneNumber: parseInt(sceneMatch[1], 10), title: sceneMatch[2].trim(), location: '', summary: '' }
				: { sceneNumber: 0, title: headerText.trim(), location: '', summary: '' };
			continue;
		}

		if (!currentScene) continue;

		const text = stripListMarker(trimmed);
		if (!text) continue;

		const location = extractLabeledValue(text, locationLabel());
		if (location !== null) {
			currentScene.location = location;
			continue;
		}

		const summary = extractLabeledValue(text, summaryHeader());
		if (summary !== null) {
			currentScene.summary = summary;
			continue;
		}

		if (!currentScene.summary) {
			currentScene.summary = text;
		} else if (!currentScene.location) {
			currentScene.location = text;
		}
	}

	if (currentScene) scenes.push(currentScene);
	return scenes;
}

function parseCharactersBody(body: string): CharacterSummary[] {
	const characters: CharacterSummary[] = [];
	const sceneItemRegex = buildSceneHeaderRegex();
	const aliasRegex = new RegExp(`^${escapeRegex(aliasesLabel())}:\\s*\\[?(.+?)\\]?$`, 'i');
	let currentCharacter: CharacterSummary | null = null;

	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		const h3Match = trimmed.match(/^###\s+(.+)$/);
		if (h3Match) {
			if (currentCharacter) characters.push(currentCharacter);
			currentCharacter = { characterName: h3Match[1].trim(), aliases: [], sceneEntries: [] };
			continue;
		}

		if (!currentCharacter) continue;

		const text = stripListMarker(trimmed);
		if (!text) continue;

		const aliasMatch = text.match(aliasRegex);
		if (aliasMatch) {
			currentCharacter.aliases = aliasMatch[1]
				.trim()
				.split(',')
				.map((a) => a.trim())
				.filter((a) => a.length > 0);
			continue;
		}

		const sceneMatch = text.match(sceneItemRegex);
		if (sceneMatch) {
			currentCharacter.sceneEntries = [
				...currentCharacter.sceneEntries,
				{ sceneNumber: parseInt(sceneMatch[1], 10), summary: sceneMatch[2].trim() },
			];
		}
	}

	if (currentCharacter) characters.push(currentCharacter);
	return characters;
}

function parseTurnOfEventsBody(body: string): {
	turnOfEvents: string;
	turnOfEventsSceneNumber: number | null;
	turnOfEventsSceneTitle: string | null;
} {
	const sceneHeaderRegex = buildSceneHeaderRegex();
	let turnOfEventsSceneNumber: number | null = null;
	let turnOfEventsSceneTitle: string | null = null;
	const textLines: string[] = [];

	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		const h3Match = trimmed.match(/^###\s+(.+)$/);
		if (h3Match) {
			const sceneMatch = h3Match[1].match(sceneHeaderRegex);
			if (sceneMatch) {
				turnOfEventsSceneNumber = parseInt(sceneMatch[1], 10);
				turnOfEventsSceneTitle = sceneMatch[2].trim();
			}
			continue;
		}

		textLines.push(trimmed);
	}

	return {
		turnOfEvents: textLines.join('\n'),
		turnOfEventsSceneNumber,
		turnOfEventsSceneTitle,
	};
}

// === Public API ===

export function parseCharacterAliases(actSummaryMarkdown: string): CharacterAliasEntry[] {
	const entries: CharacterAliasEntry[] = [];
	let currentName: string | null = null;
	let currentAliases: string[] = [];
	const aliasRegex = new RegExp(`^-?\\s*${escapeRegex(aliasesLabel())}:\\s*\\[?(.+?)\\]?$`, 'i');

	for (const line of actSummaryMarkdown.split('\n')) {
		const headerMatch = line.match(/^###\s+(.+)$/);
		if (headerMatch) {
			if (currentName !== null) {
				entries.push({ characterName: currentName, aliases: currentAliases });
			}
			currentName = headerMatch[1].trim();
			currentAliases = [];
			continue;
		}

		if (currentName !== null) {
			const aliasMatch = line.match(aliasRegex);
			if (aliasMatch) {
				currentAliases = aliasMatch[1]
					.trim()
					.split(',')
					.map((a) => a.trim())
					.filter((a) => a.length > 0);
			}
		}
	}

	if (currentName !== null) {
		entries.push({ characterName: currentName, aliases: currentAliases });
	}

	return entries;
}

export function parseActSummary(markdown: string): ActSummary {
	const content = stripCodeFences(markdown);
	const sections = splitByH2Sections(content);

	const scenesBody = sections.get(sceneSummariesHeader()) ?? null;
	const charactersBody = sections.get(characterSummariesHeader()) ?? null;
	const turnOfEventsBody = sections.get(turnOfEventsHeader()) ?? null;

	const scenes = scenesBody ? parseScenesBody(scenesBody) : [];
	const characters = charactersBody ? parseCharactersBody(charactersBody) : [];
	const toeResult = turnOfEventsBody
		? parseTurnOfEventsBody(turnOfEventsBody)
		: {
				turnOfEvents: null as string | null,
				turnOfEventsSceneNumber: null as number | null,
				turnOfEventsSceneTitle: null as string | null,
			};

	return {
		completedScenes: 0,
		scenes,
		characters,
		turnOfEvents: toeResult.turnOfEvents,
		turnOfEventsSceneNumber: toeResult.turnOfEventsSceneNumber,
		turnOfEventsSceneTitle: toeResult.turnOfEventsSceneTitle,
	};
}

export function serializeActSummary(data: ActSummary): string {
	const lines: string[] = [];

	lines.push(sectionFormat(actSummaryHeader(), 1).trimEnd());
	lines.push('');
	lines.push(sectionFormat(sceneSummariesHeader()).trimEnd());

	for (const scene of data.scenes) {
		lines.push(`### ${sceneWithNumberLabel(scene.sceneNumber)}: ${scene.title}`);
		if (scene.location) {
			lines.push(`${locationLabel()}: ${scene.location}`);
		}
		if (scene.summary) {
			lines.push(`${summaryHeader()}: ${scene.summary}`);
		}
		lines.push('');
	}

	lines.push(sectionFormat(characterSummariesHeader()).trimEnd());

	for (const character of data.characters) {
		lines.push(`### ${character.characterName}`);
		if (character.aliases.length > 0) {
			lines.push(`- ${aliasesLabel()}: [${character.aliases.join(', ')}]`);
		}
		for (const entry of character.sceneEntries) {
			lines.push(`- ${sceneWithNumberLabel(entry.sceneNumber)}: ${entry.summary}`);
		}
		lines.push('');
	}

	if (data.turnOfEvents && data.turnOfEvents.trim().length > 0) {
		lines.push(sectionFormat(turnOfEventsHeader()).trimEnd());
		if (data.turnOfEventsSceneNumber != null && data.turnOfEventsSceneTitle) {
			lines.push(`### ${sceneWithNumberLabel(data.turnOfEventsSceneNumber)}: ${data.turnOfEventsSceneTitle}`);
		}
		lines.push(data.turnOfEvents);
	}

	return lines.join('\n').trimEnd();
}

export function parseIncrementalOutput(markdown: string): IncrementalUpdate {
	const content = stripCodeFences(markdown);
	const sections = splitByH2Sections(content);

	const scenesBody = sections.get(sceneSummariesHeader()) ?? null;
	const charactersBody = sections.get(characterSummariesHeader()) ?? null;

	const scenes = scenesBody ? parseScenesBody(scenesBody) : [];
	const characters = charactersBody ? parseCharactersBody(charactersBody) : [];

	return {
		completedScenes: undefined,
		newScene: scenes.length > 0 ? scenes[0] : undefined,
		characterUpdates: characters,
	};
}

export function mergeActSummary(existing: ActSummary, incremental: IncrementalUpdate): ActSummary {
	const result: ActSummary = {
		completedScenes: incremental.completedScenes ?? existing.completedScenes,
		scenes: incremental.newScene ? [...existing.scenes, incremental.newScene] : [...existing.scenes],
		characters: [...existing.characters.map((c) => ({ ...c, aliases: [...c.aliases], sceneEntries: [...c.sceneEntries] }))],
		turnOfEvents: existing.turnOfEvents,
		turnOfEventsSceneNumber: existing.turnOfEventsSceneNumber,
		turnOfEventsSceneTitle: existing.turnOfEventsSceneTitle,
	};

	for (const update of incremental.characterUpdates) {
		const existingIdx = result.characters.findIndex((c) => c.characterName === update.characterName);

		if (existingIdx >= 0) {
			const existingChar = result.characters[existingIdx];
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
