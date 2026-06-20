import { t } from '$lib/i18n';
import { settings } from '$lib/stores/settings.svelte';
import { VOICE_LIST, getVoiceLabel } from '$lib/kokoro/voices';

export function getProviderItems(): { label: string; value: string }[] {
	return [
		{ label: t('settings.providers.openaiCompatible'), value: 'openai-compatible' },
		{ label: t('settings.providers.openai'), value: 'openai' },
		{ label: t('settings.providers.ollama'), value: 'ollama' },
	];
}

export function getApiTypeItems(): { label: string; value: string }[] {
	return [
		{ label: t('settings.apiTypes.responses'), value: 'responses' },
		{ label: t('settings.apiTypes.chatCompletions'), value: 'chat-completions' },
	];
}

export function getLocaleItems(): { label: string; value: string }[] {
	return [
		{ label: 'English', value: 'en' },
		{ label: '繁體中文（香港）', value: 'zh-Hant-HK' },
	];
}

export function getThemeModeItems(): { label: string; value: string }[] {
	return [
		{ label: t('settings.themeModeSystem'), value: 'system' },
		{ label: t('settings.themeModeLight'), value: 'light' },
		{ label: t('settings.themeModeDark'), value: 'dark' },
	];
}

export function getColorThemeItems(): { label: string; value: string }[] {
	return [
		{ label: 'Hiyori', value: 'hiyori' },
		{ label: 'Catppuccin', value: 'catppuccin' },
		{ label: 'Cerberus', value: 'cerberus' },
		{ label: 'Concord', value: 'concord' },
		{ label: 'Crimson', value: 'crimson' },
		{ label: 'Fennec', value: 'fennec' },
		{ label: 'Hamlindigo', value: 'hamlindigo' },
		{ label: 'Legacy', value: 'legacy' },
		{ label: 'Mint', value: 'mint' },
		{ label: 'Modern', value: 'modern' },
		{ label: 'Mona', value: 'mona' },
		{ label: 'Nosh', value: 'nosh' },
		{ label: 'Nouveau', value: 'nouveau' },
		{ label: 'Pine', value: 'pine' },
		{ label: 'Reign', value: 'reign' },
		{ label: 'Rocket', value: 'rocket' },
		{ label: 'Rose', value: 'rose' },
		{ label: 'Sahara', value: 'sahara' },
		{ label: 'Seafoam', value: 'seafoam' },
		{ label: 'Terminus', value: 'terminus' },
		{ label: 'Vintage', value: 'vintage' },
		{ label: 'Vox', value: 'vox' },
		{ label: 'Wintry', value: 'wintry' },
	];
}

export function getLogLevelItems(): { label: string; value: string }[] {
	return [
		{ label: t('settings.logLevels.error'), value: 'error' },
		{ label: t('settings.logLevels.warn'), value: 'warn' },
		{ label: t('settings.logLevels.info'), value: 'info' },
		{ label: t('settings.logLevels.debug'), value: 'debug' },
	];
}

export function getReviewerModeItems(): { label: string; value: string }[] {
	return [
		{ label: t('settings.reviewerModeDetailed'), value: 'detailed' },
		{ label: t('settings.reviewerModeQuick'), value: 'quick' },
	];
}

export function getRoleItems(includeMain: boolean = true): { label: string; value: string }[] {
	const items: { label: string; value: string }[] = [];
	if (includeMain) items.push({ label: t('settings.mainProvider'), value: 'main' });
	for (const c of settings.providers) items.push({ label: c.name, value: c.id });
	return items;
}

export function getVoiceItems(): { label: string; value: string }[] {
	return VOICE_LIST.map((v) => ({ label: getVoiceLabel(v), value: v.id }));
}
