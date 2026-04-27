import { getDatabase } from './database';
import {
	type NarrativeVariables,
	type GameDataFields,
	emptyVariables,
	NARRATIVE_VARIABLE_FIELDS,
	NUMBER_FIELDS,
	emptyGameDataFields,
	setField,
} from '$lib/ai/parser-chain';

export interface MessageBase {
	role: 'user' | 'assistant';
	content: string;
}

export interface Message extends MessageBase {
	id: string;
	reasoning?: string;
	metadata?: string;
	sceneNumber?: number;
	sessionNumber?: number;
	variables?: NarrativeVariables;
	draftVariables?: NarrativeVariables;
	createdAt: number;
}

interface MessageRow {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	variables: string | null;
	draft_variables: string | null;
	scene_number: number | null;
	session_number: number | null;
	created_at: number;
}

export function parseVariables(raw: string | null): NarrativeVariables | undefined {
	if (!raw) return undefined;
	try {
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
			return undefined;
		}
		const result = emptyVariables();
		for (const field of NARRATIVE_VARIABLE_FIELDS) {
			const value = parsed[field];
			if (NUMBER_FIELDS.has(field)) {
				if (typeof value === 'number') {
					setField(result, field, value);
				}
			} else if (typeof value === 'string') {
				setField(result, field, value);
			}
		}
		if (parsed.gameData && typeof parsed.gameData === 'object') {
			result.gameData = parseGameDataFields(parsed.gameData);
		}
		return result;
	} catch {
		return undefined;
	}
}

function parseGameDataFields(raw: Record<string, unknown>): GameDataFields {
	const gd = emptyGameDataFields();
	if (typeof raw.worldState === 'string') gd.worldState = raw.worldState;
	if (Array.isArray(raw.decisions)) gd.decisions = raw.decisions.filter((d: unknown) => typeof d === 'string');
	if (Array.isArray(raw.playerAliases)) gd.playerAliases = raw.playerAliases.filter((d: unknown) => typeof d === 'string');
	if (raw.otherCharacterAliases && typeof raw.otherCharacterAliases === 'object' && !Array.isArray(raw.otherCharacterAliases)) {
		const record: Record<string, string[]> = {};
		for (const [key, val] of Object.entries(raw.otherCharacterAliases)) {
			if (Array.isArray(val)) {
				record[key] = val.filter((d: unknown) => typeof d === 'string');
			}
		}
		gd.otherCharacterAliases = record;
	}
	return gd;
}

function rowToMessage(row: MessageRow): Message {
	return {
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		variables: parseVariables(row.variables),
		draftVariables: parseVariables(row.draft_variables),
		sceneNumber: row.scene_number ?? undefined,
		sessionNumber: row.session_number ?? undefined,
		createdAt: row.created_at,
	};
}

export async function createMessage(message: Omit<Message, 'createdAt'>): Promise<Message> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, variables, draft_variables, scene_number, session_number, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
		[
			message.id,
			message.role,
			message.content,
			message.reasoning ?? null,
			message.metadata ?? null,
			message.variables ? JSON.stringify(message.variables) : null,
			message.draftVariables ? JSON.stringify(message.draftVariables) : null,
			message.sceneNumber ?? null,
			message.sessionNumber ?? null,
			now,
		]
	);
	return { ...message, createdAt: now };
}

export async function getMessage(id: string): Promise<Message | null> {
	const db = getDatabase();
	const rows = await db.select<MessageRow[]>('SELECT * FROM messages WHERE id = $1', [id]);
	return rows.length > 0 ? rowToMessage(rows[0]) : null;
}

export async function deleteMessage(id: string): Promise<void> {
	const db = getDatabase();
	await db.execute('DELETE FROM messages WHERE id = $1', [id]);
}
