import { KokoroTTS } from 'kokoro-js';
import { splitTextSmart } from './semantic-split';
import { TTS_MODEL_ID, TTS_MAX_QUEUE_SIZE, TTS_BACKPRESSURE_TIMEOUT_SECONDS } from './constants';

let tts: KokoroTTS | null = null;
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

async function ensureModel(): Promise<void> {
	if (tts) return;

	const device = await detectDevice();
	ctx.postMessage({ status: 'loading_model_start', device });

	tts = await KokoroTTS.from_pretrained(TTS_MODEL_ID, {
		dtype: device === 'wasm' ? 'q8' : 'fp32',
		device,
		progress_callback: (progress: { status?: string; progress?: number; file?: string }) => {
			ctx.postMessage({
				status: 'loading_model_progress',
				progress: progress.progress ?? 0,
				file: progress.file ?? '',
			});
		},
	});

	ctx.postMessage({ status: 'loading_model_ready', voices: tts.voices });
}

function isStopped(genId: number): boolean {
	return activeGenerationId !== genId;
}

ctx.addEventListener('message', async (e: MessageEvent) => {
	const { type, text, voice, speed, generationId } = e.data;

	if (type === 'init_model') {
		try {
			await ensureModel();
		} catch (error) {
			ctx.postMessage({ status: 'error', error: String(error) });
		}
		return;
	}

	if (type === 'check_model') {
		ctx.postMessage({ status: 'model_status', loaded: !!tts });
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

		if (!tts) {
			try {
				await ensureModel();
			} catch (error) {
				ctx.postMessage({ status: 'error', error: String(error), generationId: currentGenId });
				return;
			}
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
				const ab = audio.audio.buffer;
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
