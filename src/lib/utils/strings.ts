export function stripCodeFences(text: string): string {
	return text.replace(/^```[^\n]*\n/, '').replace(/\n```[\s]*$/, '');
}