/**
 * Archive schema version history:
 *   1 — initial schema
 *   2 — added `characterProfiles` field (optional; older archives without it still load).
 *        Includes `logline` (NOT NULL); `state` is nullable.
 *   3 — added `messagePhases` field (optional; per-phase generation output keyed by
 *        message id, mirroring the `message_phases` table).
 *   4 — added optional `traits` to `characterProfiles` entries (older archives without it still load).
 *   5 — added optional `removed` to `characterProfiles` entries and exports complete profile
 *        history including tombstones. Older archives omit `removed`, whose entries import as
 *        active (older archives without it still load).
 *   6 — added `inventory` field (optional; complete inventory event history keyed by act line,
 *        mirroring the `inventory` table). Older archives without it still load, but carry no
 *        inventory rows.
 */
export const CURRENT_ARCHIVE_VERSION = 6;

export interface StoryExportData {
	version: number;
	story: {
		id: string;
		name: string;
		locale: string;
		createdAt: number;
		updatedAt: number;
	};
	storyFolder: {
		storyId: string;
		folderName: string;
		createdAt: number;
	};
	acts: {
		id: string;
		storyId: string;
		name: string;
		actNumber: number;
		continuesFromActLineId: string | null;
		createdAt: number;
		updatedAt: number;
	}[];
	actLineMeta: {
		id: string;
		actId: string;
		name: string;
		isMainLine: boolean;
		createdAt: number;
		plotMode: string;
	}[];
	actLineEvents: {
		id: string;
		actLineId: string;
		messageId: string | null;
		messageSequence: number;
		event: string;
		value: string | null;
		createdAt: number;
	}[];
	actLineEntries: {
		actLineId: string;
		messageId: string;
		sequence: number;
	}[];
	actLinePremises: {
		actLineId: string;
		messageId: string;
		sequence: number;
	}[];
	directorNotes: {
		id: string;
		actLineId: string;
		text: string;
		isActive: boolean;
		effectiveFromScene: number | null;
		effectiveToScene: number | null;
		createdAt: number;
	}[];
	messages: {
		id: string;
		role: string;
		content: string;
		reasoning: string | null;
		metadata: string | null;
		variables: string | null;
		actSummary: string | null;
		scenePlot: string | null;
		importantPhrases: string | null;
		sceneNumber: number | null;
		createdAt: number;
	}[];
	characterProfiles?: {
		id: string;
		actLineId: string;
		sceneNumber: number | null;
		canonicalName: string;
		preferredName: string;
		aliases: string[];
		logline: string;
		state: string | null;
		goal: string | null;
		relationships: string | null;
		voice: string | null;
		traits?: string[];
		sceneDetails: string;
		importance: number;
		/** Archive v5+. Absent in v1–v4 archives, which import as active. */
		removed?: boolean;
		createdAt: number;
		updatedAt: number;
	}[];
	messagePhases?: {
		messageId: string;
		phaseName: string;
		reasoning: string | null;
		content: string;
		sequence: number;
	}[];
	/** Archive v6+. Absent in v1–v5 archives, which import without inventory rows. */
	inventory?: {
		id: string;
		storyId: string;
		actLineId: string;
		messageId: string;
		sceneNumber: number | null;
		characterCanonicalName: string;
		itemName: string;
		eventType: string;
		category: string | null;
		equipStatus: string;
		description: string | null;
		createdAt: string | null;
	}[];
}
