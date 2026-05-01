import { getDatabase } from './database';
import {
	type NarrativeVariables,
	type GameDataFields,
	emptyVariables,
	FIELD_DESCRIPTORS,
	emptyGameDataFields,
	setField,
} from '$lib/ai/narrative-types';

export interface MessageBase {
	role: 'user' | 'assistant';
	content: string;
}

export interface Message extends MessageBase {
	id: string;
	reasoning?: string;
	metadata?: string;
	sceneNumber?: number;
	summary?: string;
	variables?: NarrativeVariables;
	createdAt: number;
}

interface MessageRow {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	variables: string | null;
	summary: string | null;
	scene_number: number | null;
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
		for (const desc of FIELD_DESCRIPTORS) {
			const value = parsed[desc.fieldName];
			if (typeof value === 'string') {
				setField(result, desc.fieldName, value);
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
	if (Array.isArray(raw.activePlotThreads)) {
		gd.activePlotThreads = raw.activePlotThreads.filter((d: unknown) => typeof d === 'string');
	}
	if (typeof raw.decisionContext === 'string') {
		gd.decisionContext = raw.decisionContext;
	}
	if (Array.isArray(raw.decisions)) {
		gd.decisions = raw.decisions.filter((d: unknown) => typeof d === 'string');
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
		summary: row.summary ?? undefined,
		sceneNumber: row.scene_number ?? undefined,
		createdAt: row.created_at,
	};
}

export async function createMessage(message: Omit<Message, 'createdAt'>): Promise<Message> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, variables, summary, scene_number, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		[
			message.id,
			message.role,
			message.content,
			message.reasoning ?? null,
			message.metadata ?? null,
			message.variables ? JSON.stringify(message.variables) : null,
			message.summary ?? null,
			message.sceneNumber ?? null,
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