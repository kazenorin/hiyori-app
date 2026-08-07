import { getVoiceDataUrl, type TTSModelKey } from '$lib/kokoro/constants';

export type VoiceQuality = 'A' | 'A-' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F+';
export type VoiceLanguage = 'en-us' | 'en-gb' | 'ja' | 'zh' | 'yue' | 'es' | 'fr-fr' | 'hi' | 'it' | 'pt-br';
export type VoiceGender = 'Female' | 'Male';

export interface VoiceInfo {
	name: string;
	language: VoiceLanguage;
	gender: VoiceGender;
	model: TTSModelKey;
	traits?: string;
	overallGrade?: VoiceQuality;
}

const V11_ZH_VOICE_IDS = [
	'af_maple',
	'af_sol',
	'bf_vale',
	'zf_001',
	'zf_002',
	'zf_003',
	'zf_004',
	'zf_005',
	'zf_006',
	'zf_007',
	'zf_008',
	'zf_017',
	'zf_018',
	'zf_019',
	'zf_021',
	'zf_022',
	'zf_023',
	'zf_024',
	'zf_026',
	'zf_027',
	'zf_028',
	'zf_032',
	'zf_036',
	'zf_038',
	'zf_039',
	'zf_040',
	'zf_042',
	'zf_043',
	'zf_044',
	'zf_046',
	'zf_047',
	'zf_048',
	'zf_049',
	'zf_051',
	'zf_059',
	'zf_060',
	'zf_067',
	'zf_070',
	'zf_071',
	'zf_072',
	'zf_073',
	'zf_074',
	'zf_075',
	'zf_076',
	'zf_077',
	'zf_078',
	'zf_079',
	'zf_083',
	'zf_084',
	'zf_085',
	'zf_086',
	'zf_087',
	'zf_088',
	'zf_090',
	'zf_092',
	'zf_093',
	'zf_094',
	'zf_099',
	'zm_009',
	'zm_010',
	'zm_011',
	'zm_012',
	'zm_013',
	'zm_014',
	'zm_015',
	'zm_016',
	'zm_020',
	'zm_025',
	'zm_029',
	'zm_030',
	'zm_031',
	'zm_033',
	'zm_034',
	'zm_035',
	'zm_037',
	'zm_041',
	'zm_045',
	'zm_050',
	'zm_052',
	'zm_053',
	'zm_054',
	'zm_055',
	'zm_056',
	'zm_057',
	'zm_058',
	'zm_061',
	'zm_062',
	'zm_063',
	'zm_064',
	'zm_065',
	'zm_066',
	'zm_068',
	'zm_069',
	'zm_080',
	'zm_081',
	'zm_082',
	'zm_089',
	'zm_091',
	'zm_095',
	'zm_096',
	'zm_097',
	'zm_098',
	'zm_100',
] as const;

const V11_ZH_NAMED: Partial<Record<(typeof V11_ZH_VOICE_IDS)[number], string>> = {
	af_maple: 'Maple',
	af_sol: 'Sol',
	bf_vale: 'Vale',
};

function buildV11ZhVoice(id: (typeof V11_ZH_VOICE_IDS)[number]): VoiceInfo {
	const langCode = id.charAt(0);
	const language: VoiceLanguage = langCode === 'b' ? 'en-gb' : langCode === 'z' ? 'zh' : 'en-us';
	const gender: VoiceGender = id.charAt(1) === 'm' ? 'Male' : 'Female';

	return {
		name: V11_ZH_NAMED[id] ?? `${id.slice(0, 2).toUpperCase()} ${id.slice(3)}`,
		language,
		gender,
		model: 'v1.1-zh',
	};
}

const V11_ZH_VOICES = Object.fromEntries(V11_ZH_VOICE_IDS.map((id) => [id, buildV11ZhVoice(id)])) as Record<
	(typeof V11_ZH_VOICE_IDS)[number],
	VoiceInfo
>;

