import { env as transformersEnv, StyleTextToSpeech2Model, AutoTokenizer, Tensor, RawAudio } from '@huggingface/transformers';
import type { DataType, DeviceType, PreTrainedTokenizer, PretrainedModelOptions } from '@huggingface/transformers';
import { phonemize } from './phonemize';
import { TextSplitterStream } from './splitter';
import { getVoiceData, type VoiceLanguage, VOICES } from './voices';
import type { VoiceId } from './voices';

const STYLE_DIM = 256;
const SAMPLE_RATE = 24000;

export type ProgressCallback = NonNullable<PretrainedModelOptions['progress_callback']>;

export interface FromPretrainedOptions {
	/** The data type to use. Defaults to "fp32". */
	dtype?: DataType;
	/** The device to run the model on. */
	device?: DeviceType | null;
	/** A callback function that is called with progress information. */
	progressCallback?: ProgressCallback | null;
}

export interface GenerateOptions {
	/** The voice. Defaults to "af_heart". */
	voice?: VoiceId;
	/** The speaking speed. Defaults to 1. */
	speed?: number;
}

export interface StreamGenerateOptions extends GenerateOptions {
	/** The pattern to split the input text. If unset, the default sentence splitter will be used. */
	splitPattern?: RegExp | null;
}

export interface StreamChunk {
	text: string;
	phonemes: string;
	audio: RawAudio;
}

export class KokoroTTS {
	readonly model: StyleTextToSpeech2Model;
	readonly tokenizer: PreTrainedTokenizer;

	constructor(model: StyleTextToSpeech2Model, tokenizer: PreTrainedTokenizer) {
		this.model = model;
		this.tokenizer = tokenizer;
	}

	/**
	 * Load a KokoroTTS model from the Hugging Face Hub.
	 */
	static async fromPretrained(
		modelId: string,
		{ dtype = 'fp32', device = null, progressCallback = null }: FromPretrainedOptions = {}
	): Promise<KokoroTTS> {
		const modelPromise = StyleTextToSpeech2Model.from_pretrained(modelId, {
			progress_callback: progressCallback ?? undefined,
			dtype,
			device: device ?? undefined,
		});
		const tokenizerPromise = AutoTokenizer.from_pretrained(modelId, {
			progress_callback: progressCallback ?? undefined,
		});

		const [model, tokenizer] = await Promise.all([modelPromise, tokenizerPromise]);
		return new KokoroTTS(model as StyleTextToSpeech2Model, tokenizer);
	}

	get voices(): typeof VOICES {
		return VOICES;
	}

	listVoices(): void {
		console.table(VOICES);
	}

	private validateVoice(voice: string): VoiceLanguage {
		if (!Object.hasOwn(VOICES, voice)) {
			console.error(`Voice "${voice}" not found. Available voices:`);
			console.table(VOICES);
			throw new Error(`Voice "${voice}" not found. Should be one of: ${Object.keys(VOICES).join(', ')}.`);
		}
		return VOICES[voice as VoiceId].language;
	}

	/**
	 * Generate audio from text.
	 */
	async generate(text: string, { voice = 'af_heart', speed = 1 }: GenerateOptions = {}): Promise<RawAudio> {
		const language = this.validateVoice(voice);

		const phonemes = await phonemize(text, language);
		const { input_ids } = this.tokenizer(phonemes, {
			truncation: true,
		});

		return this.generateFromIds(input_ids as Tensor, { voice, speed });
	}

	/**
	 * Generate audio from input ids.
	 */
	async generateFromIds(inputIds: Tensor, { voice = 'af_heart', speed = 1 }: GenerateOptions = {}): Promise<RawAudio> {
		// Select voice style based on number of input tokens
		const numTokens = Math.min(Math.max((inputIds.dims.at(-1) ?? 0) - 2, 0), 509);

		// Load voice style
		const data = await getVoiceData(voice);
		const offset = numTokens * STYLE_DIM;
		const voiceData = data.slice(offset, offset + STYLE_DIM);

		// Prepare model inputs
		const inputs = {
			input_ids: inputIds,
			style: new Tensor('float32', voiceData, [1, STYLE_DIM]),
			speed: new Tensor('float32', [speed], [1]),
		};

		// Generate audio
		const { waveform } = (await this.model(inputs)) as { waveform: Tensor };
		return new RawAudio(waveform.data as Float32Array, SAMPLE_RATE);
	}

	/**
	 * Generate audio from text in a streaming fashion.
	 */
	async *stream(
		text: string | TextSplitterStream,
		{ voice = 'af_heart', speed = 1, splitPattern = null }: StreamGenerateOptions = {}
	): AsyncGenerator<StreamChunk, void, void> {
		const language = this.validateVoice(voice);

		let splitter: TextSplitterStream;
		if (text instanceof TextSplitterStream) {
			splitter = text;
		} else if (typeof text === 'string') {
			splitter = new TextSplitterStream();
			const chunks = splitPattern
				? text
						.split(splitPattern)
						.map((chunk) => chunk.trim())
						.filter((chunk) => chunk.length > 0)
				: [text];
			splitter.push(...chunks);
		} else {
			throw new Error('Invalid input type. Expected string or TextSplitterStream.');
		}
		for await (const sentence of splitter) {
			const phonemes = await phonemize(sentence, language);
			const { input_ids } = this.tokenizer(phonemes, {
				truncation: true,
			});

			// TODO: There may be some cases where - even with splitting - the text is too long.
			// In that case, we should split the text into smaller chunks and process them separately.
			// For now, we just truncate these exceptionally long chunks
			const audio = await this.generateFromIds(input_ids as Tensor, { voice, speed });
			yield { text: sentence, phonemes, audio };
		}
	}
}

export const env = {
	set cacheDir(value: string) {
		transformersEnv.cacheDir = value;
	},
	get cacheDir(): string {
		return transformersEnv.cacheDir;
	},
	set wasmPaths(value: NonNullable<typeof transformersEnv.backends.onnx.wasm>['wasmPaths']) {
		transformersEnv.backends.onnx.wasm!.wasmPaths = value;
	},
	get wasmPaths(): NonNullable<typeof transformersEnv.backends.onnx.wasm>['wasmPaths'] {
		return transformersEnv.backends.onnx.wasm!.wasmPaths;
	},
};

export { TextSplitterStream };
