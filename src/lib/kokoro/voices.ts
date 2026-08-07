import { VOICES } from './kokoro-hiyori/voices';
import type { VoiceId, VoiceInfo, VoiceLanguage } from './kokoro-hiyori/voices';

export function getVoiceList(): Readonly<Record<VoiceId, VoiceInfo>> {
	return VOICES;
}

const LANGUAGE_LABELS: Record<VoiceLanguage, string> = {
	'en-us': 'American English',
	'en-gb': 'British English',
	ja: '日本語',
	zh: '中文',
	yue: '粵語',
	es: 'Español',
	'fr-fr': 'Français',
	hi: 'हिन्दी',
	it: 'Italiano',
	'pt-br': 'Português (Brasil)',
};

export function getVoiceLabel(voice: VoiceInfo): string {
	return `${voice.name} (${voice.gender}, ${LANGUAGE_LABELS[voice.language] ?? voice.language})`;
}
