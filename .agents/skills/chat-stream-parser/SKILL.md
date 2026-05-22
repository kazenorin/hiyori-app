---
name: chat-stream-parser
description: 'Parse structured data from LLM markdown output using declarative descriptors. Use when: (1) Extracting structured content from AI-generated markdown (headers, lists, labeled items), (2) Building extraction prompts that produce predictable markdown sections, (3) Need to pull specific sections or fields from AI response text, (4) Parsing AI output into typed objects with nested structures. Triggers on: "parseContent", "OutputDescriptor", "extract header from markdown", "parse AI output", "structured extraction from LLM".'
---

## Overview

`chat-stream-parser` provides `parseContent()` — a declarative markdown parser that extracts structured data from LLM output using descriptor objects. Instead of writing regex or manual parsing, you declare *what* to extract and *where* to put it.

## Quick Start

```typescript
import { parseContent } from '$lib/chat-stream-parser';
import type { OutputDescriptor } from '$lib/chat-stream-parser';

const llmOutput = `# Analysis
Some analysis text

## Key Findings
- First finding
- Second finding

## Rating
- Quality: High
- Confidence: Medium`;

const descriptors: OutputDescriptor[] = [
  { outputPath: 'analysis', match: { type: 'header', content: 'Analysis' }, bodyOnly: true, currentLevelOnly: true },
  { outputPath: 'findings', match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Key Findings' } }, bodyOnly: true },
  { outputPath: 'quality', match: { type: 'list_labeled_item', content: 'Quality', parent: { type: 'header', content: 'Rating' } }, bodyOnly: true },
];

const result = parseContent(llmOutput, descriptors);
// result = { analysis: 'Some analysis text', findings: ['First finding', 'Second finding'], quality: 'High' }
```

## API

### `parseContent(content, descriptors?, output?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `content` | `string` | Markdown text (typically LLM output) |
| `descriptors` | `OutputDescriptor[]` | Declarative extraction rules (default: `[]`) |
| `output` | `T` | Pre-existing object to populate (optional) |

**Returns**: Populated object with extracted values at specified `outputPath`s.

**No descriptors**: When `descriptors` is empty or omitted, the full content is placed at `output.output`.

**Generic type**: Use `parseContent<MyType>(content, descriptors)` for typed results.

### OutputDescriptor

```typescript
interface OutputDescriptor {
  outputPath: string;       // Dot-notation path in output object (e.g. 'meta.score')
  match?: MatchDescriptor;  // How to locate the content; omit to assign full content
  bodyOnly?: boolean;       // Strip the markdown header/list marker, return just text
  currentLevelOnly?: boolean; // For headers: exclude sub-headers; for lists: exclude nested lists
}
```

### MatchDescriptor (union type)

Four match types, each with optional `parent` and `ancestor` filters:

| Type | Key Fields | Extracts |
|------|-----------|----------|
| `header` | `content`, `headerLevel?` | Section under a markdown heading |
| `list` | `listIndex?` | All items of a markdown list |
| `list_item` | `itemIndex`, `parent: { type: 'list' }` | Single item by position |
| `list_labeled_item` | `content` (label), `listIndex?` | Item matching "Label: value" pattern |

## Match Types in Detail

### Header — `{ type: 'header', content: 'Name', headerLevel?, parent?, ancestor?, children? }`

Extracts a section under a heading. Case-insensitive matching on header text.

```typescript
// Full section (header + body + sub-sections)
{ outputPath: 'section', match: { type: 'header', content: 'Summary' } }
// → '# Summary\nbody text\n## Sub\nmore'

// Body only (strips header line, includes sub-sections in body)
{ outputPath: 'body', match: { type: 'header', content: 'Summary' }, bodyOnly: true }
// → 'body text\n## Sub\nmore'

// Current level only (header + own body, no sub-sections)
{ outputPath: 'own', match: { type: 'header', content: 'Summary' }, currentLevelOnly: true }
// → '## Summary\nbody text'

// Specific heading level
{ outputPath: 'h3', match: { type: 'header', content: 'Title', headerLevel: 3 } }
```

**Parent filter**: Find header as direct child of another header:
```typescript
{ type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 1' } }
```

**Ancestor filter**: Find header anywhere under an ancestor (survives same-level siblings):
```typescript
{ type: 'header', content: 'Level 4', ancestor: { type: 'header', content: 'Level 1' } }
```

**Children**: Nested extraction within a section — the matched section becomes the source for child descriptors:
```typescript
{
  outputPath: 'lv1',
  match: {
    type: 'header', content: 'Level 1',
    children: [
      { outputPath: 'lv2', match: { type: 'header', content: 'Level 2' }, bodyOnly: true }
    ]
  }
}
// → { lv1: { lv2: 'l2 body' } }
```

