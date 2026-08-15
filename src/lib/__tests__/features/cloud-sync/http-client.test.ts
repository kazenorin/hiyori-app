import { describe, it, expect, vi } from 'vitest';
import { withRetry } from '$lib/features/cloud-sync/http-client';

describe('withRetry', () => {
	it('returns the first successful result without retrying', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	// WHY: transient network failures must not abort a multi-minute sync —
	// a sync that fails on one flaky request loses the user's push window.
	it('retries on failure and succeeds when a later attempt passes', async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue('ok');
		await expect(withRetry(fn, { attempts: 3, baseDelayMs: 1 })).resolves.toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('throws the last error after exhausting attempts', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('still failing'));
		await expect(withRetry(fn, { attempts: 2, baseDelayMs: 1 })).rejects.toThrow('still failing');
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
