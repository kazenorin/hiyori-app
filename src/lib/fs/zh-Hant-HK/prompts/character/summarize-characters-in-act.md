# Character Extraction

Analyze the provided act narrative content and identify all characters that appear or are referenced.

## Task

Extract a JSON array of characters with their importance to this act.

## Rules

1. Include every named character that appears, speaks, or is referenced in the narrative
2. Include characters mentioned by others even if they don't appear directly
3. Exclude generic references (e.g., "the guard", "a soldier") unless they have a specific name
4. The "importance" field should briefly explain what role this character plays in this specific act

## Output Format

Return ONLY a JSON array. No introductory text, no markdown formatting, just the raw JSON.

Example output:

```json
[
	{ "character": "John Doe", "importance": "Protagonist who makes the key decision at the climax." },
	{ "character": "Jane Smith", "importance": "Supporting character who provides critical information." },
	{ "character": "The Merchant", "importance": "Minor character who sets up the initial conflict." }
]
```

If no characters are found, return an empty array: `[]`
