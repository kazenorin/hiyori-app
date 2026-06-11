import { TTS_SAMPLE_RATE } from './constants';

export interface LoadModelCallbacks {
	onProgress?: (progress: number) => void;
	onReady?: () => void;
	onError?: (error: string) => void;
}

export class TTSPlayer {
	private audioContext: AudioContext | null = null;
	private audioQueue: AudioBuffer[] = [];
	private isPlaying = false;
	private currentSource: AudioBufferSourceNode | null = null;
	private worker: Worker | null = null;
	private totalChunks = 0;
	private processedChunks = 0;
	private stopped = false;
	private loadCallbacks: LoadModelCallbacks | null = null;
	private modelLoaded = false;

	playingMessageId: string | null = $state(null);

	async loadModel(callbacks: LoadModelCallbacks = {}): Promise<void> {
		this.loadCallbacks = callbacks;

		if (!this.worker) {
			this.initWorker();
		}

		this.worker!.postMessage({ type: 'init_model' });
	}

	cancelLoad(): void {
		this.loadCallbacks = null;
		this.dispose();
	}

	get isModelLoaded(): boolean {
		return this.modelLoaded;
	}

	private ensureAudioContext(): void {
		if (!this.audioContext || this.audioContext.state === 'closed') {
			this.audioContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
		}
	}

	async play(text: string, messageId: string, voice: string, speed: number = 1): Promise<void> {
		if (this.playingMessageId) {
			this.stop();
		}

		this.ensureAudioContext();

		this.playingMessageId = messageId;
		this.stopped = false;
		this.audioQueue = [];
		this.isPlaying = false;
		this.processedChunks = 0;
		this.totalChunks = 0;

		if (!this.worker) {
			this.initWorker();
		}

		this.worker!.postMessage({ type: 'generate', text, voice, speed });
	}

	stop(): void {
		this.stopped = true;

		if (this.currentSource) {
			try {
				this.currentSource.stop();
			} catch {
				// source may have already stopped
			}
			this.currentSource = null;
		}

		this.audioQueue = [];
		this.isPlaying = false;
		this.playingMessageId = null;

		if (this.worker) {
			this.worker.postMessage({ type: 'stop' });
		}
	}

	private initWorker(): void {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- URL is for Worker bundling, not reactive state
		this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

		this.worker.addEventListener('message', (e: MessageEvent) => {
			this.handleWorkerMessage(e.data);
		});

		this.worker.addEventListener('error', (e: ErrorEvent) => {
			console.error('TTS worker error:', e.message);
			this.cleanup();
		});
	}

	private handleWorkerMessage(data: Record<string, unknown>): void {
		const status = data.status as string;

		if (status === 'loading_model_progress') {
			this.loadCallbacks?.onProgress?.(data.progress as number);
			return;
		}

		if (status === 'loading_model_ready') {
			this.modelLoaded = true;
			this.loadCallbacks?.onReady?.();
			this.loadCallbacks = null;
			return;
		}

		if (status === 'error' && this.loadCallbacks) {
			this.loadCallbacks.onError?.(data.error as string);
			this.loadCallbacks = null;
			this.cleanup();
			return;
		}

		if (this.stopped) return;

		if (status === 'chunk_count') {
			this.totalChunks = data.count as number;
			this.processedChunks = 0;
		}

		if (status === 'stream_audio_data') {
			const audioData = data.audio as ArrayBuffer;
			this.queueAudio(audioData);
		}

		if (status === 'complete') {
			if (!this.isPlaying && this.audioQueue.length === 0 && this.processedChunks >= this.totalChunks && this.totalChunks > 0) {
				this.playingMessageId = null;
			}
		}

		if (status === 'error') {
			console.error('TTS generation error:', data.error);
			this.cleanup();
		}
	}

	private cleanup(): void {
		this.stopped = true;
		this.modelLoaded = false;
		this.audioQueue = [];
		this.isPlaying = false;
		this.playingMessageId = null;
		this.currentSource = null;
	}

	private async queueAudio(audioData: ArrayBuffer): Promise<void> {
		if (this.stopped) return;

		if (this.audioContext!.state === 'suspended') {
			try {
				await this.audioContext!.resume();
			} catch {
				return;
			}
		}

		const float32 = new Float32Array(audioData);
		const audioBuffer = this.audioContext!.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
		audioBuffer.getChannelData(0).set(float32);
		this.audioQueue.push(audioBuffer);
		this.playAudioQueue();
	}

	private async playAudioQueue(): Promise<void> {
		if (this.isPlaying || this.audioQueue.length === 0) return;

		this.isPlaying = true;
		try {
			while (this.audioQueue.length > 0) {
				if (this.stopped) break;

				if (this.audioContext!.state === 'suspended') {
					try {
						await this.audioContext!.resume();
					} catch {
						break;
					}
				}

				const source = this.audioContext!.createBufferSource();
				this.currentSource = source;
				source.buffer = this.audioQueue.shift()!;
				source.connect(this.audioContext!.destination);

				await new Promise<void>((resolve) => {
					source.onended = () => {
						this.currentSource = null;
						resolve();
					};
					source.start();
				});

				this.processedChunks++;
				if (this.worker) {
					this.worker.postMessage({ type: 'buffer_processed' });
				}
			}
		} catch (error) {
			console.error('Error during TTS audio playback:', error);
		} finally {
			this.isPlaying = false;

			if (!this.stopped && this.playingMessageId && this.processedChunks >= this.totalChunks && this.totalChunks > 0) {
				this.playingMessageId = null;
			}
		}
	}

	dispose(): void {
		this.stop();
		this.modelLoaded = false;
		if (this.audioContext && this.audioContext.state !== 'closed') {
			this.audioContext.close();
			this.audioContext = null;
		}
		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}
	}
}

export const ttsPlayer = new TTSPlayer();
