import { vi } from 'vitest';

/**
 * Mock for $lib/logging/logger.
 * All log methods are vi.fn() spies that resolve immediately.
 */
export function createMockLogger() {
	return {
		info: vi.fn(async (_context: string, _message: string) => {}),
		error: vi.fn(async (_context: string, _message: string, _err?: unknown) => {}),
		warn: vi.fn(async (_context: string, _message: string) => {}),
		debug: vi.fn(async (_context: string, _message: string) => {}),
	};
}
