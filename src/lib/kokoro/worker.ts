import { KokoroTTS } from 'kokoro-js';
import { splitTextSmart } from './semantic-split';
import { TTS_MODEL_ID, TTS_MAX_QUEUE_SIZE } from './constants';

let tts: KokoroTTS | null = null;

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

let bufferQueueSize = 0;
let shouldStop = false;

ctx.addEventListener('message', async (e: MessageEvent) => {
	const { type, text, voice } = e.data;

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
		shouldStop = true;
		return;
	}

	if (type === 'buffer_processed') {
		bufferQueueSize = Math.max(0, bufferQueueSize - 1);
		return;
	}

	if (type === 'generate' && text) {
		shouldStop = false;

		if (!tts) {
			try {
				await ensureModel();
			} catch (error) {
				ctx.postMessage({ status: 'error', error: String(error) });
				return;
			}
		}

		const chunks = splitTextSmart(text, 300);
		ctx.postMessage({ status: 'chunk_count', count: chunks.length });

		try {
			for (const chunk of chunks) {
				if (shouldStop) {
					ctx.postMessage({ status: 'complete' });
					break;
				}

				while (bufferQueueSize >= TTS_MAX_QUEUE_SIZE && !shouldStop) {
					await new Promise((r) => setTimeout(r, 1000));
				}

				if (shouldStop) {
					ctx.postMessage({ status: 'complete' });
					break;
				}

				const audio = await tts!.generate(chunk, { voice });
				const ab = audio.audio.buffer;
				bufferQueueSize++;
				ctx.postMessage({ status: 'stream_audio_data', audio: ab, text: chunk }, [ab]);
			}

			if (!shouldStop) {
				ctx.postMessage({ status: 'complete' });
			}
		} catch (error) {
			ctx.postMessage({ status: 'error', error: String(error) });
		}
	}
});