### List — `{ type: 'list', listIndex?, parent? }`

Extracts all items from a markdown list. Returns `string[]`.

```typescript
// First list, with markers
{ outputPath: 'items', match: { type: 'list', listIndex: 0 } }
// → ['- item 1', '- item 2']

// Body only (strip markers)
{ outputPath: 'items', match: { type: 'list', listIndex: 0 }, bodyOnly: true }
// → ['item 1', 'item 2']

// Body only, current level (strip markers AND nested sub-lists)
{ outputPath: 'items', match: { type: 'list', listIndex: 0 }, bodyOnly: true, currentLevelOnly: true }
// → ['item 1', 'item 2'] (nested '- sub' items excluded)

// Second list in a section
{ outputPath: 'items', match: { type: 'list', listIndex: 1, parent: { type: 'header', content: 'Section' } }, bodyOnly: true }
```

### List Item — `{ type: 'list_item', itemIndex, parent: { type: 'list' } }`

Extracts a single item by position. Returns `string | null`.

```typescript
// With marker
{ outputPath: 'first', match: { type: 'list_item', itemIndex: 0, parent: { type: 'list', listIndex: 0 } } }
// → '- item 1'

// Body only
{ outputPath: 'first', match: { type: 'list_item', itemIndex: 0, parent: { type: 'list', listIndex: 0 } }, bodyOnly: true }
// → 'item 1'

// Within a header section
{ outputPath: 'item', match: { type: 'list_item', itemIndex: 1, parent: { type: 'header', content: 'Shopping' } }, bodyOnly: true }
```

### Labeled List Item — `{ type: 'list_labeled_item', content: 'Label', listIndex?, parent? }`

Extracts value from a "Label: value" list item. Case-insensitive label matching. Returns `string | null`.

```typescript
// Body only (just the value after the colon)
{ outputPath: 'score', match: { type: 'list_labeled_item', content: 'Quality' }, bodyOnly: true }
// Input: '- Quality: High' → 'High'

// Full raw text
{ outputPath: 'raw', match: { type: 'list_labeled_item', content: 'Quality' } }
// → '- Quality: High'

// Scoped to a header
{ outputPath: 'key', match: { type: 'list_labeled_item', content: 'Key', parent: { type: 'header', content: 'Section A' } }, bodyOnly: true }

// From the second list
{ outputPath: 'name', match: { type: 'list_labeled_item', content: 'Name', listIndex: 1 }, bodyOnly: true }
```

**Important**: Label matching requires exact prefix match followed by `:`. "Name" won't match "Name (full):" — use the exact label text.

## Key Behaviors

### Dot-notation outputPath

`outputPath` uses lodash `set()`, so nested paths work:
```typescript
{ outputPath: 'meta.scores.quality' } // → result.meta.scores.quality
```

### Pre-populated output object

Pass a third argument to merge into an existing object (useful with typed interfaces):
```typescript
interface MyOutput { fieldOne: string; fieldTwo: { inner: string } }
const output: MyOutput = { fieldOne: '', fieldTwo: { inner: '' } };
parseContent(content, descriptors, output);
```

### Unmatched values return null

- Headers that don't exist → `null`
- List items out of bounds → `null`
- Labeled items with no matching label → `null`
- Lists with no matching list → `[]` (empty array)

### Descendancy rules

Markdown structure defines what content "belongs" to a header:

- **Sub-headers** are included by default (use `currentLevelOnly: true` to exclude)
- **Same or higher-level headers** break descendancy (end the parent section)
- **Horizontal rules** (`---`) break all descendancy — content after `---` is a new group
- **Parent filter** requires direct parent-child relationship (broken by `---` or higher-level headers)
- **Ancestor Filter** allows any depth, but still respects `---` group boundaries

## Designing Extraction Prompts

When writing LLM prompts that produce output for `parseContent`:

1. **Use clear, unique header names** — avoid duplicate headers unless you use `parent`/`ancestor` filters
2. **Use labeled list items for key-value pairs** — `- Key: Value` pattern is matched by `list_labeled_item`
3. **Use lists for collections** — ordered or unordered lists extracted by `list` match type
4. **Use `---` to separate distinct sections** — HR breaks descendancy, creating clean boundaries
5. **Nest with depth** — `## Sub-section` under `# Section` creates parent-child for `parent` filter

## Common Patterns

See [patterns.md](references/patterns.md) for extraction prompt templates and descriptor recipes.

## Source

- `src/lib/utils/chat-stream-parser/parser.ts` — core parser logic
- `src/lib/utils/chat-stream-parser/types.ts` — type definitions
- `src/lib/utils/chat-stream-parser/index.ts` — barrel exports
- `src/lib/__tests__/chat-stream-parser/parser.test.ts` — 59 test cases (TDD reference)
