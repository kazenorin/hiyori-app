# chat-stream-parser: Extraction Patterns

Reusable prompt templates and descriptor recipes for common extraction scenarios.

## Pattern: Key-Value Summary

**Prompt instruction**: "Output a summary section with labeled items."

**LLM output format**:
```markdown
## Summary
- Title: The Adventure Begins
- Genre: Fantasy
- Tone: Light-hearted
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  { outputPath: 'title', match: { type: 'list_labeled_item', content: 'Title', parent: { type: 'header', content: 'Summary' } }, bodyOnly: true },
  { outputPath: 'genre', match: { type: 'list_labeled_item', content: 'Genre', parent: { type: 'header', content: 'Summary' } }, bodyOnly: true },
  { outputPath: 'tone', match: { type: 'list_labeled_item', content: 'Tone', parent: { type: 'header', content: 'Summary' } }, bodyOnly: true },
];
```

## Pattern: Item List

**Prompt instruction**: "List the items as a bulleted list."

**LLM output format**:
```markdown
## Items
- Sword of Light
- Shield of Ages
- Map of Eldoria
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  { outputPath: 'items', match: { type: 'list', listIndex: 0, parent: { type: 'header', content: 'Items' } }, bodyOnly: true },
];
// → items: ['Sword of Light', 'Shield of Ages', 'Map of Eldoria']
```

## Pattern: Nested Sections

**Prompt instruction**: "Use ## for each character, with labeled attributes."

**LLM output format**:
```markdown
## Aria
- Role: Protagonist
- Motivation: Find the lost city

## Kael
- Role: Antagonist
- Motivation: Harness the ancient power
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  {
    outputPath: 'aria',
    match: {
      type: 'header', content: 'Aria',
      children: [
        { outputPath: 'role', match: { type: 'list_labeled_item', content: 'Role' }, bodyOnly: true },
        { outputPath: 'motivation', match: { type: 'list_labeled_item', content: 'Motivation' }, bodyOnly: true },
      ],
    },
  },
  {
    outputPath: 'kael',
    match: {
      type: 'header', content: 'Kael',
      children: [
        { outputPath: 'role', match: { type: 'list_labeled_item', content: 'Role' }, bodyOnly: true },
        { outputPath: 'motivation', match: { type: 'list_labeled_item', content: 'Motivation' }, bodyOnly: true },
      ],
    },
  },
];
// → { aria: { role: 'Protagonist', motivation: 'Find the lost city' }, kael: { role: 'Antagonist', motivation: 'Harness the ancient power' } }
```

## Pattern: Same Header Name in Different Sections

**Prompt instruction**: "Use # for each subject with ## Comments sub-sections."

**LLM output format**:
```markdown
# Subject 1
## Contents
Alpha
## Comments
Beta
# Subject 2
## Contents
Delta
## Comments
Epsilon
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  { outputPath: 'comment1', match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 1' } }, bodyOnly: true },
  { outputPath: 'comment2', match: { type: 'header', content: 'Comments', parent: { type: 'header', content: 'Subject 2' } }, bodyOnly: true },
];
// → { comment1: 'Beta', comment2: 'Epsilon' }
```

## Pattern: Decision List with Labels

**Prompt instruction**: "List decisions as a numbered list with labeled items."

**LLM output format**:
```markdown
## Decisions
1. Action: Attack the guard
2. Consequence: Alert triggered
3. Outcome: Escape through window
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  { outputPath: 'action', match: { type: 'list_labeled_item', content: 'Action', parent: { type: 'header', content: 'Decisions' } }, bodyOnly: true },
  { outputPath: 'consequence', match: { type: 'list_labeled_item', content: 'Consequence', parent: { type: 'header', content: 'Decisions' } }, bodyOnly: true },
  { outputPath: 'outcome', match: { type: 'list_labeled_item', content: 'Outcome', parent: { type: 'header', content: 'Decisions' } }, bodyOnly: true },
];
// → { action: 'Attack the guard', consequence: 'Alert triggered', outcome: 'Escape through window' }
```

## Pattern: Flat Key-Value Across Multiple Lists

**Prompt instruction**: "Separate metadata and content into different lists."

**LLM output format**:
```markdown
- Name: Alice
- Age: 30

Some text between lists

- Name: Bob
- Age: 25
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  { outputPath: 'firstAge', match: { type: 'list_labeled_item', content: 'Age', listIndex: 0 }, bodyOnly: true },
  { outputPath: 'secondName', match: { type: 'list_labeled_item', content: 'Name', listIndex: 1 }, bodyOnly: true },
];
// → { firstAge: '30', secondName: 'Bob' }
```

## Pattern: Recursive Nested Extraction

**Prompt instruction**: "Use hierarchical headers for deep structure."

**LLM output format**:
```markdown
# Act 1
## Scene 1
### Dialogue
Hello world
### Action
They fought
```

**Descriptors**:
```typescript
const descriptors: OutputDescriptor[] = [
  {
    outputPath: 'act1',
    match: {
      type: 'header', content: 'Act 1',
      children: [{
        outputPath: 'scene1',
        match: {
          type: 'header', content: 'Scene 1',
          children: [
            { outputPath: 'dialogue', match: { type: 'header', content: 'Dialogue' }, bodyOnly: true },
            { outputPath: 'action', match: { type: 'header', content: 'Action' }, bodyOnly: true },
          ],
        },
      }],
    },
  },
];
// → { act1: { scene1: { dialogue: 'Hello world', action: 'They fought' } } }
```

## TDD Reference

All patterns above are derived from test cases in `src/lib/__tests__/chat-stream-parser/parser.test.ts`. When adding new match types or options:

1. Write the test first (describe → it → expect)
2. Import from `$lib/chat-stream-parser` (not relative paths)
3. Use `import type { OutputDescriptor }` for type-only imports
4. Cover: happy path, unmatched returns (null/[]), boundary options (bodyOnly, currentLevelOnly), parent/ancestor filters, descendancy boundaries (HR, same-level, higher-level headers)
