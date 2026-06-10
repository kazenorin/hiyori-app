import { TTS_CACHE_NAME, TTS_MODEL_ID } from './constants';

export async function isTTSModelCached(): Promise<boolean> {
	try {
		if (typeof caches === 'undefined') return false;
		const cache = await caches.open(TTS_CACHE_NAME);
		const url = `https://huggingface.co/${TTS_MODEL_ID}/resolve/main/config.json`;
		const response = await cache.match(url);
		return !!response;
	} catch {
		return false;
	}
}
