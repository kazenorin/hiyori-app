import { TTS_CACHE_NAME, TTS_MODEL_ID, TTS_MODEL_FILES } from './constants';

export async function isTTSModelCached(): Promise<boolean> {
	try {
		if (typeof caches === 'undefined') return false;
		const cache = await caches.open(TTS_CACHE_NAME);
		for (const file of TTS_MODEL_FILES) {
			const url = `https://huggingface.co/${TTS_MODEL_ID}/resolve/main/${file}`;
			const response = await cache.match(url);
			if (!response) return false;
		}
		return true;
	} catch {
		return false;
	}
}
