import { fs } from '$lib/fs/file-system';
import * as dbStoryFolders from '$lib/db/story-folders';
import * as dbStories from '$lib/db/stories';
import { resolveStoryFolder } from '$lib/fs/story-folders';
import { generateWorld } from './world-generator';
import { WORLD_MD } from '$lib/ai/world-generator/constants';

export async function ensureWorldFile(storyId: string, storyName?: string, abortSignal?: AbortSignal): Promise<string> {
	const story = await dbStories.getStory(storyId);
	if (!story) {
		throw new Error(`Invalid storyId: ${storyId}, not found.`);
	}

	const folder = await dbStoryFolders.getStoryFolder(storyId);
	const folderName = folder ?? (await resolveStoryFolder(storyId, storyName ?? story.name));
	const worldPath = `${folderName}/${WORLD_MD}`;

	const worldContent = await fs.readTextFileIfExists(worldPath);
	if (worldContent !== undefined) {
		return worldContent;
	}

	const generated = await generateWorld(storyId, folderName, abortSignal);
	await fs.writeTextFile(worldPath, generated);
	return generated;
}
