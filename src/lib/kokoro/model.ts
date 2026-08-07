import { TTS_CACHE_NAME, TTS_MODELS, type TTSModelKey } from './constants';

export async function isModelCached(model: TTSModelKey): Promise<boolean> {
	try {
		if (typeof caches === 'undefined') return false;
		const cache = await caches.open(TTS_CACHE_NAME);
		const url = `https://huggingface.co/${TTS_MODELS[model].id}/resolve/main/config.json`;
		const response = await cache.match(url);
		return !!response;
	} catch {
		return false;
	}
}
