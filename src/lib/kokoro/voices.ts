export type VoiceQuality = 'A' | 'A-' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F+';

export interface VoiceInfo {
	id: string;
	name: string;
	language: 'en-us' | 'en-gb';
	gender: 'Female' | 'Male';
	quality: VoiceQuality;
}

export const VOICE_LIST: readonly VoiceInfo[] = [
	{ id: 'af_heart', name: 'Heart', language: 'en-us', gender: 'Female', quality: 'A' },
	{ id: 'af_bella', name: 'Bella', language: 'en-us', gender: 'Female', quality: 'A-' },
	{ id: 'af_nicole', name: 'Nicole', language: 'en-us', gender: 'Female', quality: 'B-' },
	{ id: 'af_sarah', name: 'Sarah', language: 'en-us', gender: 'Female', quality: 'C+' },
	{ id: 'af_kore', name: 'Kore', language: 'en-us', gender: 'Female', quality: 'C+' },
	{ id: 'af_aoede', name: 'Aoede', language: 'en-us', gender: 'Female', quality: 'C+' },
	{ id: 'af_nova', name: 'Nova', language: 'en-us', gender: 'Female', quality: 'C' },
	{ id: 'af_alloy', name: 'Alloy', language: 'en-us', gender: 'Female', quality: 'C' },
	{ id: 'af_river', name: 'River', language: 'en-us', gender: 'Female', quality: 'D' },
	{ id: 'af_jessica', name: 'Jessica', language: 'en-us', gender: 'Female', quality: 'D' },
	{ id: 'af_sky', name: 'Sky', language: 'en-us', gender: 'Female', quality: 'C-' },
	{ id: 'am_michael', name: 'Michael', language: 'en-us', gender: 'Male', quality: 'C+' },
	{ id: 'am_fenrir', name: 'Fenrir', language: 'en-us', gender: 'Male', quality: 'C+' },
	{ id: 'am_puck', name: 'Puck', language: 'en-us', gender: 'Male', quality: 'C+' },
	{ id: 'am_echo', name: 'Echo', language: 'en-us', gender: 'Male', quality: 'D' },
	{ id: 'am_eric', name: 'Eric', language: 'en-us', gender: 'Male', quality: 'D' },
	{ id: 'am_onyx', name: 'Onyx', language: 'en-us', gender: 'Male', quality: 'D' },
	{ id: 'am_adam', name: 'Adam', language: 'en-us', gender: 'Male', quality: 'F+' },
	{ id: 'am_santa', name: 'Santa', language: 'en-us', gender: 'Male', quality: 'D-' },
	{ id: 'am_liam', name: 'Liam', language: 'en-us', gender: 'Male', quality: 'D' },
	{ id: 'bf_emma', name: 'Emma', language: 'en-gb', gender: 'Female', quality: 'B-' },
	{ id: 'bf_isabella', name: 'Isabella', language: 'en-gb', gender: 'Female', quality: 'C' },
	{ id: 'bf_alice', name: 'Alice', language: 'en-gb', gender: 'Female', quality: 'D' },
	{ id: 'bf_lily', name: 'Lily', language: 'en-gb', gender: 'Female', quality: 'D' },
	{ id: 'bm_george', name: 'George', language: 'en-gb', gender: 'Male', quality: 'C' },
	{ id: 'bm_fable', name: 'Fable', language: 'en-gb', gender: 'Male', quality: 'C' },
	{ id: 'bm_daniel', name: 'Daniel', language: 'en-gb', gender: 'Male', quality: 'D' },
	{ id: 'bm_lewis', name: 'Lewis', language: 'en-gb', gender: 'Male', quality: 'D+' },
];

export const DEFAULT_VOICE = 'af_heart';

const LANGUAGE_LABELS: Record<string, string> = {
	'en-us': 'American English',
	'en-gb': 'British English',
};

export function getVoiceLabel(voice: VoiceInfo): string {
	return `${voice.name} (${voice.gender}, ${LANGUAGE_LABELS[voice.language] ?? voice.language})`;
}
