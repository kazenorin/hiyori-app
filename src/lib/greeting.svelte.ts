import { invoke } from '@tauri-apps/api/core';

let greeting = $state('');
let message = $state('');

export function getGreeting() {
	return greeting;
}

export function getMessage() {
	return message;
}

export function setMessage(value: string) {
	message = value;
}

export async function send() {
	greeting = await invoke<string>('greet', { name: message || 'World' });
}