export const VOICES = Object.freeze({
	af_heart: {
		name: 'Heart',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		traits: '❤️',
		overallGrade: 'A',
	},
	af_alloy: {
		name: 'Alloy',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C',
	},
	af_aoede: {
		name: 'Aoede',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	af_bella: {
		name: 'Bella',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		traits: '🔥',
		overallGrade: 'A-',
	},
	af_jessica: {
		name: 'Jessica',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'D',
	},
	af_kore: {
		name: 'Kore',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	af_nicole: {
		name: 'Nicole',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		traits: '🎧',
		overallGrade: 'B-',
	},
	af_nova: {
		name: 'Nova',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C',
	},
	af_river: {
		name: 'River',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'D',
	},
	af_sarah: {
		name: 'Sarah',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	af_sky: {
		name: 'Sky',
		language: 'en-us',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C-',
	},
	am_adam: {
		name: 'Adam',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'F+',
	},
	am_echo: {
		name: 'Echo',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D',
	},
	am_eric: {
		name: 'Eric',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D',
	},
	am_fenrir: {
		name: 'Fenrir',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	am_liam: {
		name: 'Liam',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D',
	},
	am_michael: {
		name: 'Michael',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	am_onyx: {
		name: 'Onyx',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D',
	},
	am_puck: {
		name: 'Puck',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'C+',
	},
	am_santa: {
		name: 'Santa',
		language: 'en-us',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D-',
	},
	bf_emma: {
		name: 'Emma',
		language: 'en-gb',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'B-',
	},
	bf_isabella: {
		name: 'Isabella',
		language: 'en-gb',
		gender: 'Female',
		model: 'v1.0',
		overallGrade: 'C',
	},
	bm_george: {
		name: 'George',
		language: 'en-gb',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'C',
	},
	bm_lewis: {
		name: 'Lewis',
		language: 'en-gb',
		gender: 'Male',
		model: 'v1.0',
		overallGrade: 'D+',
	},
	bf_alice: {
		name: 'Alice',
		language: 'en-gb',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	bf_lily: {
		name: 'Lily',
		language: 'en-gb',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	bm_daniel: {
		name: 'Daniel',
		language: 'en-gb',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	bm_fable: {
		name: 'Fable',
		language: 'en-gb',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'C',
	},
	jf_alpha: {
		name: 'alpha',
		language: 'ja',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C+',
	},
	jf_gongitsune: {
		name: 'gongitsune',
		language: 'ja',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C',
	},
	jf_nezumi: {
		name: 'nezumi',
		language: 'ja',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C-',
	},
	jf_tebukuro: {
		name: 'tebukuro',
		language: 'ja',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C',
	},
	jm_kumo: {
		name: 'kumo',
		language: 'ja',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'C-',
	},
	zf_xiaobei: {
		name: 'xiaobei',
		language: 'zh',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	zf_xiaoni: {
		name: 'xiaoni',
		language: 'zh',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	zf_xiaoxiao: {
		name: 'xiaoxiao',
		language: 'zh',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	zf_xiaoyi: {
		name: 'xiaoyi',
		language: 'zh',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	zm_yunjian: {
		name: 'yunjian',
		language: 'zh',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	zm_yunxi: {
		name: 'yunxi',
		language: 'zh',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	zm_yunxia: {
		name: 'yunxia',
		language: 'zh',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	zm_yunyang: {
		name: 'yunyang',
		language: 'zh',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	ef_dora: {
		name: 'dora',
		language: 'es',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	em_alex: {
		name: 'alex',
		language: 'es',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	em_santa: {
		name: 'santa',
		language: 'es',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	ff_siwis: {
		name: 'siwis',
		language: 'fr-fr',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'B-',
	},
	hf_alpha: {
		name: 'alpha',
		language: 'hi',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C',
	},
	hf_beta: {
		name: 'beta',
		language: 'hi',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C',
	},
	hm_omega: {
		name: 'omega',
		language: 'hi',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'C',
	},
	hm_psi: {
		name: 'psi',
		language: 'hi',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'C',
	},
	if_sara: {
		name: 'sara',
		language: 'it',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'C',
	},
	im_nicola: {
		name: 'nicola',
		language: 'it',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'C',
	},
	pf_dora: {
		name: 'dora',
		language: 'pt-br',
		gender: 'Female',
		model: 'v1.0',
		traits: '🚺',
		overallGrade: 'D',
	},
	pm_alex: {
		name: 'alex',
		language: 'pt-br',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	pm_santa: {
		name: 'santa',
		language: 'pt-br',
		gender: 'Male',
		model: 'v1.0',
		traits: '🚹',
		overallGrade: 'D',
	},
	...V11_ZH_VOICES,
} as const satisfies Record<string, VoiceInfo>);

export type VoiceId = keyof typeof VOICES;

function getVoiceFileUrl(id: VoiceId): string {
	return `${getVoiceDataUrl(VOICES[id].model)}/${id}.bin`;
}

export async function isVoiceFileCached(id: VoiceId): Promise<boolean> {
	try {
		if (typeof caches === 'undefined') return false;
		const cache = await caches.open('kokoro-voices');
		const response = await cache.match(getVoiceFileUrl(id));
		return !!response;
	} catch {
		return false;
	}
}

async function getVoiceFile(id: VoiceId): Promise<ArrayBuffer> {
	const url = getVoiceFileUrl(id);

	let cache: Cache | undefined;
	try {
		cache = await caches.open('kokoro-voices');
		const cachedResponse = await cache.match(url);
		if (cachedResponse) {
			return await cachedResponse.arrayBuffer();
		}
	} catch (e) {
		console.warn('Unable to open cache', e);
	}

	// No cache, or cache failed to open. Fetch the file.
	const response = await fetch(url);
	const buffer = await response.arrayBuffer();

	if (cache) {
		try {
			// NOTE: We use `new Response(buffer, ...)` instead of `response.clone()` to handle LFS files
			await cache.put(
				url,
				new Response(buffer, {
					headers: response.headers,
				})
			);
		} catch (e) {
			console.warn('Unable to cache file', e);
		}
	}

	return buffer;
}

const VOICE_CACHE = new Map<VoiceId, Float32Array>();

export async function getVoiceData(voice: VoiceId): Promise<Float32Array> {
	const cached = VOICE_CACHE.get(voice);
	if (cached) {
		return cached;
	}

	const buffer = new Float32Array(await getVoiceFile(voice));
	VOICE_CACHE.set(voice, buffer);
	return buffer;
}
