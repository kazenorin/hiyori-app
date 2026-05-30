# Memory System

The memory system extracts, stores, and retrieves character memories and locations from role-play transcripts using vector embeddings in SQLite.

## Architecture

```
Assistant Message
       |
       v
[Memory Extraction Pipeline]
       |
       |-- 1. LLM generates structured Markdown (character > location > memories)
       |-- 2. Markdown parser extracts into nested object
       |-- 3. Memory class persists with embeddings via sqlite-vec
       |
       v
  SQLite Database
   (vec_memories + memory_meta)
   (vec_locations + location_meta)
       |
       v
[Search / Query]
   - search(query, options)          -- semantic search across memories
   - searchLocations(query, options) -- semantic search across locations
   - searchByLocation(query, location, options) -- two-stage search filtered by location
```

## Components

### Memory Extraction Pipeline (`src/lib/ai/memory-extraction-pipeline.ts`)

Orchestrates the end-to-end flow from raw assistant response to persisted memories.

1. **LLM Generation** -- Sends the transcript to the memory LLM provider with a structured extraction prompt
2. **Parsing** -- `parseMemoryExtract()` converts the LLM's Markdown output into an `ExtractedMemories` object
3. **Persistence** -- For each character and location, calls `Memory.add()` and `Memory.addLocation()` with retry logic

Two provider configs are involved:

- **Memory provider** -- The LLM used for extraction (configured separately from the main chat model)
- **Embedding provider** -- The model used to generate vector embeddings

### Memory Extract Parser (`memory-extract-parser.ts`)

Parses Markdown structured as:

```markdown
## Character Name

### Time, Location

- Character Name did something.
- Character Name said to Recipient: "dialog".

### Later Time, Different Location

- Character Name recalled that past event.
```

Output structure: `{ "character-name": { "Time, Location": ["memory1", "memory2"] } }`

H2 headings become kebab-case character canonical names. H3 headings are location strings. List items are individual memory sentences.

### Memory Class (`memory.ts`)

Core persistence and query layer. Wraps sqlite-vec virtual tables with metadata tables for full-text and semantic search.

## Database Schema

### vec_memories (sqlite-vec virtual table)

```sql
CREATE VIRTUAL TABLE vec_memories USING vec0(
  story_id TEXT PARTITION KEY,
  act_line_id TEXT PARTITION KEY,
  embedding float[N]
);
```

### memory_meta

| Column                   | Type        | Description                       |
| ------------------------ | ----------- | --------------------------------- |
| id                       | TEXT (UUID) | Primary key                       |
| vec_rowid                | INTEGER     | Foreign key to vec_memories.rowid |
| content                  | TEXT        | The memory sentence               |
| message_id               | TEXT        | ID of the source message          |
| story_id                 | TEXT        | Story partition key               |
| act_line_id              | TEXT        | Act line partition key            |
| character_canonical_name | TEXT        | Kebab-case character name         |
| location                 | TEXT        | Location string from H3 heading   |
| created_at               | TEXT        | ISO timestamp                     |

### vec_locations (sqlite-vec virtual table)

```sql
CREATE VIRTUAL TABLE vec_locations USING vec0(
  story_id TEXT PARTITION KEY,
  embedding float[N]
);
```

### location_meta

| Column        | Type        | Description                        |
| ------------- | ----------- | ---------------------------------- |
| id            | TEXT (UUID) | Primary key                        |
| vec_rowid     | INTEGER     | Foreign key to vec_locations.rowid |
| location_text | TEXT        | The location string                |
| message_id    | TEXT        | ID of the source message           |
| story_id      | TEXT        | Story partition key                |
| act_line_id   | TEXT        | Act line partition key             |
| created_at    | TEXT        | ISO timestamp                      |

### memory_config

Key-value store for table metadata (`vec_dimension`, `model_key`, `loc_vec_dimension`, `loc_model_key`). Used to detect embedding model or dimension changes that would cause data corruption.

## Deduplication

### Memories (message-level)

When `add()` is called with multiple memories, embeddings are generated and deduplicated in-memory before insertion. Memories with cosine distance < 0.1 to an earlier memory in the same batch are discarded. This is a message-level check only -- it does not compare against the database.

### Locations (act-line-level)

`addLocation()` uses a two-layer check:

1. **Exact text match** -- Queries `location_meta` for an identical `location_text` in the same story and act line. If found, skips immediately without generating an embedding.
2. **Similarity check** -- If no exact match, generates an embedding and performs a KNN search against `vec_locations` for the same story. Joins with `location_meta` to filter by act line. If the closest match has cosine distance < 0.1, the location is skipped.

## Search Methods

### `search(query, options)`

Semantic search across memories. Generates an embedding for the query, then performs KNN against `vec_memories` filtered by `story_id` and optionally `act_line_id`. Results are joined with `memory_meta` for full metadata. When `options.locations` is provided, results are further filtered by `WHERE m.location IN (...)`.

### `searchLocations(query, options)`

Semantic search across locations. Same KNN pattern against `vec_locations`, joined with `location_meta`.

### `searchByLocation(query, location, options)`

Two-stage search. First calls `searchLocations(location, {...options, limit: 5})` to find locations matching the location description. Then calls `search(query, {...options, locations: results})` to find memories at those locations.

## Partition Keys

Both `vec_memories` and `vec_locations` use `story_id` as a partition key (sqlite-vec concept). `vec_memories` also partitions by `act_line_id`. This means:

- KNN searches are scoped to a single story (and optionally act line)
- Deletion by partition key is efficient: `DELETE FROM vec_memories WHERE story_id = ? AND act_line_id = ?`

## Model Safety

The system tracks the embedding model used to create each table via `memory_config`. If the model or dimension changes, the `ensureMemoryVecTable` / `ensureLocationVecTable` methods throw an error. This prevents mixing embeddings from different models, which would produce meaningless similarity scores. A full `reset()` is required to switch embedding models.

## sqlite-vec requirement

The memory system requires sqlite-vec (`vec0` virtual table module). It is only available in Tauri environments where the Rust backend registers it as a SQLite auto-extension. In non-Tauri environments (web/browser), the memory system is disabled entirely — see `isMemoryAvailable()` in settings.
