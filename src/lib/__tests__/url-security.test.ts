import { describe, it, expect } from 'vitest';
import { isLocalOrLanHost, getUrlWarnings } from '$lib/utils/url-security';

describe('isLocalOrLanHost', () => {
	it('classifies localhost and loopback as local', () => {
		expect(isLocalOrLanHost('localhost')).toBe(true);
		expect(isLocalOrLanHost('127.0.0.1')).toBe(true);
		expect(isLocalOrLanHost('::1')).toBe(true);
	});

	it('classifies localhost and mDNS subdomains as local', () => {
		expect(isLocalOrLanHost('dev.localhost')).toBe(true);
		expect(isLocalOrLanHost('nas.local')).toBe(true);
	});

	it('classifies private IPv4 ranges as local/LAN', () => {
		expect(isLocalOrLanHost('10.0.0.5')).toBe(true);
		expect(isLocalOrLanHost('172.16.0.1')).toBe(true);
		expect(isLocalOrLanHost('172.31.255.255')).toBe(true);
		expect(isLocalOrLanHost('192.168.1.100')).toBe(true);
	});

	it('rejects public IPs and domains', () => {
		expect(isLocalOrLanHost('8.8.8.8')).toBe(false);
		expect(isLocalOrLanHost('203.0.113.10')).toBe(false);
		expect(isLocalOrLanHost('172.32.0.1')).toBe(false);
		expect(isLocalOrLanHost('192.169.1.1')).toBe(false);
		expect(isLocalOrLanHost('cloud.example.com')).toBe(false);
	});
});

describe('getUrlWarnings', () => {
	it('flags CORS for any non-empty URL in web app mode', () => {
		expect(getUrlWarnings('https://cloud.example.com', true).cors).toBe(true);
	});

	it('does not flag CORS in desktop/Tauri mode', () => {
		expect(getUrlWarnings('https://cloud.example.com', false).cors).toBe(false);
	});

	it('does not warn for an empty URL', () => {
		expect(getUrlWarnings('', true)).toEqual({ cors: false, insecure: false });
	});

	it('warns about plain HTTP outside the local network', () => {
		expect(getUrlWarnings('http://cloud.example.com', false).insecure).toBe(true);
	});

	it('accepts plain HTTP on local/LAN hosts', () => {
		expect(getUrlWarnings('http://192.168.1.100:5005/home/user/hiyori', false).insecure).toBe(false);
	});

	it('accepts HTTPS anywhere', () => {
		expect(getUrlWarnings('https://cloud.example.com', true).insecure).toBe(false);
	});

	it('keeps the CORS flag but skips the insecure flag for unparseable input', () => {
		expect(getUrlWarnings('not a url', true)).toEqual({ cors: true, insecure: false });
	});
});
