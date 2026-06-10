export const TTS_MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
export const TTS_CACHE_NAME = 'transformers-cache';
export const TTS_SAMPLE_RATE = 24000;
export const TTS_MAX_QUEUE_SIZE = 6;

export const TTS_MODEL_FILES = [
	'config.json',
	'tokenizer.json',
	'tokenizer_config.json',
	'special_tokens_map.json',
	'onnx/encoder_model.onnx',
	'onnx/decoder_model_merged.onnx',
	'onnx/encoder_model_quantized.onnx',
	'onnx/decoder_model_merged_quantized.onnx',
];
