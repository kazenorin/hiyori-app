export interface BaseMatch {
	parent?: MatchDescriptor;
	ancestor?: MatchDescriptor;
	children?: OutputDescriptor[];
}

export type HeaderMatch = { type: 'header'; content?: string; headerLevel?: number } & BaseMatch;
export type ListMatch = { type: 'list'; listIndex?: number } & BaseMatch;
export type ListItemMatch = { type: 'list_item'; listIndex?: number; itemIndex?: number } & BaseMatch;
export type ListLabeledItemMatch = { type: 'list_labeled_item'; listIndex?: number; content?: string } & BaseMatch;

export type MatchDescriptor = HeaderMatch | ListMatch | ListItemMatch | ListLabeledItemMatch;

export interface OutputDescriptor {
	outputPath: string;
	match?: MatchDescriptor;
	bodyOnly?: boolean;
	currentLevelOnly?: boolean;
}
