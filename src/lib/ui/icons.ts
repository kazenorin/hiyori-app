export type StrokeLinecap = 'round' | 'inherit' | 'butt' | 'square';
export type StrokeLinejoin = 'round' | 'inherit' | 'arcs' | 'miter-clip' | 'miter' | 'bevel';

export interface IconDef {
	viewBox: string;
	body: string;
	fill?: string;
	stroke?: string;
	strokeWidth?: number;
	strokeLinecap?: StrokeLinecap;
	strokeLinejoin?: StrokeLinejoin;
}

function stroke(body: string, viewBox = '0 0 24 24'): IconDef {
	return {
		viewBox,
		body,
		fill: 'none',
		stroke: 'currentColor',
		strokeWidth: 2,
		strokeLinecap: 'round',
		strokeLinejoin: 'round',
	};
}

function filled(body: string): IconDef {
	return {
		viewBox: '0 0 20 20',
		body,
		fill: 'currentColor',
		stroke: 'none',
	};
}

export const ICONS = {
	'chevron-down': filled(
		'<path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd" />'
	),
	pin: filled(
		'<path d="M9.854 2.354a.5.5 0 00-.708 0l-1.5 1.5a.5.5 0 000 .708L9.5 6.914l-5.354 5.354a.5.5 0 000 .708l2 2a.5.5 0 00.708 0L12.086 9.5l2.352 2.354a.5.5 0 00.708 0l1.5-1.5a.5.5 0 000-.708L14.414 7.5l2.352-2.354a.5.5 0 000-.708l-2-2a.5.5 0 00-.708 0L11.5 4.586 9.854 2.354z" />'
	),
	'pin-outline': filled(
		'<path d="M10 2a.75.75 0 01.75.75v1.5h3.5a.75.75 0 010 1.5h-.444l-.5 6h.444a.75.75 0 010 1.5h-3v5.25a.75.75 0 01-1.5 0V13.25h-3a.75.75 0 010-1.5h.444l-.5-6H5.75a.75.75 0 010-1.5h3.5v-1.5A.75.75 0 0110 2z" />'
	),
	'check-circle': filled(
		'<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd" />'
	),
	'x-circle': filled(
		'<path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clip-rule="evenodd" />'
	),
	'trash-alt': filled(
		'<path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022 1.015 11.08A2.75 2.75 0 007.774 19h4.452a2.75 2.75 0 002.745-2.519l1.015-11.08.149.022a.75.75 0 10.23-1.482A41.197 41.197 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clip-rule="evenodd" />'
	),

	copy: stroke('<rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />'),
	edit: stroke(
		'<path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />'
	),
	regenerate: stroke(
		'<polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />'
	),
	trash: stroke('<polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />'),
	send: stroke('<line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />'),
	'chat-bubble': stroke('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />'),
	bolt: stroke('<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />'),
	menu: stroke('<line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />'),
	fork: stroke(
		'<line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 01-9 9" />'
	),
	'keep-plot': stroke('<circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="3" fill="currentColor" />'),
	guidance: stroke('<circle cx="12" cy="12" r="10" /><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />'),
	'phase-event': stroke('<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" /><line x1="4" y1="22" x2="4" y2="15" />'),
	pencil: stroke('<path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />'),
	'dots-horizontal': stroke('<path d="M3 7h18M3 12h18M3 17h18" />'),
	download: stroke('<path d="M12 10v6m0 0l-3-3m3 3l3-3M3 17v3a2 2 0 002 2h14a2 2 0 002-2v-3" />'),
	book: stroke(
		'<path d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />'
	),
	cog: stroke(
		'<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37a1.724 1.724 0 002.573-1.066z" /><circle cx="12" cy="12" r="3" />'
	),
	folder: stroke('<path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />'),
	lock: stroke('<path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />'),
	'trash-can': stroke(
		'<path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />'
	),
	'copy-duplicate': stroke(
		'<path d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />'
	),
	'refresh-arrows': stroke(
		'<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />'
	),
	check: stroke('<path d="M5 13l4 4L19 7" />'),
	document: stroke(
		'<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />'
	),
	sparkles: stroke(
		'<path d="M9.937 3.737a.5.5 0 01.939 0l.97 2.423a.5.5 0 00.406.345l2.592.44a.5.5 0 01.265.863l-1.86 1.84a.5.5 0 00-.146.447l.439 2.587a.5.5 0 01-.758.536l-2.3-1.287a.5.5 0 00-.494 0l-2.3 1.287a.5.5 0 01-.757-.536l.439-2.587a.5.5 0 00-.147-.448L5.32 7.808a.5.5 0 01.265-.863l2.592-.44a.5.5 0 00.406-.345l.97-2.423zM18 2h1v1M18 7h3v1M16 4h1v1" />'
	),
	'book-open-text': stroke(
		'<path d="M2 3h5a4 4 0 014 4v14a3 3 0 00-3-3H2z" /><path d="M22 3h-5a4 4 0 00-4 4v14a3 3 0 013-3h6z" /><path d="M6 8h2" /><path d="M6 12h2" /><path d="M16 8h2" /><path d="M16 12h2" />'
	),
} as const satisfies Record<string, IconDef>;

export type IconName = keyof typeof ICONS;
