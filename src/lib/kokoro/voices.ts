import { VOICES } from './kokoro-hiyori/voices';
import type { VoiceId, VoiceInfo, VoiceLanguage } from './kokoro-hiyori/voices';

export function getVoiceList(): Readonly<Record<VoiceId, VoiceInfo>> {
	return VOICES;
}

const LANGUAGE_LABELS: Record<VoiceLanguage, string> = {
	'en-us': 'American English',
	'en-gb': 'British English',
};

export function getVoiceLabel(voice: VoiceInfo): string {
	return `${voice.name} (${voice.gender}, ${LANGUAGE_LABELS[voice.language] ?? voice.language})`;
}
