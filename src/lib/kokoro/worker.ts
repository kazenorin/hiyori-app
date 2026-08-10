import { KokoroTTS } from './kokoro-hiyori';
import { splitTextSmart } from './semantic-split';
import { TTS_MODELS, TTS_MAX_QUEUE_SIZE, TTS_BACKPRESSURE_TIMEOUT_SECONDS, type TTSModelKey } from './constants';
import { VOICES, type VoiceId } from './kokoro-hiyori/voices';

let tts: KokoroTTS | null = null;
let loadedModelKey: TTSModelKey | null = null;
let bufferQueueSize = 0;
let activeGenerationId = 0;
const STOPPED_SENTINEL = -1;

const ctx = self as unknown as Worker;

async function detectDevice(): Promise<'webgpu' | 'wasm'> {
	try {
		const adapter = await navigator.gpu?.requestAdapter();
		return adapter ? 'webgpu' : 'wasm';
	} catch {
		return 'wasm';
	}
}

async function ensureModel(modelKey: TTSModelKey): Promise<void> {
	if (tts && loadedModelKey === modelKey) return;

	const device = await detectDevice();
	ctx.postMessage({ status: 'loading_model_start', device, modelKey });

	tts = await KokoroTTS.fromPretrained(TTS_MODELS[modelKey].id, {
		dtype: device === 'wasm' ? 'q8' : 'fp32',
		device,
		progressCallback: (progress) => {
			ctx.postMessage({
				status: 'loading_model_progress',
				progress: 'progress' in progress ? progress.progress : 0,
				file: 'file' in progress ? progress.file : '',
				modelKey,
			});
		},
	});
	loadedModelKey = modelKey;

	ctx.postMessage({ status: 'loading_model_ready', voices: tts.voices, modelKey });
}

function modelKeyForVoice(voice: string): TTSModelKey {
	return VOICES[voice as VoiceId]?.model ?? 'v1.0';
}

function isStopped(genId: number): boolean {
	return activeGenerationId !== genId;
}

ctx.addEventListener('message', async (e: MessageEvent) => {
	const { type, text, voice, speed, generationId, modelKey } = e.data;

	if (type === 'init_model') {
		try {
			await ensureModel((modelKey as TTSModelKey) ?? 'v1.0');
		} catch (error) {
			ctx.postMessage({ status: 'error', error: String(error) });
		}
		return;
	}

	if (type === 'check_model') {
		ctx.postMessage({ status: 'model_status', loaded: !!tts, modelKey: loadedModelKey });
		return;
	}

	if (type === 'stop') {
		bufferQueueSize = 0;
		activeGenerationId = STOPPED_SENTINEL;
		return;
	}

	if (type === 'buffer_processed') {
		bufferQueueSize = Math.max(0, bufferQueueSize - 1);
		return;
	}

	if (type === 'generate' && text) {
		const currentGenId = (generationId as number) ?? 0;
		activeGenerationId = currentGenId;
		bufferQueueSize = 0;

		try {
			await ensureModel(modelKeyForVoice(voice));
		} catch (error) {
			ctx.postMessage({ status: 'error', error: String(error), generationId: currentGenId });
			return;
		}

		const chunks = splitTextSmart(text, 300);
		ctx.postMessage({ status: 'chunk_count', count: chunks.length, generationId: currentGenId });

		try {
			for (const chunk of chunks) {
				if (isStopped(currentGenId)) {
					ctx.postMessage({ status: 'complete', generationId: currentGenId });
					break;
				}

				let waitTicks = 0;
				while (bufferQueueSize >= TTS_MAX_QUEUE_SIZE && !isStopped(currentGenId)) {
					if (waitTicks++ >= TTS_BACKPRESSURE_TIMEOUT_SECONDS) {
						ctx.postMessage({ status: 'error', error: 'Backpressure timeout', generationId: currentGenId });
						return;
					}
					await new Promise((r) => setTimeout(r, 1000));
				}

				if (isStopped(currentGenId)) {
					ctx.postMessage({ status: 'complete', generationId: currentGenId });
					break;
				}

				const audio = await tts!.generate(chunk, { voice, speed: speed ?? 1 });
				const samples = Array.isArray(audio.audio) ? audio.audio[0] : audio.audio;
				const ab = samples.buffer;
				bufferQueueSize++;
				ctx.postMessage({ status: 'stream_audio_data', audio: ab, text: chunk, generationId: currentGenId }, [ab]);
			}

			if (!isStopped(currentGenId)) {
				ctx.postMessage({ status: 'complete', generationId: currentGenId });
			}
		} catch (error) {
			ctx.postMessage({ status: 'error', error: String(error), generationId: currentGenId });
		}
	}
});
