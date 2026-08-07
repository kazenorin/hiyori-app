export type TTSModelKey = 'v1.0' | 'v1.1-zh';

export interface TTSModelInfo {
	id: string;
	label: string;
}

export const TTS_MODELS: Record<TTSModelKey, TTSModelInfo> = {
	'v1.0': { id: 'onnx-community/Kokoro-82M-v1.0-ONNX', label: 'Kokoro v1.0' },
	'v1.1-zh': { id: 'onnx-community/Kokoro-82M-v1.1-zh-ONNX', label: 'Kokoro v1.1 (zh)' },
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
