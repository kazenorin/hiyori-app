/** Shared error message constants for user-facing and internal errors. */

// === Provider configuration errors (user-facing, duplicated across AI modules) ===

export const ERR_NO_MAIN_PROVIDER = 'No main provider configured. Please set one in Settings.';
export const ERR_NO_PROVIDER_FOR_PHASE = (phase: string) => `No provider configured for ${phase}. Please set one in Settings.`;
export const ERR_API_KEY_NOT_CONFIGURED = 'API key not configured. Please set it in Settings.';
export const ERR_API_KEY_AND_MODEL_NOT_CONFIGURED = 'API key and model must be configured in Settings.';
export const ERR_AUTH_FAILED = 'Authentication failed. Please check your API key in Settings.';
export const ERR_MEMORY_PROVIDER_NOT_CONFIGURED = 'Memory provider not configured';
export const ERR_EMBEDDING_PROVIDER_NOT_CONFIGURED = 'Embedding provider not configured';

// === Narrative / content errors (user-facing) ===

export const ERR_NO_NARRATIVE_CONTENT = 'No narrative content found in this act line.';
export const ERR_NO_ACT_LINE_SELECTED = 'No active act line selected.';
export const ERR_ACTIVE_ACT_NOT_FOUND = 'Active act not found.';
export const ERR_NO_CHARACTERS_SELECTED = 'No characters selected for generation.';

// === Generation empty response errors (internal) ===

export const ERR_EMPTY_TURN_OF_EVENTS = 'Turn of events generation returned an empty response.';
export const ERR_EMPTY_ACT_PLOT_WRITER = 'Writer returned an empty response for act-plot generation.';
export const ERR_EMPTY_STREAM = 'empty response from stream';

// === Internal errors (developer-facing, logged not displayed) ===

export const ERR_DB_NOT_INITIALIZED = 'Database not initialized. Call initDatabase() first.';
export const ERR_MEMORY_DB_NOT_INITIALIZED = 'Memory database not initialized. Call initMemoryDatabase() first.';
export const ERR_INVALID_MESSAGE_ROLE = 'Invalid message: expected assistant message';
export const ERR_MESSAGE_SEQUENCE_NOT_FOUND = 'Could not find message sequence';
export const ERR_FAILED_VECTOR_ROWID = 'Failed to retrieve vector rowid after insert';
export const ERR_FAILED_LOCATION_VECTOR_ROWID = 'Failed to retrieve location vector rowid after insert';

// === Import / transcript parsing errors (user-facing) ===

export const ERR_INVALID_APP_EXPORT = 'Invalid App Export format';
export const ERR_INVALID_OPENAI_FORMAT = 'Invalid Simple OpenAI API format';
export const ERR_INVALID_OPENWEBUI_FORMAT = 'Invalid Open WebUI format';
export const ERR_OPENWEBUI_EMPTY = 'Open WebUI export is empty';
export const ERR_UNABLE_TO_DETECT_FORMAT = 'Unable to detect transcript format';

// === World generator errors (user-facing) ===

export const ERR_NO_MESSAGES_FOR_WORLD = 'No messages found in story to generate world from.';
export const ERR_NO_AT_LEAST_ONE_CONTENT = 'At least one piece of content (world, act, or character) must be provided.';
