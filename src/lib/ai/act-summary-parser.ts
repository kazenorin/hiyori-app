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