import { LocaleStringBundle, registerLocaleStringDefaults, flattenToPaths } from '$lib/fs/locale-string-loader';
import { log } from '$lib/logging/logger';
import defaultEnStrings from '$lib/fs/locale-strings/en.json?raw';
import defaultZhHantHkStrings from '$lib/fs/locale-strings/zh-Hant-HK.json?raw';

let cache: Record<string, string> = {};
let currentLocale = 'en';

const enBundle = new LocaleStringBundle({ locale: 'en', defaultContent: defaultEnStrings });
const zhHantHkBundle = new LocaleStringBundle({ locale: 'zh-Hant-HK', defaultContent: defaultZhHantHkStrings });

registerLocaleStringDefaults([enBundle, zhHantHkBundle]);

export async function loadLocaleStrings(locale: string, storyId?: string, storyName?: string): Promise<void> {
	currentLocale = locale;
	let data: Record<string, unknown>;

	if (storyId && storyName) {
		const bundle = getBundle(locale);
		const storyFolder = await resolveStoryFolder(storyId, storyName);
		data = await bundle.loadForStory(storyFolder);
	} else {
		const bundle = getBundle(locale);
		data = await bundle.load();
	}

	cache = flattenToPaths(data);
}

function getBundle(locale: string): LocaleStringBundle {
	if (locale === 'zh-Hant-HK') return zhHantHkBundle;
	return enBundle;
}

async function resolveStoryFolder(_storyId: string, _storyName: string): Promise<string> {
	try {
		const { resolveStoryFolder: resolve } = await import('$lib/fs/story-folders');
		return await resolve(_storyId, _storyName);
	} catch {
		return '';
	}
}

export function ls(key: string, params?: Record<string, string | number>): string {
	const template = cache[key];
	if (template === undefined) {
		void log.warn('locale-strings', `Missing locale string key: ${key}`);
		return key;
	}
	if (!params) return template;

	return template.replace(/\{(\w+)\}/g, (match, paramKey) => {
		const value = params[paramKey];
		return value !== undefined ? String(value) : match;
	});
}
