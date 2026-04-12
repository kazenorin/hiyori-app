import {executeStream, type StreamResultMetadata} from "./streaming";
import {getMainProviderConfig} from "../stores/settings.svelte";
import {createStreamAccumulator, type StreamState} from "./chat-callbacks";
import {createModel} from "./provider";

export interface MessageMetadata {
    model: string;
    finishReason: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    durationMs: number;
}

/**
 * Core streaming helper for chat responses.
 * Handles streaming, metadata capture, persistence, and error handling.
 * Callers provide the message history and state setup.
 */
export async function streamChatResponse(
    systemPrompt: string,
    history: { role: "user" | "assistant"; content: string }[],
    abortSignal: AbortSignal,
    onStateUpdate: (state: StreamState) => void,
): Promise<MessageMetadata> {
    const config = getMainProviderConfig();
    if (!config) {
        throw new Error('No main provider configured. Please set one in Settings.');
    }
    const model = createModel(config);

    // Create stream accumulator with parser chain integrated
    const accumulator = createStreamAccumulator(onStateUpdate);

    await executeStream(
        {
            model,
            messages: history,
            systemPrompt,
            abortSignal: abortSignal,
            providerOptions: {
                openai: {
                    reasoningEffort: 'medium',
                    reasoningSummary: 'detailed'
                }
            }
        },
        accumulator.callbacks
    );

    // Update message with accumulated content and final metadata
    const resultMetadata = await accumulator.resultMetadata;
    return buildMetadata(resultMetadata)
}

function buildMetadata(result: StreamResultMetadata): MessageMetadata {
    const config = getMainProviderConfig();
    return {
        model: config?.model ?? 'unknown',
        finishReason: result.finishReason,
        promptTokens: result.usage.inputTokens,
        completionTokens: result.usage.outputTokens,
        totalTokens: result.usage.totalTokens,
        durationMs: result.durationMs
    };
}