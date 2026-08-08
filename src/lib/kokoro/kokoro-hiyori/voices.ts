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
