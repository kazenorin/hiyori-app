import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toError, sleep, withRetry, isAuthError, validateFileSize, MAX_FILE_SIZE } from '$lib/utils/async';

describe('async utilities', () => {
	describe('toError', () => {
		it('returns Error instance as-is', () => {
			const error = new Error('Test error');
			expect(toError(error)).toBe(error);
		});

		it('wraps string in Error', () => {
			const result = toError('String error');
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe('String error');
		});

		it('wraps number in Error', () => {
			const result = toError(42);
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe('42');
		});

		it('wraps null in Error', () => {
			const result = toError(null);
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe('null');
		});

		it('wraps undefined in Error', () => {
			const result = toError(undefined);
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe('undefined');
		});

		it('wraps object in Error', () => {
			const result = toError({ key: 'value' });
			expect(result).toBeInstanceOf(Error);
			expect(result.message).toBe('[object Object]');
		});
	});

	describe('sleep', () => {
		it('resolves after specified milliseconds', async () => {
			const start = Date.now();
			await sleep(50);
			const elapsed = Date.now() - start;
			expect(elapsed).toBeGreaterThanOrEqual(45); // Allow small timing variance
		});

		it('resolves immediately with 0ms', async () => {
			const start = Date.now();
			await sleep(0);
			const elapsed = Date.now() - start;
			expect(elapsed).toBeLessThan(10);
		});
	});

	describe('withRetry', () => {
		beforeEach(() => {
			vi.clearAllMocks();
		});

		it('returns result on first successful attempt', async () => {
			const fn = vi.fn().mockResolvedValue('success');
			const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10 });

			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('retries on failure and returns result', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('Attempt 1'))
				.mockRejectedValueOnce(new Error('Attempt 2'))
				.mockResolvedValue('success');

			const result = await withRetry(fn, { maxAttempts: 3, backoffMs: 10 });

			expect(result).toBe('success');
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('throws last error after max attempts', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Persistent failure'));

			await expect(
				withRetry(fn, { maxAttempts: 3, backoffMs: 10 })
			).rejects.toThrow('Persistent failure');

			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('calls onRetry callback between attempts', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('First'))
				.mockResolvedValue('success');
			const onRetry = vi.fn();

			await withRetry(fn, { maxAttempts: 3, backoffMs: 10, onRetry });

			expect(onRetry).toHaveBeenCalledTimes(1);
			expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
			expect(onRetry.mock.calls[0][1].message).toBe('First');
		});

		it('respects shouldRetry predicate', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Non-retryable'));
			const shouldRetry = vi.fn().mockReturnValue(false);

			await expect(
				withRetry(fn, { maxAttempts: 3, backoffMs: 10, shouldRetry })
			).rejects.toThrow('Non-retryable');

			expect(fn).toHaveBeenCalledTimes(1); // No retries
			expect(shouldRetry).toHaveBeenCalledTimes(1);
		});

		it('retries when shouldRetry returns true', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('Retryable'))
				.mockResolvedValue('success');
			const shouldRetry = vi.fn().mockReturnValue(true);

			await withRetry(fn, { maxAttempts: 3, backoffMs: 10, shouldRetry });

			expect(fn).toHaveBeenCalledTimes(2);
			expect(shouldRetry).toHaveBeenCalledTimes(1);
		});

		it('increases delay with each retry', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce(new Error('1'))
				.mockRejectedValueOnce(new Error('2'))
				.mockResolvedValue('success');

			const start = Date.now();
			await withRetry(fn, { maxAttempts: 3, backoffMs: 50 });
			const elapsed = Date.now() - start;

			// First retry: 50ms, Second retry: 100ms = ~150ms total
			expect(elapsed).toBeGreaterThanOrEqual(140);
			expect(fn).toHaveBeenCalledTimes(3);
		});

		it('handles non-Error rejections', async () => {
			const fn = vi.fn()
				.mockRejectedValueOnce('string error')
				.mockResolvedValue('success');

			const onRetry = vi.fn();
			await withRetry(fn, { maxAttempts: 2, backoffMs: 10, onRetry });

			expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
			expect(onRetry.mock.calls[0][1].message).toBe('string error');
		});

		it('works with 1 max attempt', async () => {
			const fn = vi.fn().mockRejectedValue(new Error('Fail'));

			await expect(
				withRetry(fn, { maxAttempts: 1, backoffMs: 10 })
			).rejects.toThrow('Fail');

			expect(fn).toHaveBeenCalledTimes(1);
		});

		it('handles undefined rejection gracefully', async () => {
			const fn = vi.fn().mockRejectedValue(undefined);

			await expect(
				withRetry(fn, { maxAttempts: 1, backoffMs: 10 })
			).rejects.toThrow('undefined');
		});
	});

	describe('isAuthError', () => {
		it('detects 401 in message', () => {
			expect(isAuthError(new Error('401 Unauthorized'))).toBe(true);
		});

		it('detects 403 in message', () => {
			expect(isAuthError(new Error('403 Forbidden'))).toBe(true);
		});

		it('detects "unauthorized" (case insensitive)', () => {
			expect(isAuthError(new Error('Request was unauthorized'))).toBe(true);
			expect(isAuthError(new Error('UNAUTHORIZED'))).toBe(true);
		});

		it('detects "forbidden" (case insensitive)', () => {
			expect(isAuthError(new Error('Access forbidden'))).toBe(true);
			expect(isAuthError(new Error('FORBIDDEN'))).toBe(true);
		});

		it('returns false for non-auth errors', () => {
			expect(isAuthError(new Error('Network error'))).toBe(false);
			expect(isAuthError(new Error('Timeout'))).toBe(false);
			expect(isAuthError(new Error('500 Internal Server Error'))).toBe(false);
		});
	});

	describe('validateFileSize', () => {
		it('accepts file at exact max size', () => {
			const file = { size: MAX_FILE_SIZE, name: 'test.txt' } as File;
			expect(() => validateFileSize(file)).not.toThrow();
		});

		it('accepts file under max size', () => {
			const file = { size: MAX_FILE_SIZE - 1, name: 'test.txt' } as File;
			expect(() => validateFileSize(file)).not.toThrow();
		});

		it('throws for file over max size', () => {
			const file = { size: MAX_FILE_SIZE + 1, name: 'huge.bin' } as File;
			expect(() => validateFileSize(file)).toThrow('huge.bin');
			expect(() => validateFileSize(file)).toThrow('50MB');
		});

		it('includes file size in error message', () => {
			const file = { size: 100 * 1024 * 1024, name: 'big.pdf' } as File; // 100MB
			expect(() => validateFileSize(file)).toThrow('100.0MB');
		});
	});
});
