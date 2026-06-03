import { t } from '$lib/i18n';
import { settings } from '$lib/stores/settings.svelte';

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
