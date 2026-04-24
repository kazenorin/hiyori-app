# Streaming Markdown SAX Parser

A streaming, SAX-style parser for Markdown structural elements. Designed for processing LLM output that arrives in arbitrary character chunks.

## Document Model

The parser models a Markdown document as a hierarchy of four element types:

```
root
└── page (implicit, or created by horizontal rule)
    ├── header (H1–H6, nested by level)
    │   ├── header (deeper levels)
    │   └── list
    └── list (nested by indentation)
        └── list (deeper levels)
```

### Elements

| Type | Depth | Description |
|------|-------|-------------|
| `root` | 0 | Always the outermost element. One per document. |
| `page` | 1 | Implicit page created on first content. New pages created by horizontal rules. |
| `header` | 1–6 | Matches header level. `name` contains the header text. Nested: deeper levels are children, same/shallower close and re-open. |
| `list` | 2+ | `listLevel` tracks nesting depth. `ordered` flag. `indentation` stores leading whitespace for nesting comparison. |

## Streaming Behavior

Input arrives via `feed(chunk)` calls with arbitrary string splits. The parser uses a hybrid strategy:

- **Non-structural text** — streamed character-by-character immediately via `onText`. No buffering.
- **Potential structural lines** — buffered until `\n` or `flush()`, then classified and processed as a unit.

A line is buffered when the first non-whitespace character at line start is one of: `#`, `-`, `*`, `_`, or a digit. Leading whitespace is also buffered (to support indented lists). If the buffered line turns out to be plain text (e.g., `#nope` without space), the buffer is flushed as text immediately.

## Line Classification

Classification is applied after stripping the trailing newline. Leading whitespace is counted (tabs = 3 spaces) and stripped before pattern matching, but the original indentation value is preserved for list nesting.

Evaluation order:

### 1. Header

```
## Title
```

1–6 `#` characters followed by a space. The rest of the line (trimmed) becomes the header `name`.

**Not a header:**
- `#nope` — no space after `#`
- `####### too many` — 7+ hashes is plain text

### 2. Unordered List

```
- item
* item
```

`-` or `*` followed by a space. Content after the marker is emitted as text.

**Disambiguation:** `- - -` and `* * *` match the horizontal rule pattern and are classified as HR, not list items.

### 3. Horizontal Rule

```
---
***
___
- - -
* * *
```

Three or more of the same character (`-`, `*`, `_`) with optional spaces between them. The full line (after stripping indentation) must match `^([-_*])(?:\s*\1){2,}\s*$`.

### 4. Ordered List

```
1. item
10. item
```

One or more digits followed by `. ` and content.

### 5. Plain Text

Anything that doesn't match the above patterns.

## Context Stack

All callbacks receive the current context stack — a `readonly ContextNode[]` representing the active element hierarchy.

```
onEnterElement — stack includes the new element
onLeaveElement — stack excludes the left element
onText         — stack is the current active context
```

Example context for text inside a nested list under an H2 header:

```
[root(0), page(1), header(2, H2, "Section"), list(3, level=2)]
```

## Transition Rules

### Header Transition

When a header is encountered:

1. Ensure a page is open (lazy creation).
2. Close any open lists (lists cannot contain headers).
3. Close deeper headers (higher headerLevel) until reaching a shallower or equal header, page, or root.
4. If same level — close it (sibling).
5. If shallower — stop closing (new child).
6. Push the new header.
7. Emit header name as text (if non-empty).

```
# H1 → ## H2 → ### H3 → ## H2b
                      ↑ close H3
                               ↑ close H2, then close H1? No — H2b is sibling of H2
```

### List Transition

When a list item is encountered:

1. Ensure a page is open.
2. Find the nearest list ancestor on the stack.
3. Compare indentation:
   - **More indented** → child. Close intervening elements, push new list at `listLevel + 1`.
   - **Same indentation** → sibling. Close up to and including the ancestor, push new list at same `listLevel`.
   - **Less indented** → pop past ancestor and repeat from step 2.
4. If no list ancestor → new list at `listLevel = 1`.
5. Emit content as text (if non-empty).

### Horizontal Rule Transition

When an HR is encountered:

1. Ensure a page is open (so the implicit page leave event fires).
2. Close all elements down to root.
3. Push a new page.

## Indentation

Leading whitespace is counted for list nesting comparison:

| Input | Indentation |
|-------|-------------|
| `- item` | 0 |
| `  - item` | 2 |
| `\t- item` | 3 (tab = 3 spaces) |
| `  \t- item` | 5 |

## Implicit Page

Pages are created lazily on first content. Empty input produces only a root element (no page). The first `onText`, header, or list triggers page creation.

## Flush

Call `flush()` at end of stream to:

1. Process any buffered but unterminated line (classifies and handles it).
2. Close all remaining elements on the stack (lists, headers, pages, root).

## Usage

```typescript
const events: Event[] = [];
const parser = createMarkdownSaxParser({
  onEnterElement: (el, ctx) => events.push({ event: 'enter', data: el, context: [...ctx] }),
  onLeaveElement: (el, ctx) => events.push({ event: 'leave', data: el, context: [...ctx] }),
  onText: (text, ctx) => events.push({ event: 'text', data: text, context: [...ctx] }),
});

for (const chunk of streamChunks) {
  parser.feed(chunk);
}
parser.flush();
```

## Streaming Behavior

### Early List Commit

Once a list marker is recognized and horizontal rule ambiguity is ruled out, the parser commits to the list structure immediately (without waiting for `\n`). Remaining content on that line is streamed per-chunk rather than char-by-char.

**HR safety:** For `- ` and `* ` markers, early commit is deferred if the first content char matches the marker char (e.g., `- - ...` could become `- - -` HR). Ordered lists have no HR ambiguity and always commit early.

Headers and HR patterns always buffer to the newline — they require the full line to determine structure.

### `onText` Contract

`onText` is never called with an empty string. Text arrives in three forms:

| Source | Granularity | Example |
|--------|-------------|---------|
| Non-structural body text | char-by-char | `feed("abc")` → 3 `onText` calls |
| Header name | single emission | `# Title` → `onText("Title")` once |
| List content (after early commit) | per-chunk | `feed("- He")`, `feed("llo")` → `onText("He")`, `onText("llo")` |

## Test Coverage

53 tests in `src/lib/__tests__/markdown-sax-parser.test.ts` covering:

- Basic element recognition (headers H1–H6, lists, HR, text)
- Implicit page creation
- Header transitions (child, sibling, skip-level)
- List transitions (sibling, child, parent, mixed ordered/unordered, triple nesting)
- Horizontal rule transitions (context closure, multiple pages)
- Context stack reporting (header names, list levels, full hierarchy)
- Streaming chunking (arbitrary splits, mid-header splits, char-by-char, early list commit)
- Streaming HR disambiguation (char-by-char `- - -` is HR, not list)
- Edge cases (`#nope`, 7 hashes, `---` vs `- item`, unterminated lines, whitespace-only lines, indented HR, indented ordered list, mixed nesting, consecutive headers)
