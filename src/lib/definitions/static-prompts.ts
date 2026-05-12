/** Static (non-templated) extraction prompts used by pipeline phases. */

export const gameMasterExtractionPrompt = 'Generate the game data based on the available information in the chat history.';

export const editorExtractionPrompt =
	'Apply suggestions from the reviewer output to the writer output. ' +
	'Judge whether the suggestions are necessary based on the available information in the chat history.';

export const reviewerExtractionPromptTemplate = `Perform a review on the writer's output for Scene {currentScene} based on the available information in the chat history.`;

export const writerExtractionPromptTemplate =
	'Write a story prose for Scene {currentScene} based on the available information in the chat history.';

export const plotPlannerExtractionPromptTemplate =
	'The current scene is Scene {currentScene}. Plan a Scene Plot for the Immediate Next Scene, Near-Term Beat (Flexible), and Mid-Term Goal (Flexible) based on the available information in the chat history.';

export const summarizerFallbackExtractionPromptTemplate =
	'Update the Act Summary for Scene {completedScenes} based on the Player Response.';

export const summarizerExtractionPromptTemplate =
	'Update the Act Summary adding information for the previous scene: "Scene {completedScenes}: {sceneTitle}"';

export const templateFitterSystemPrompt =
	'You are a template-fitting assistant. Your sole task is to restructure provided content into a specific markdown template format without altering any of the original content. Preserve every word — only add the required section headers.';

export const editorTemplateFitterExtractionPrompt =
	'The "Editor Output" does not follow the required template format. Restructure it to match the Writer Output Template by inserting the appropriate section headers defined by "Writer Output Template" without changing any content. If the "Scene Title" section is missing from the content, generate a short, fitting title based on the narrative. If any other section is missing, add the header with no body.';

export const gmTemplateFitterExtractionPrompt =
	'The "Game Master Output" does not follow the required game data format. Restructure it to match the game data template by inserting the appropriate section headers defined by the "Game Data" template without changing any content. If a section is missing from the content, add the header with no body.';
