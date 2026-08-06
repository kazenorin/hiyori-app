export type VoiceQuality = 'A' | 'A-' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F+';
export type VoiceLanguage = 'en-us' | 'en-gb';
export type VoiceGender = 'Female' | 'Male';

export interface VoiceInfo {
	name: string;
	language: VoiceLanguage;
	gender: VoiceGender;
	traits?: string;
	targetQuality: VoiceQuality;
	overallGrade: VoiceQuality;
}

export const VOICES = Object.freeze({
	af_heart: {
		name: 'Heart',
		language: 'en-us',
		gender: 'Female',
		traits: '❤️',
		targetQuality: 'A',
		overallGrade: 'A',
	},
	af_alloy: {
		name: 'Alloy',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C',
	},
	af_aoede: {
		name: 'Aoede',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	af_bella: {
		name: 'Bella',
		language: 'en-us',
		gender: 'Female',
		traits: '🔥',
		targetQuality: 'A',
		overallGrade: 'A-',
	},
	af_jessica: {
		name: 'Jessica',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	af_kore: {
		name: 'Kore',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	af_nicole: {
		name: 'Nicole',
		language: 'en-us',
		gender: 'Female',
		traits: '🎧',
		targetQuality: 'B',
		overallGrade: 'B-',
	},
	af_nova: {
		name: 'Nova',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C',
	},
	af_river: {
		name: 'River',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	af_sarah: {
		name: 'Sarah',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	af_sky: {
		name: 'Sky',
		language: 'en-us',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C-',
	},
	am_adam: {
		name: 'Adam',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'D',
		overallGrade: 'F+',
	},
	am_echo: {
		name: 'Echo',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	am_eric: {
		name: 'Eric',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	am_fenrir: {
		name: 'Fenrir',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	am_liam: {
		name: 'Liam',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	am_michael: {
		name: 'Michael',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	am_onyx: {
		name: 'Onyx',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	am_puck: {
		name: 'Puck',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'B',
		overallGrade: 'C+',
	},
	am_santa: {
		name: 'Santa',
		language: 'en-us',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D-',
	},
	bf_emma: {
		name: 'Emma',
		language: 'en-gb',
		gender: 'Female',
		traits: '🚺',
		targetQuality: 'B',
		overallGrade: 'B-',
	},
	bf_isabella: {
		name: 'Isabella',
		language: 'en-gb',
		gender: 'Female',
		targetQuality: 'B',
		overallGrade: 'C',
	},
	bm_george: {
		name: 'George',
		language: 'en-gb',
		gender: 'Male',
		targetQuality: 'B',
		overallGrade: 'C',
	},
	bm_lewis: {
		name: 'Lewis',
		language: 'en-gb',
		gender: 'Male',
		targetQuality: 'C',
		overallGrade: 'D+',
	},
	bf_alice: {
		name: 'Alice',
		language: 'en-gb',
		gender: 'Female',
		traits: '🚺',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	bf_lily: {
		name: 'Lily',
		language: 'en-gb',
		gender: 'Female',
		traits: '🚺',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	bm_daniel: {
		name: 'Daniel',
		language: 'en-gb',
		gender: 'Male',
		traits: '🚹',
		targetQuality: 'C',
		overallGrade: 'D',
	},
	bm_fable: {
		name: 'Fable',
		language: 'en-gb',
		gender: 'Male',
		traits: '🚹',
		targetQuality: 'B',
		overallGrade: 'C',
	},

	// TODO: Add support for other languages:
	// jf_alpha, jf_gongitsune, jf_nezumi, jf_tebukuro, jm_kumo (ja)
	// zf_xiaobei, zf_xiaoni, zf_xiaoxiao, zf_xiaoyi, zm_yunjian, zm_yunxi, zm_yunxia, zm_yunyang (zh)
	// ef_dora, em_alex, em_santa, ff_siwis (es)
	// hf_alpha, hf_beta, hm_omega, hm_psi (hi)
	// if_sara, im_nicola (it)
	// pf_dora, pm_alex, pm_santa (pt-br)
} as const satisfies Record<string, VoiceInfo>);

export type VoiceId = keyof typeof VOICES;

/**
 * The base URL for fetching voice data files.
 */
let voiceDataUrl = 'https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/main/voices';

/**
 * Retrieves the current voice data URL.
 */
export function getVoiceDataUrl(): string {
	return voiceDataUrl;
}

/**
 * Sets a new voice data URL.
 * @throws Will throw an error if the URL is not a valid non-empty string.
 */
export function setVoiceDataUrl(url: string): void {
	if (typeof url === 'string' && url.trim() !== '') {
		voiceDataUrl = url;
	} else {
		throw new Error('Invalid URL');
	}
}

async function getVoiceFile(id: VoiceId): Promise<ArrayBuffer> {
	const url = `${voiceDataUrl}/${id}.bin`;

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
