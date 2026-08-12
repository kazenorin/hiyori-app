import { describe, it, expect } from 'vitest';
import { APICallError } from 'ai';
import { getErrorMessage, getUserFacingErrorMessage, isNetworkError } from '$lib/utils/error-handling';
import { ERR_PROVIDER_UNREACHABLE } from '$lib/definitions/error-messages';

describe('isNetworkError', () => {
	it('detects browser fetch failures', () => {
		expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
		expect(isNetworkError(new TypeError('NetworkError when attempting to fetch resource.'))).toBe(true);
	});

	it('detects connection failures nested in the cause chain', () => {
		const err = new Error('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:11434') });
		expect(isNetworkError(err)).toBe(true);
	});

	it('detects APICallError wrapping a network cause', () => {
		const err = new APICallError({
			message: 'fetch failed',
			url: 'http://localhost/v1/chat',
			requestBodyValues: {},
			cause: new Error('getaddrinfo ENOTFOUND api.example.com'),
		});
		expect(isNetworkError(err)).toBe(true);
	});

	it('detects desktop runtime connection errors', () => {
		expect(isNetworkError(new Error('error sending request for url (http://localhost:11434/api/chat): connection refused'))).toBe(true);
		expect(isNetworkError(new Error('Could not resolve host: api.example.com'))).toBe(true);
		expect(isNetworkError(new Error('operation timed out (ETIMEDOUT)'))).toBe(true);
	});

	it('does not flag application-level errors', () => {
		expect(isNetworkError(new Error('Authentication failed. Please check your API key in Settings.'))).toBe(false);
		expect(
			isNetworkError(
				new APICallError({ message: 'model not found', url: 'http://localhost/v1/chat', requestBodyValues: {}, statusCode: 404 })
			)
		).toBe(false);
		expect(isNetworkError(new Error('empty response from stream'))).toBe(false);
		expect(isNetworkError('some string error')).toBe(false);
		expect(isNetworkError(null)).toBe(false);
	});
});

describe('getUserFacingErrorMessage', () => {
	it('maps network errors to provider-unreachable guidance', () => {
		const err = new Error('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:11434') });
		expect(getUserFacingErrorMessage(err)).toBe(ERR_PROVIDER_UNREACHABLE);
	});

	it('returns the plain message for non-network errors', () => {
		expect(getUserFacingErrorMessage(new Error('boom'))).toBe('boom');
	});

	it('falls back for non-error values', () => {
		expect(getUserFacingErrorMessage('weird')).toBe('An unexpected error occurred.');
	});
});

describe('getErrorMessage', () => {
	it('maps network errors to provider-unreachable guidance even when wrapped in APICallError', () => {
		const err = new APICallError({
			message: 'fetch failed',
			url: 'http://localhost/v1/chat',
			requestBodyValues: {},
			cause: new TypeError('Failed to fetch'),
		});
		expect(getErrorMessage(err)).toBe(ERR_PROVIDER_UNREACHABLE);
	});

	it('keeps technical formatting for non-network API errors', () => {
		const err = new APICallError({
			message: 'model not found',
			url: 'http://localhost/v1/chat',
			requestBodyValues: {},
			statusCode: 404,
			responseBody: '{"error":"not found"}',
		});
		expect(getErrorMessage(err)).toContain('[APICallError]');
		expect(getErrorMessage(err)).toContain('model not found');
	});
});
