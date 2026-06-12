import { TTS_SAMPLE_RATE } from './constants';

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'error';

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
	private loadCallbacks: LoadModelCallbacks | null = null;
	private modelLoaded = false;

	private generationId = 0;
	private currentPlaybackGenId = 0;

	private boundVisibilityHandler: (() => void) | null = null;

	playingMessageId: string | null = $state(null);
	playingState: PlaybackState = $state('idle');
	lastError: string | null = $state(null);

	async loadModel(callbacks: LoadModelCallbacks = {}): Promise<void> {
		this.loadCallbacks = callbacks;
		this.playingState = 'loading';
		this.lastError = null;

		this.ensureWorker();
		this.worker!.postMessage({ type: 'init_model' });
	}

	cancelLoad(): void {
		this.loadCallbacks = null;
		this.dispose();
	}

	get isModelLoaded(): boolean {
		return this.modelLoaded;
	}

	private recreateAudioContext(): void {
		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch {}
		}
		this.audioContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
	}

	private ensureAudioContext(): void {
		if (!this.audioContext || this.audioContext.state === 'closed') {
			this.audioContext = new AudioContext({ sampleRate: TTS_SAMPLE_RATE });
		}
	}

	private ensureWorker(): void {
		if (this.worker) return;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- URL is for Worker bundling, not reactive state
		this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

		this.worker.addEventListener('message', (e: MessageEvent) => {
			this.handleWorkerMessage(e.data);
		});

		this.worker.addEventListener('error', (e: ErrorEvent) => {
			console.error('TTS worker error:', e.message);
			this.lastError = e.message;
			this.playingState = 'error';
			this.fullReset();
		});
	}

	async play(text: string, messageId: string, voice: string, speed: number = 1): Promise<void> {
		this.generationId++;
		const genId = this.generationId;

		if (this.playingMessageId) {
			this.stop(false);
		}

		this.recreateAudioContext();

		this.playingMessageId = messageId;
		this.playingState = 'playing';
		this.lastError = null;
		this.audioQueue = [];
		this.isPlaying = false;
		this.processedChunks = 0;
		this.totalChunks = 0;
		this.currentPlaybackGenId = genId;

		this.setupVisibilityHandler();
		this.ensureWorker();
		this.worker!.postMessage({ type: 'generate', text, voice, speed, generationId: genId });
	}

	stop(incrementGenId = true): void {
		if (incrementGenId) {
			this.generationId++;
		}

		if (this.currentSource) {
			try {
				this.currentSource.stop();
			} catch {}
			try {
				this.currentSource.disconnect();
			} catch {}
			this.currentSource = null;
		}

		this.audioQueue = [];
		this.isPlaying = false;
		this.playingMessageId = null;
		this.playingState = 'idle';

		if (this.worker) {
			this.worker.postMessage({ type: 'stop' });
		}
	}

	private handleWorkerMessage(data: Record<string, unknown>): void {
		const status = data.status as string;

		if (status === 'loading_model_progress') {
			this.loadCallbacks?.onProgress?.(data.progress as number);
			return;
		}

		if (status === 'loading_model_ready') {
			this.modelLoaded = true;
			this.playingState = 'idle';
			this.loadCallbacks?.onReady?.();
			this.loadCallbacks = null;
			return;
		}

		if (status === 'model_status') {
			this.modelLoaded = data.loaded as boolean;
			return;
		}

		if (status === 'error' && this.loadCallbacks) {
			const error = data.error as string;
			this.lastError = error;
			this.playingState = 'error';
			this.loadCallbacks.onError?.(error);
			this.loadCallbacks = null;
			this.fullReset();
			return;
		}

		const msgGenId = data.generationId as number | undefined;
		if (msgGenId !== undefined && msgGenId !== this.generationId) {
			return;
		}

		if (status === 'chunk_count') {
			this.totalChunks = data.count as number;
			this.processedChunks = 0;
		}

		if (status === 'stream_audio_data') {
			this.queueAudio(data.audio as ArrayBuffer);
		}

		if (status === 'complete') {
			if (!this.isPlaying && this.audioQueue.length === 0 && this.processedChunks >= this.totalChunks && this.totalChunks > 0) {
				this.playingMessageId = null;
				this.playingState = 'idle';
			}
		}

		if (status === 'error') {
			this.lastError = data.error as string;
			this.playingState = 'error';
			this.resetPlayback();
			this.syncModelStatus();
		}
	}

	private resetPlayback(): void {
		this.generationId++;

		if (this.currentSource) {
			try {
				this.currentSource.stop();
			} catch {}
			try {
				this.currentSource.disconnect();
			} catch {}
			this.currentSource = null;
		}

		this.audioQueue = [];
		this.isPlaying = false;
		this.playingMessageId = null;
		this.playingState = 'idle';
	}

	private fullReset(): void {
		this.resetPlayback();

		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch {}
		}
		this.audioContext = null;

		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}

		this.modelLoaded = false;
	}

	private syncModelStatus(): void {
		if (this.worker) {
			this.worker.postMessage({ type: 'check_model' });
		}
	}

	private async queueAudio(audioData: ArrayBuffer): Promise<void> {
		if (!this.audioContext || this.audioContext.state === 'closed') {
			this.ensureAudioContext();
		}
		if (!this.audioContext) return;

		if (this.audioContext.state === 'suspended') {
			try {
				await this.audioContext.resume();
			} catch {
				return;
			}
		}

		const float32 = new Float32Array(audioData);
		const audioBuffer = this.audioContext.createBuffer(1, float32.length, TTS_SAMPLE_RATE);
		audioBuffer.getChannelData(0).set(float32);
		this.audioQueue.push(audioBuffer);
		this.playAudioQueue();
	}

	private async playAudioQueue(): Promise<void> {
		if (this.isPlaying || this.audioQueue.length === 0) return;

		const genId = this.currentPlaybackGenId;
		this.isPlaying = true;

		try {
			while (this.audioQueue.length > 0) {
				if (this.generationId !== genId) break;

				this.ensureAudioContext();
				if (!this.audioContext) break;

				if (this.audioContext.state === 'suspended') {
					try {
						await this.audioContext.resume();
					} catch {
						break;
					}
				}

				if (this.generationId !== genId) break;

				const source = this.audioContext.createBufferSource();
				this.currentSource = source;
				source.buffer = this.audioQueue.shift()!;
				source.connect(this.audioContext.destination);

				await new Promise<void>((resolve) => {
					source.onended = () => {
						this.currentSource = null;
						resolve();
					};
					source.start();
				});

				if (this.generationId === genId) {
					this.processedChunks++;
					if (this.worker) {
						this.worker.postMessage({ type: 'buffer_processed' });
					}
				}
			}
		} catch (error) {
			console.error('Error during TTS audio playback:', error);
			if (this.generationId === genId) {
				this.lastError = error instanceof Error ? error.message : String(error);
				this.playingState = 'error';
			}
		} finally {
			if (this.generationId === genId) {
				this.isPlaying = false;

				if (this.playingMessageId && this.processedChunks >= this.totalChunks && this.totalChunks > 0) {
					this.playingMessageId = null;
					this.playingState = 'idle';
				}
			}
		}
	}

	shutdownModel(): void {
		this.stop();

		if (this.worker) {
			this.worker.terminate();
			this.worker = null;
		}

		this.modelLoaded = false;

		if (this.audioContext && this.audioContext.state !== 'closed') {
			try {
				this.audioContext.close();
			} catch {}
			this.audioContext = null;
		}
	}

	private setupVisibilityHandler(): void {
		if (this.boundVisibilityHandler) return;

		this.boundVisibilityHandler = () => {
			if (document.visibilityState === 'hidden' && this.playingMessageId) {
				this.stop();
			}
		};
		document.addEventListener('visibilitychange', this.boundVisibilityHandler);
	}

	private removeVisibilityHandler(): void {
		if (this.boundVisibilityHandler) {
			document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
			this.boundVisibilityHandler = null;
		}
	}

	dispose(): void {
		this.removeVisibilityHandler();
		this.fullReset();
	}
}

export const ttsPlayer = new TTSPlayer();
