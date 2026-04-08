import { getDatabase } from './database';

export interface Message {
	id: string;
	role: 'user' | 'assistant';
	content: string;
	reasoning?: string;
	metadata?: string;
	createdAt: number;
}

interface MessageRow {
	id: string;
	role: string;
	content: string;
	reasoning: string | null;
	metadata: string | null;
	created_at: number;
}

function rowToMessage(row: MessageRow): Message {
	return {
		id: row.id,
		role: row.role as 'user' | 'assistant',
		content: row.content,
		reasoning: row.reasoning ?? undefined,
		metadata: row.metadata ?? undefined,
		createdAt: row.created_at
	};
}

export async function createMessage(
	id: string,
	role: 'user' | 'assistant',
	content: string,
	reasoning?: string,
	metadata?: string
): Promise<Message> {
	const db = getDatabase();
	const now = Date.now();
	await db.execute(
		`INSERT INTO messages (id, role, content, reasoning, metadata, created_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		[id, role, content, reasoning ?? null, metadata ?? null, now]
	);
	return {
		id,
		role,
		content,
		reasoning,
		metadata,
		createdAt: now
	};
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