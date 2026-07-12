/**
 * Archive schema version history:
 *   1 — initial schema
 *   2 — added `characterProfiles` field (optional; older archives without it still load)
 */
export const CURRENT_ARCHIVE_VERSION = 2;

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
		state: string;
		goal: string | null;
		relationships: string | null;
		voice: string | null;
		sceneDetails: string;
		importance: number;
		createdAt: number;
		updatedAt: number;
	}[];
}
