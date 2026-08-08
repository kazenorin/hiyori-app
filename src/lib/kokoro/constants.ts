export type TTSModelKey = 'v1.0';

export interface TTSModelInfo {
	id: string;
	label: string;
}

export const TTS_MODELS: Record<TTSModelKey, TTSModelInfo> = {
	'v1.0': { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', label: 'Kokoro v1.0' },
};

/**
 * Preview passages keyed by locale prefix, independent of the global i18n locale.
 * The voice being previewed speaks the language of its card's locale, so playback
 * uses the passage for that locale rather than the currently selected UI language.
 */
export const TTS_PREVIEW_TEXT: Record<string, string> = {
	en: 'The Tortoise and the Hare\n\nA Hare was making fun of the Tortoise one day for being so slow. "Do you ever get anywhere?" he asked with a mocking laugh. "Yes," replied the Tortoise, "and I get there sooner than you think. I\'ll run you a race and prove it." The Hare was much amused at the idea of running a race with the Tortoise, but for the fun of the thing he agreed. So the Fox, who had consented to act as judge, marked the distance and started them off. The Hare was soon far out of sight, and to make the Tortoise feel very deeply how ridiculous it was for him to try a race with a Hare, he lay down beside the road to have a nap. The Tortoise meanwhile kept going slowly but steadily, and, after a time, passed the place where the Hare was sleeping. When the Hare awoke from his nap, he saw the Tortoise was near the winning-post, and could not run up in time to save the race.',
	'zh-Hant-HK':
		'龜兔賽跑\n\n有一天，兔子嘲笑烏龜爬得太慢。「你真的能去到任何地方嗎？」牠嘲笑道。「能啊，」烏龜回答，「而且我會比你想像中更快到達。我跟你賽跑證明給你看。」兔子覺得跟烏龜賽跑很有趣，但為了湊熱鬧，牠答應了。於是狐狸當裁判，量好距離，讓牠們出發。兔子很快跑得無影無蹤；為了讓烏龜明白跟牠賽跑有多麼不自量力，兔子便在路旁躺下打盹。龜卻一直不慌不忙、穩步向前，過了一段時間，牠經過了兔子睡覺的地方。兔子醒來時，看見烏龜已接近終點，想追也來不及了。',
};

export const TTS_CACHE_NAME = 'transformers-cache';
export const TTS_SAMPLE_RATE = 24000;
export const TTS_MAX_QUEUE_SIZE = 6;
export const TTS_BACKPRESSURE_TIMEOUT_SECONDS = 30;
export const TTS_SPEED_MIN = 0.5;
export const TTS_SPEED_MAX = 2;
export const TTS_SPEED_STEP = 0.1;

export function getVoiceDataUrl(model: TTSModelKey): string {
	return `https://huggingface.co/${TTS_MODELS[model].id}/resolve/main/voices`;
}
