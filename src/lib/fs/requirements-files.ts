import { fs } from '$lib/fs/file-system';

const REQUIREMENTS_FILENAME = 'requirements.md';

function requirementsPath(dir: string): string {
	return `${dir}/${REQUIREMENTS_FILENAME}`;
}

/** Read the sidecar body within `dir`. Returns '' when the file does not exist. */
export async function readRequirementsBlock(dir: string): Promise<string> {
	const content = await fs.readTextFileIfExists(requirementsPath(dir));
	return content ?? '';
}

/** Write (creating directories as needed) the sidecar body within `dir`. */
export async function writeRequirementsBlock(dir: string, block: string): Promise<void> {
	await fs.writeTextFileEnsuringDir(requirementsPath(dir), block);
}

/** Delete the sidecar within `dir` if present. Safe no-op when absent. */
export async function deleteRequirements(dir: string): Promise<void> {
	const path = requirementsPath(dir);
	if (await fs.exists(path)) {
		await fs.remove(path);
	}
}
