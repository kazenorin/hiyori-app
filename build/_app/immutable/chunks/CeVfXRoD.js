const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./DHPVq3HK.js","./D3Hsn_SI.js","./8ZOAwcOM.js","./Di6zslmw.js","./Lnfar7hZ.js","./D71Flema.js","./rcHsRtqJ.js","./C2Gt7GKD.js"])))=>i.map(i=>d[i]);
import{t as e}from"./Di6zslmw.js";import{n as t,o as n}from"./8ZOAwcOM.js";import{i as r,o as i}from"./4dkzaUXN.js";var a=`locale-strings.yaml`,o=class{locale;defaultContent;baseDir;constructor(e){this.locale=e.locale,this.defaultContent=e.defaultContent,this.baseDir=e.baseDir??`config/${e.locale}`}async load(){return p(this.baseDir,a,this.defaultContent)}async loadForStory(e){return m(this.baseDir,a,e,this.defaultContent)}},s=[];function c(e){s=s.concat(e)}async function l(e,n,r){let i=`${e}/${n}`;await t.exists(i)||await t.writeTextFileEnsuringDir(i,r)}async function u(e,n,r){await l(e,n,r);let a=`${e}/${n}`,o=await t.readTextFile(a),s=i.load(o);return d(i.load(r),s)}function d(e,t){let n={...e};for(let e of Object.keys(t))e in n&&typeof n[e]==`object`&&n[e]!==null&&!Array.isArray(n[e])&&typeof t[e]==`object`&&t[e]!==null&&!Array.isArray(t[e])?n[e]=d(n[e],t[e]):n[e]=t[e];return n}function f(e,t=``){let n={};for(let[r,i]of Object.entries(e)){let e=t?`${t}.${r}`:r;typeof i==`string`?n[e]=i:typeof i==`object`&&i&&!Array.isArray(i)&&Object.assign(n,f(i,e))}return n}async function p(e,t,r){try{return await u(e,t,r)}catch(a){return await n.warn(`locale-string-loader`,`Failed to load locale strings at ${e}/${t}: ${a}`),i.load(r)}}async function m(e,r,a,o){let s=`${a}/${r}`;try{let n=await t.readTextFileIfExists(s);if(n){let t=i.load(n);return d(await u(e,r,o),t)}}catch(e){await n.debug(`locale-string-loader`,`Error checking story override at ${s}: ${e}`)}return p(e,r,o)}async function h(){if(s.length===0){await n.warn(`locale-string-loader`,`No locale string defaults registered - ensureAllLocaleStringConfigs has no effect`);return}let e=await Promise.allSettled(s.map(async e=>{try{return await l(e.baseDir,a,e.defaultContent),{locale:e.locale,success:!0}}catch(t){return await n.error(`locale-string-loader`,`Failed to ensure locale string config for ${e.locale}: ${t}`),{locale:e.locale,success:!1,error:t}}})),t=e.filter(e=>e.status===`rejected`);t.length>0&&await n.warn(`locale-string-loader`,`${t.length} of ${e.length} locale string configs failed to ensure`)}var g=`common:\r
  labels:\r
    player: Player\r
    interviewer: Interviewer\r
    sceneWithNumber: 'Scene {{sceneNumber}}'\r
    location: Location\r
    name: Name\r
    aliases: Aliases\r
    lastUpdate: Last update\r
    mainLineName: Main\r
    actWithNumber: 'Act {{actNumber}}'\r
  headers:\r
    worldContent: World Content\r
    actPlot: Act Plot\r
    actSummary: Act Summary\r
    actDescription: Act Description\r
    currentScene: Current Scene\r
    actInformation: Act Information\r
    character: Character\r
    characters: Characters\r
    interviewTranscript: Interview Transcript\r
    playerResponse: Player Response\r
    scenePlot: Scene Plot\r
    writerOutputTemplate: Writer Output Template\r
    writerOutput: Writer Output\r
    reviewerOutput: Reviewer Output\r
    editorOutput: Editor Output\r
    gameMasterOutput: Game Master Output\r
    previousActSummary: Previous Act Summary\r
    actSummaryForScenes: 'Act Summary {{summarizedScenes}}'\r
    previousNarrativeBody: 'Narrative Body for Scene {{completedScenes}}'\r
    sceneTitle: Scene title\r
    background: Background\r
    narrativeBody: Narrative Body\r
    turnOfEvents: Turn Of Events\r
    cg: CG\r
    reviewerFeedback: Reviewer Feedback\r
    template: Template\r
    activePlotThreads: Active Plot Threads\r
    decisionContext: Decision Context\r
    decisions: Decisions\r
    summary: Summary\r
    directorNotes: Director's Notes\r
    otherDirectorNotes: Other Director's Notes\r
    actPhase: Act Phase\r
    storySoFar: Story So Far\r
    targetWordCountPerScene: Target Word Count per Scene\r
  descriptions:\r
    interviewTranscript: The following is an interview exchange about the story and premises.\r
    directorNotes: "The following notes represent the player's explicit creative direction. They override all other context including Act Plot and Act Summary. Honor them with the highest priority."\r
    directorRewriteRequest: |\r
      This is a rewrite request for Scene {{sceneNumber}}:\r
      ### Original Narrative Body for Scene {{sceneNumber}}:\r
      {{originalNarrativeBody}}\r
\r
      ### Director's request:\r
      {{directorRewriteRequest}}\r
\r
pipeline:\r
  headers:\r
    sceneSummaries: Scene Summaries\r
    characterSummaries: Character Summaries\r
    characterProfiles: Character Profiles\r
  extraction:\r
    actShortSummary: 'You are a narrative summarizer. Your task is to distill the provided act summary into exactly 3 concise sentences that capture the key events, conflicts, and outcomes of the act. Focus on what happened and how the story changed. Write in past tense. After the 3 sentences, add a blank line then evaluate the characters listed in the act summary. List only those you judge to be important and likely to appear again in future acts, each on a new line, in the format: "Name (one-line description of their role or arc in this act)". Order them from most to least important. Do not list minor or one-off characters. Output only the summary and character list — no labels, no headings, no commentary.'\r
    actShortSummaryCharacterPrefix: 'Characters in this act'\r
    aliasFilter: |\r
      You are a character detector.\r
      You are provided with a JSON array of strings.\r
      Please return a filtered list containing character identifiers.\r
\r
      Do not make changes to the strings.\r
      Return only the JSON array.\r
    gameMaster: Generate the game data based on the available information in the chat history.\r
    editor: Apply suggestions from the reviewer output to the writer output. Judge whether the suggestions are necessary based on the available information in the chat history.\r
    reviewer: "Perform a review on the writer's output for Scene {{currentScene}} based on the available information in the chat history."\r
    reviewerQuick: "Quick-review the writer's output for Scene {{currentScene}}. Skim for glaring errors only — output the review template immediately with no reasoning."\r
    writer:\r
      providedSummary: "\\n- the summary of events up to Scene {{summarizedScenes}}"\r
      providedTurnOfEvents: "\\n- the Turn Of Events instructions"\r
      turnOfEventsReinforcementPhrase: "\\nYou must also consider the Turn Of Events that may drive the story to a different direction."\r
      providedDirectorNotes: "\\n- the Director's Notes"\r
      directorNotesReinforcementPhrase: '**Important**: The Director has given directions for the upcoming scene. You **MUST** consider it when writing, and follow the directions or instructions given.'\r
      actEndPhaseEvent: >\r
        When the story reaches a natural conclusion that aligns with one of the Act Plot's Possible Endings,\r
        call the \`end-act\` tool **exactly once** during your reasoning, before writing the closing scene.\r
        {{endingTypeInstructions}}\r
\r
        After calling \`end-act\`, write the closing scene as your narrative output.\r
        {{closingSceneRules}}\r
      actEndGuidance: >\r
        When the narrative reaches one of the Act Plot's Possible Endings — where the central conflict is\r
        resolved and the story arrives at a natural stopping point — call the \`end-act\` tool **exactly once**\r
        during your reasoning, before writing the closing scene.\r
        {{endingTypeInstructions}}\r
\r
        After calling \`end-act\`, write the closing scene as your narrative output.\r
        {{closingSceneRules}}\r
      closingSceneRules: >\r
        When writing the closing scene, ensure it:\r
          - Brings the narrative to a satisfying, emotionally resonant conclusion matching the chosen ending\r
          - Resolves the central conflict of the act\r
          - Reflects the consequences of the player's key choices throughout the act\r
          - Provides emotional closure without introducing new plot threads or cliffhangers\r
      epilogue: >\r
        You are writing the **epilogue** for this story. The main narrative has concluded with a {{endingType}} ending.\r
        Use the World Setting, Act Plot, and Act Summary provided to you for context.\r
        Write a final epilogue scene that reflects on the protagonist's journey, shows the lasting consequences of\r
        the player's choices, depicts the world after the main conflict has been resolved, and provides a sense of\r
        finality and closure. Do NOT introduce new conflicts, plot threads, or cliffhangers. This is the end of the story.\r
      guidanceExtraction: |\r
        You are now responsible for writing the story prose for Scene {{currentScene}}, the upcoming scene. You have been provided with:\r
\r
        - the World Setting\r
        - the Act Plot {{providedSummary}}\r
        - the Scene Plot for the upcoming scene\r
        - the full narrative body of the most recent scene, Scene {{previousScene}}\r
        - the player's response to the most recent scene {{providedTurnOfEvents}}{{providedDirectorNotes}}\r
\r
        Your job is to a craft vivid, engaging, and immersive narrative based on the provided information.\r
        You are instructed to prioritize on developing the events as directed by the Scene Plot. {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}\r
        Use the pacing decision from the Scene Plot. If the plot planner allows an expanded word count, you may write up to double the usual length.\r
        {{directorNotesReinforcementPhrase}}\r
      phaseEventExtraction: |\r
        You are now responsible for writing the story prose for Scene {{currentScene}}, the upcoming scene. You have been provided with:\r
\r
        - the World Setting\r
        - the Act Plot\r
        - the current Act Phase ({{currentActPhase}}) and the Phase Events {{providedSummary}}\r
        - the full narrative body of the most recent scene, Scene {{previousScene}}\r
        - the player's response to the most recent scene {{providedTurnOfEvents}}{{providedDirectorNotes}}\r
\r
        Your job is to a craft vivid, engaging, and immersive narrative based on the provided information.\r
        You are required to evaluate the current state of events, and see if any Phase Events can be triggered or already triggered.\r
        For triggered events that have not been elaborated on, you are instructed elaborate on them.\r
        If no events are triggered, or all triggered events have reasonable elaboration, drive the story to the most suitable next event.\r
        If you believe the story's current state have fulfilled the goals of the {{currentActPhase}} Phase, use the \`advance-phase\` tool **exactly once** to move the story forward. {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}\r
        {{directorNotesReinforcementPhrase}}\r
    plotPlanner:\r
      guidance: 'The current scene is Scene {{currentScene}}. Plan a Scene Plot for the Immediate Next Scene, Near-Term Beat (Flexible), and Mid-Term Goal (Flexible) based on the available information in the chat history.'\r
      phaseEvent: 'The current story phase of the act is {{currentActPhase}}. Plan the "Phase Events" based on the available information in the chat history.'\r
    summarizerTranscriptStart: 'The following messages will contain the transcript of the story act:'\r
    summarizerTranscriptEnd: 'The previous message was the end of the transcript of the story act.'\r
    summarizerFull: 'Generate a complete Act Summary covering all scenes in the transcript.'\r
    summarizerFallback: 'Update the Act Summary for Scene {{completedScenes}} based on the Player Response.'\r
    summarizer: 'Update the Act Summary adding information for the previous scene: "Scene {{completedScenes}}: {{sceneTitle}}"'\r
    actSummaryIncrementalTemplate: |\r
      ## {{sceneSummariesHeader}}\r
      ### {{sceneWithNumber}}: {{sceneTitle}}\r
      {{locationLabel}}: [location of where the scene took place.]\r
      {{summaryHeader}}: [summary, max 3 sentences]\r
\r
      ## {{characterSummariesHeader}}\r
      ### [Well-known name of the character]\r
      - {{aliasesLabel}}: [all known aliases]\r
      - {{sceneWithNumber}}: [summary if appeared, max 2 sentences. Also include the most representative quoted dialogue or internal monologue if any.]\r
    actPlotResumeNote: |\r
      ---\r
\r
      ## Important Note\r
\r
      This Act Line is restarted from Scene {{sceneNumber}}, plot and events that happened at or prior to Scene {{sceneNumber}} may be have a different plot, or written from another perspective.\r
    editorTemplateFitter: >\r
      The "Editor Output" does not follow the required template format. Restructure it to match the Writer Output Template\r
      by inserting the appropriate section headers defined by "Writer Output Template" without changing any content.\r
      If the "Scene Title" section is missing from the content, generate a short, fitting title based on the narrative.\r
      If any other section is missing, add the header with no body.\r
    gmTemplateFitter: >\r
      The "Game Master Output" does not follow the required game data format. Restructure it to match the game data\r
      template by inserting the appropriate section headers defined by the "Game Data" template without changing any content.\r
      If a section is missing from the content, add the header with no body.\r
  system:\r
    templateFitter: >\r
      You are a template-fitting assistant. Your sole task is to restructure provided content into a specific markdown\r
      template format without altering any of the original content. Preserve every word — only add the required section headers.\r
  labels:\r
    upTo: up to\r
    acceptAsIs: accept as-is\r
    totalViolations: Total violations\r
    recommendation: Recommendation\r
    state: State\r
    goal: Goal\r
    relationships: Relationships\r
    voice: Voice\r
    sceneCountSingular: '1 scene'\r
    sceneCountPlural: '{{count}} scenes'\r
    characterSummaries: 'Summaries of each character for recent Scenes since Scene {{sceneNumber}}.'\r
    actPhases:\r
      introduction: Introduction\r
      risingAction: Rising Action\r
      climax: Climax\r
      fallingAction: Falling Action\r
      resolution: Resolution\r
\r
features:\r
  characterCardGenerator:\r
    coreIdentity: Core Identity\r
    characterExtraction:\r
      systemPrompt: |\r
        You are a co-writer for an interactive narrative game, specializing in analyzing story content and identifying characters.\r
        You exist entirely outside the game world.\r
        Your responsibility is to extract all characters from the provided act transcript and assess their importance to the act.\r
\r
        ## Rules\r
\r
        - **Strict Canon:** Base your extraction entirely on the provided transcript. Do not invent characters not present in the text.\r
        - **Completeness:** Include every named character that appears, speaks, or is referenced.\r
        - **Include Referenced Characters:** Include characters mentioned by others even if they don't appear directly.\r
        - **Exclude Generics:** Exclude generic references (e.g., "the guard", "a soldier") unless they have a specific name.\r
        - **Assess Importance:** The "importance" field should briefly explain what role this character plays in this specific act.\r
      prefix: |\r
        I need your help to extract all the characters from the current act.\r
        {{transcriptStart}}\r
      extractionPrompt: |\r
        Extract all the characters from the current act according to the following rules:\r
\r
        # Character Extraction\r
\r
        Analyze the provided act narrative content and identify all characters that appear or are referenced.\r
\r
        ## Task\r
\r
        Extract a JSON array of characters with their importance to this act.\r
\r
        ## Rules\r
\r
        1. Include every named character that appears, speaks, or is referenced in the narrative\r
        2. Include characters mentioned by others even if they don't appear directly\r
        3. Exclude generic references (e.g., "the guard", "a soldier") unless they have a specific name\r
        4. The "importance" field should briefly explain what role this character plays in this specific act\r
\r
        ## Output Format\r
\r
        Return ONLY a JSON array. No introductory text, no markdown formatting, just the raw JSON.\r
\r
        Example output:\r
\r
        \`\`\`json\r
        [\r
        	{ "character": "John Doe", "importance": "Protagonist who makes the key decision at the climax." },\r
        	{ "character": "Jane Smith", "importance": "Supporting character who provides critical information." },\r
        	{ "character": "The Merchant", "importance": "Minor character who sets up the initial conflict." }\r
        ]\r
        \`\`\`\r
\r
        If no characters are found, return an empty array: \`[]\`\r
    cardGenerationSystemPrompt: |\r
      You are a co-writer for an interactive narrative game, specializing in constructing detailed Character Cards.\r
      You exist entirely outside the game world.\r
      Your responsibility is to analyze the provided source material and construct a Character Card for {{characterName}} that will be used as an active memory file to keep their personality, voice, and motivations consistent during future story generation.\r
\r
      ## Rules\r
\r
      - **Strict Canon:** Base your card entirely on the provided source text. Do not invent details not present or strongly implied.\r
      - **Target Focus:** Extract information only as it pertains to {{characterName}}. Do not summarize the plot or detail world-lore unless it directly explains this character's behavior or backstory.\r
      - **Handling Unknowns:** If a specific piece of information is not explicitly stated or strongly implied, write "Unknown".\r
      - **Marking Inferences:** If you deduce a trait or motive based on actions, preface that detail with [Inferred].\r
      - **Concise & Concrete:** Use bullet points and short, declarative sentences. Focus on actionable behavioral cues.\r
      - **Voice Capture:** For "Dialogue Examples", extract 2-3 exact quotes that best demonstrate their unique vocabulary, sentence structure, and tone. If no dialogue, write "No dialogue provided."\r
    characterCardGeneration: |\r
      Based on the information from the chat history, generate a new Character Card according to the following rules:\r
      {{extractionPrompt}}\r
\r
      ---\r
\r
      {{template}}\r
    cardExtractionRules: |\r
      ## Extraction Rules\r
\r
      1. **Target Focus:** Extract information _only_ as it pertains to **{{character name}}**. Do not summarize the plot or detail world-lore unless it directly explains this character's immediate behavior or backstory.\r
      2. **Strict Canon:** Base your extraction entirely on the provided source text.\r
      3. **Handling Unknowns:** If a specific piece of information (like age, eye color, or last name) is not explicitly stated or strongly implied, write "Unknown". Do not invent details.\r
      4. **Marking Inferences:** If you must deduce a trait or motive based on the character's actions (e.g., they act nervous, so you infer a fear of authority), preface that detail with \`[Inferred]\`.\r
      5. **Concise & Concrete:** Use bullet points and short, declarative sentences. Avoid flowery language. Focus on actionable behavioral cues (e.g., "Taps fingers when lying" instead of "Has a somewhat nervous disposition at times").\r
      6. **Voice Capture:** For the "Dialogue Examples" section, extract 2 to 3 exact quotes spoken by **{{character name}}** that best demonstrate their unique vocabulary, sentence structure, and tone. If they have no dialogue, write "No dialogue provided."\r
\r
      ## Output Format\r
\r
      Respond ONLY with the filled-out Markdown template below. Do not include introductory or concluding conversational text.\r
    transcriptStart: 'The following messages will contain the transcript of the current act:'\r
    transcriptEnd: 'The previous message was the end of the transcript of the current act.'\r
    actCard: 'The following message contains the Act Card from Act {{actNumber}}'\r
    characterCard: 'The following message contains the previous Character Card of {{characterName}} from Act {{actNumber}}'\r
  actCardGenerator:\r
    transcriptStart: 'The following messages will contain the transcript of the current act:'\r
    transcriptEnd: 'The previous message was the end of the transcript of the current act. The following message will contain the Act Card template:'\r
    worldContext: 'The world setting is based on the following:'\r
    systemPrompt: |\r
      You are a co-writer for an interactive narrative game, specializing in analyzing story content and producing structured Act Cards.\r
      You exist entirely outside the game world.\r
      Your responsibility is to extract and organize narrative information from the provided transcript into the Act Card template.\r
\r
      ## Instructions\r
\r
      1. **Analyze Inputs:** Review the world setting (if provided), the act transcript, and the Act Card template.\r
      2. **Extract Facts:** Identify key events, characters, conflicts, emotional arcs, and revelations from the transcript.\r
      3. **Fill Template:** Populate every field of the Act Card template based on the extracted information.\r
      4. **Mark Uncertainty:** Preface uncertain conclusions with **Inferred:**. Use **Unknown** when evidence is missing entirely.\r
\r
      ## Rules\r
\r
      - **Strict Canon:** Base your extraction entirely on the provided source text. Do not invent events, characters, or interactions not present in the transcript.\r
      - **No World Lore Duplication:** Do not repeat information already covered by the World Card unless it directly affects this act.\r
      - **Operational Focus:** Keep each field concise, specific, and useful for future story generation.\r
      - **Cause-and-Effect:** For event breakdowns, focus on cause-and-effect, not just summaries.\r
      - **Preserve Tension:** Preserve unresolved tensions, pending reveals, and escalation structure.\r
\r
      ## Output Format\r
\r
      Respond ONLY with the filled-out Act Card template. Do not include introductory or concluding conversational text.\r
    extractionPrompt: |\r
      # Extraction Instructions\r
\r
      Fill the provided Act Card template using the source from the chat history.\r
\r
      Rules:\r
\r
      - Prefer explicit facts over interpretation.\r
      - Mark uncertain conclusions as **Inferred:**.\r
      - Use **Unknown** when evidence is missing.\r
      - Do not repeat world lore already covered by the World Card unless it directly affects this plot or act.\r
      - Keep each field concise, specific, and operational for future story generation.\r
      - For chapter or event breakdowns, focus on cause-and-effect, not just summaries.\r
      - Preserve unresolved tensions, pending reveals, and escalation structure.\r
  worldBuilder:\r
    worldBuilderSeed: 'I want to create a new story. Please help me build a world.'\r
    worldBuilderExtractionPrompt: 'Please compile our conversation into the final world document now. Output the markdown directly with no preamble, no closing text, and no marker line.'\r
    templates:\r
      highFantasy: High Fantasy\r
      modernSliceOfLife: Modern Slice of Life\r
      sciFi: Sci-Fi\r
      urbanFantasy: Urban Fantasy\r
    templateClassifierSystemPrompt: |\r
      Classify the following world description into one of these categories:\r
      - high-fantasy\r
      - modern-slice-of-life\r
      - sci-fi\r
      - urban-fantasy\r
      Reply with ONLY the category ID.\r
    actPlotInterviewExtraction: |\r
      The following is the world setting for the story:\r
\r
      ---\r
\r
      {{worldContent}}\r
\r
      ---\r
\r
      Let's start the interview!\r
    resumeStoryActPrefix: |\r
      Continue the pre-game interview based on the latest story context below.\r
\r
      The content represents what already happened. Use it only as context to understand the player's direction and preferences.\r
\r
      Do NOT continue the story, narrate scenes, or generate plot content. Stay strictly in interview mode.\r
\r
      ---\r
    resumeStoryActSuffix: |\r
\r
      ---\r
\r
      Resume the interview conversation naturally from here, helping the player refine what they want next.\r
  interview:\r
    systemRole:\r
      preGame: |\r
        You are the Pre-Game Interviewer for an interactive storytelling game. Your sole objective is to brainstorm with the player to discover what kind of story they want to play. You collect information so the system can generate a plot; you DO NOT write the plot, generate game data, or narrate the story yourself.\r
      nextAct: |\r
        You are the Inter-Act Interviewer for an interactive storytelling game. The player has just completed an act and is about to begin the next one. Your objective is to brainstorm with the player about the direction of the next act — what carries forward, what changes, and where the story should go. You collect information so the system can generate a plot; you DO NOT write the plot, generate game data, or narrate the story yourself.\r
    previousActConclusion: |\r
      ## Previous Act Conclusion\r
\r
      The previous act ended with a **{{endingType}}** ending.\r
      The player has chosen to continue the story into a new act.\r
    nextActInterviewPurpose: |\r
      The previous act's story has concluded with a **{{endingType}}** ending. Acknowledging where the narrative left off, your purpose in this conversation is to interview the player about the coming act — discuss what the next act should be about, what direction the narrative should take, and how the story should evolve from here.\r
  importWorld:\r
    messages:\r
      importCompleteWithInterview: 'Import complete! Starting interview...'\r
      importComplete: 'Import complete!'\r
      importCompletedSuccessfully: 'Import completed successfully.'\r
      importFailed: 'Import failed'\r
      processingAct: 'Processing Act {{actNumber}}...'\r
      fillingNarrativeVariables: 'Filling narrative variables for {{count}} messages...'\r
      fillingNarrativeVariable: 'Filling narrative variables[{{index}}]...'\r
    validations:\r
      actTranscriptRequired: 'Act {{actNumber}} must have a transcript. Only the last act may be created without one.'\r
      actTranscriptRequiredSingle: 'Each act must have a transcript except the last one.'\r
      lastActRequiresContent: 'The last act without a transcript requires at least a world file, act file, or character card to proceed.'\r
      fileTooLarge: '{{field}} too large ({{size}}MB). Maximum is {{max}}MB.'\r
      contentRequired: 'At least a world building file, an act, or a character must be provided.'\r
      retryCountRange: 'LLM Retry Count must be between 0 and 20.'\r
      backoffIntervalRange: 'Backoff Interval must be between 1 and 60 seconds.'\r
      fileMustBeMdOrTxt: '{{field}} must be a .md or .txt file.'\r
      fileMustBeJson: 'Transcript file must be a .json file.'\r
      storyNameEmpty: 'Story name is empty — a placeholder name will be auto-generated.'\r
      actNameEmpty: 'Act {{actNumber}} name is empty — a placeholder name will be auto-generated.'\r
      characterCardMissing: 'Character card file is missing — character will be skipped during import.'\r
      characterNameEmpty: 'Character name is empty — a name will be derived from the card content.'\r
    description:\r
      unnamedCharacter: 'a character in the story'\r
  worldGenerator:\r
    fromChatSystemPrompt: 'You are a world-building analyst. Your task is to read through a chat history between a user and an AI storyteller, extract the underlying world-building elements, and produce a structured Markdown document that captures the world setting. Focus on macro-level lore: geography, factions, magic/technology systems, races, and overarching themes. Ignore specific plot events, individual character arcs, and episodic details. Output only the Markdown content — no commentary.'\r
    fromChatPrompt: |\r
      Analyze our chat history and generate a comprehensive world setting file using the Markdown template below.\r
\r
      **Rules:**\r
\r
      1. Base all information strictly on the provided chat history. You may add or omit template sections if the history demands it.\r
      2. Focus on overarching world-building and macro-level lore. Do not include specific plot points, timelines, or episodic story details.\r
      3. Exclude character profiles unless a character has a massive, world-altering impact (e.g., a ruling monarch, a deity).\r
      4. Output ONLY the raw Markdown text. Do not include conversational filler, greetings, or formatting explanations before or after the markdown block.\r
\r
      ---\r
    fromCardsSystemPrompt: 'You are a world-building analyst. Your task is to read through provided world settings, act descriptions, and character information, then synthesize a structured Markdown document that captures the world setting. Focus on macro-level lore: geography, factions, magic/technology systems, races, and overarching themes. Extrapolate from the provided materials — if details are sparse, make reasonable inferences consistent with what is given. Output only the Markdown content — no commentary.'\r
    fromCardsPrompt: |\r
      Analyze the provided world settings, act descriptions, and character information, then generate a comprehensive world setting file using the Markdown template below.\r
\r
      **Rules:**\r
\r
      1. Base all information on the provided materials. You may extrapolate or add details when necessary for a coherent world, but stay consistent with what is given.\r
      2. Focus on overarching world-building and macro-level lore. Do not include specific plot timelines or episodic story details unless they define the world itself.\r
      3. Exclude individual character profiles unless a character has a massive, world-altering impact (e.g., a ruling monarch, a deity). Character traits should inform the world's tone and themes rather than appear as entries.\r
      4. Output ONLY the raw Markdown text. Do not include conversational filler, greetings, or formatting explanations before or after the markdown block.\r
\r
      ---\r
  worldUpdater:\r
    fromActSystemPrompt: 'You are a world-building analyst. Your task is to update an existing world setting document based on new information from a completed story act and an interview about the next act. You must update the document, not rewrite it — preserve the existing structure and focus on the less rigid, more variable parts while maintaining logical consistency. Incorporate elements from the act summary and interview that reflect changes to the world. The purpose of this update is to expand the world setting so that a continuation can be written based on it. Output only the updated Markdown content — no commentary.'\r
    fromActPrompt: |\r
      Update the existing world setting document based on the information provided above.\r
\r
      **Rules:**\r
\r
      1. This is an **update**, not a rewrite. Preserve the existing structure, headings, and established lore. Only modify sections where new information from the completed act or interview introduces changes or expansions.\r
      2. Focus on the **less rigid, more variable parts** — political shifts, new locations discovered, changes in faction dynamics, technological or magical developments. Maintain logical consistency with what is already established.\r
      3. Incorporate elements from the act summary and interview that reflect how the world has changed. If the interview indicates a new direction for the next act, expand the world accordingly.\r
      4. The purpose of this update is to write a **continuation** based on the expanded world. Ensure the updated world supports the narrative direction discussed in the interview.\r
      5. Do NOT include specific plot events, character arcs, or episodic details. Extract only world-level implications.\r
      6. Output ONLY the updated raw Markdown text. Do not include conversational filler or explanations.\r
\r
      ---\r
  importantPhrases:\r
    systemPrompt: |\r
      Extract only exact phrases from the text.\r
\r
      Constraints:\r
      - Each output line must be copied verbatim from exactly one sentence.\r
      - Never include words from more than one sentence on the same line.\r
      - Never paraphrase.\r
      - Never join fragments from different parts of the text.\r
      - Return only the most important 5 items, fewer if needed.\r
      - Less than 10 words per item, prefer shorter phrases.\r
\r
      Output:\r
      One phrase per line only.\r
\r
tools:\r
  selectWorldTemplate:\r
    description: >\r
      Select the world template that best matches the user's story idea.\r
      Call this when you are confident about the genre and setting.\r
    parameters:\r
      templateId: 'The ID of the selected world template'\r
    messages:\r
      success: 'Template selected: {{templateName}}. You may now begin world-building using this template.'\r
      errors:\r
        alreadySelected: 'A template has already been selected for this session.'\r
        invalidTemplateId: 'Invalid template ID. Please choose from: high-fantasy, modern-slice-of-life, sci-fi, urban-fantasy.'\r
  evaluateRisk:\r
    description: >\r
      Evaluates the outcome of taking a risk by rolling a dice. The higher the risk level, the more likely a bad outcome.\r
      Use this to determine whether a risky action succeeds, has a mixed result, or fails.\r
    parameters:\r
      riskLevel: 'Level of risk taken (1 = lowest risk, 10 = highest risk)'\r
    messages:\r
      outcomeBad: 'The risk resulted in a bad outcome.'\r
      outcomeNeutral: 'The risk resulted in a neutral outcome.'\r
      outcomeGood: 'The risk resulted in a good outcome.'\r
  queryMemories:\r
    description: >\r
      Search the game's memory database to recall past events, locations visited, or character interactions.\r
      You must provide a character query, a time-location query for context, or both.\r
      Returns a list of recalled memories with their act number, recency, and location.\r
    parameters:\r
      characterQuery: >\r
        A short description of the character or topic to search memories for (e.g. "Elena", "the blacksmith").\r
        If omitted, the tool will return memories based on the time-location query context parameter.\r
      timeAndLocation: >\r
        A short description of the location or time period (e.g., "The Tavern", "Dawn in the Forest").\r
        If omitted, will return memories of the given character.\r
      currentActOnly: 'If true, searches only recent memories from the current act. Set to false to retrieve long-term lore or events from past acts.'\r
  queryInventory:\r
    description: |\r
      Check what a character currently has in their inventory. Returns items, equipment, skills, clothing, and status effects with equip status (equipped/wielded vs carried/owned).\r
\r
      IMPORTANT: Only inventory changes that occur DURING the story are tracked. Items a character possessed before the story began will NOT appear in inventory unless they are explicitly mentioned in a scene. You should use your judgment to infer pre-existing possessions when appropriate (e.g., a knight likely has armor even if not explicitly mentioned, a wizard likely knows basic spells).\r
\r
      Use this tool before describing a character using an item or ability to ensure consistency.\r
\r
      Set includeHistory to true to also see the log of inventory change events (acquired, lost, equipped, unequipped, used, modified) for the character.\r
    parameters:\r
      characterName: "The character's name (canonical name or alias)"\r
      itemCategory: 'Optional filter to return only one category'\r
      includeHistory: 'If true, also return the inventory change event history for this character'\r
  readActPlot:\r
    description: >\r
      Read the act plot document for the current act. The act plot contains the story's planned structure: premise,\r
      target session count, major climactic events, possible endings, storytelling style, and presentation notes.\r
      Use this to understand the planned narrative arc and guide the story accordingly.\r
    messages:\r
      noActPlot: 'No act plot has been generated for this act yet.'\r
  advancePhase:\r
    description: >\r
      Advance the story to the next narrative phase (e.g., {{introduction}} → {{risingAction}} → {{climax}} → {{fallingAction}} → {{resolution}}).\r
      You must specify both the current phase the story is in and the next phase to advance to.\r
      Both must match the actual story state — if they don't, the tool will return an error with the actual current phase and the phase will not change.\r
      This signals a major shift in the story's arc. Takes effect starting next turn.\r
      Can only be used once per scene. Cannot be used once the story has reached the resolution phase.\r
      This tool must be called during reasoning, before any narrative output is written. If any output has already been written, do not call this tool.\r
    parameters:\r
      currentPhase: 'The current narrative phase the story is in.'\r
      nextPhase: 'The next narrative phase to advance to.'\r
    messages:\r
      alreadyAdvanced: 'Phase has already been advanced this scene. It will take effect next turn.'\r
      success: 'Phase advanced from {{current}} to {{next}}. Takes effect next turn.'\r
      terminalPhase: 'Cannot advance further — the story is already at the resolution phase.'\r
      phaseMismatch:\r
        current: 'Phase mismatch: the story is currently in {{actual}}, not {{provided}}. The phase has not been advanced.'\r
        next: 'Phase mismatch: the story is currently in {{actual}} and the next phase is {{expected}}, not {{provided}}. The phase has not been advanced.'\r
  endAct:\r
    endingTypeInstructions: >\r
      When invoking \`end-act\`, set the \`endingType\` parameter to the value that best reflects the narrative\r
      trajectory and player choices: \`good\`, \`bad\`, \`bittersweet\`, or \`alternative\`.\r
    description: >\r
      End the current act. Call this when the narrative has reached a natural conclusion aligned with\r
      one of the Possible Endings defined in the Act Plot. Specify which ending the story has reached:\r
      {{good}}, {{bad}}, {{bittersweet}}, or {{alternative}}.\r
      This tool must be called during reasoning, before any narrative output is written. If any output has already been written, do not call this tool.\r
    endingGood: Good\r
    endingBad: Bad\r
    endingBittersweet: Bittersweet\r
    endingAlternative: Alternative\r
    alreadyEnded: 'The current act has already ended.'\r
    tooEarly: >\r
      The story has not reached a point where ending the act is appropriate.\r
      The narrative needs to progress further before a natural conclusion can be reached.\r
    success: 'The act has concluded with a {{endingType}} ending. Write a closing scene that brings the narrative to a satisfying conclusion.'\r
  readScene:\r
    description: >\r
      Read the content of a specific scene in the current act. Returns the narrative body (assistant response) and\r
      the player response for the given scene number, formatted in Markdown.\r
    headers:\r
      sceneBody: Scene Body\r
      playerResponse: Player Response\r
    messages:\r
      noSceneFound: 'No scene found with scene number {{sceneNumber}}.'\r
      sceneNoContent: 'Scene {{sceneNumber}} exists but contains no readable content.'\r
    parameters:\r
      sceneNumber: 'The scene number to read (1-based)'\r
  readDistantScene:\r
    description: >\r
      Read the content of a specific scene from a previous act. Use this tool ONLY when you need to recall distant\r
      memory from earlier acts — for scenes in the current act, always prefer the read-scene tool instead.\r
      Returns the narrative body (assistant response) and the player response for the given scene number,\r
      formatted in Markdown. The current act is act {{currentActNumber}}; you may only read from acts that\r
      are in the direct lineage of the current narrative line.\r
    headers:\r
      sceneBody: Scene Body\r
      playerResponse: Player Response\r
    messages:\r
      futureAct: 'Cannot read scenes from acts that have not happened yet.'\r
      actNotInLineage: 'Act {{actNumber}} is not in the lineage of the current narrative line.'\r
      noSceneFound: 'No scene found with scene number {{sceneNumber}} in act {{actNumber}}.'\r
      sceneNoContent: 'Scene {{sceneNumber}} in act {{actNumber}} exists but contains no readable content.'\r
    parameters:\r
      actNumber: 'The act number to read from (must be in the lineage of the current act line)'\r
      sceneNumber: 'The scene number to read (1-based)'\r
`,_=`common:\r
  labels:\r
    player: 玩家\r
    interviewer: 訪談者\r
    sceneWithNumber: '場景 {{sceneNumber}}'\r
    location: 地點\r
    name: 姓名\r
    aliases: 別名\r
    lastUpdate: 最後更新\r
    mainLineName: 主線\r
    actWithNumber: 第 {{actNumber}} 章\r
  headers:\r
    worldContent: 世界觀內容\r
    actPlot: 章節劇情\r
    actSummary: 章節摘要\r
    actDescription: 章節描述\r
    currentScene: 目前場景\r
    actInformation: 章節資訊\r
    character: 角色\r
    characters: 角色\r
    interviewTranscript: 訪談記錄\r
    playerResponse: 玩家回應\r
    scenePlot: 場景劇情\r
    writerOutputTemplate: 寫手輸出範本\r
    writerOutput: 寫手輸出\r
    reviewerOutput: 審閱者輸出\r
    editorOutput: 編輯輸出\r
    gameMasterOutput: GM 輸出\r
    previousActSummary: 上一章節摘要\r
    actSummaryForScenes: '章節摘要 {{summarizedScenes}}'\r
    previousNarrativeBody: '場景 {{completedScenes}} 的敘事正文'\r
    sceneTitle: 場景標題\r
    background: 背景\r
    narrativeBody: 敘事正文\r
    turnOfEvents: 劇情轉折\r
    cg: CG\r
    reviewerFeedback: 審閱者回饋\r
    template: 範本\r
    activePlotThreads: 現有劇情線索\r
    decisionContext: 回應背景\r
    decisions: 回應選項\r
    summary: 摘要\r
    directorNotes: 導演備註\r
    otherDirectorNotes: 其他導演備註\r
    actPhase: 章節階段\r
    storySoFar: 故事回顧\r
    targetWordCountPerScene: 每場景目標字數\r
  descriptions:\r
    interviewTranscript: 以下是有關此故事及設定的訪談內容。\r
    directorNotes: '以下備註代表玩家的明確創作方向。它們凌駕於所有其他脈絡之上，包含章節劇情和章節摘要。請以最高優先順序遵循。'\r
    directorRewriteRequest: |\r
      這是場景 {{sceneNumber}} 的改寫請求：\r
      ### 場景 {{sceneNumber}} 的原始敘事正文：\r
      {{originalNarrativeBody}}\r
\r
      ### 導演的要求：\r
      {{directorRewriteRequest}}\r
\r
pipeline:\r
  headers:\r
    sceneSummaries: 場景摘要\r
    characterSummaries: 角色摘要\r
    characterProfiles: 角色檔案\r
  extraction:\r
    actShortSummary: '你是一個敘事摘要者。你的任務是將提供的章節摘要濃縮為精確的 3 個簡潔句子，捕捉章節的關的關鍵事件、衝突和結果。專注於發生了什麼以及故事如何改變。以過去式撰寫。在 3 個句子之後，空一行，然後評估章節摘要中列出的角色。僅列出你判斷為重要且可能在未來章節中再次出現的角色，每行格式為：「名字（一句話描述其在此章節中的角色或弧線）」。按重要性由高到低排序。不要列出次要或僅出現一次的角色。僅輸出摘要和角色列表——不添加標籤、標題或評論。'\r
    actShortSummaryCharacterPrefix: '此章節中的角色'\r
    aliasFilter: |\r
      你是一個角色識別器。\r
      你現有一組 JSON 字串陣列。\r
      請回傳一組經篩選後、只包含角色識別名稱的 JSON 陣列。\r
      不要修改任何字串。\r
      只回傳 JSON 陣列。\r
    gameMaster: 根據聊天記錄中的可用資訊，生成遊戲資料。\r
    editor: 根據審閱者輸出的建議，修改寫手輸出。請根據聊天記錄中的可用資訊，判斷這些建議是否有必要採納。\r
    reviewer: '根據聊天記錄中的可用資訊，審閱寫手對場景 {{currentScene}} 的輸出。'\r
    reviewerQuick: '快速審閱寫手對場景 {{currentScene}} 的輸出。僅略讀明顯錯誤——立即輸出審閱範本，不附帶推理過程。'\r
    writer:\r
      providedSummary: "\\n- 場景 {{summarizedScenes}} 以前的事件摘要"\r
      providedTurnOfEvents: "\\n- 劇情轉折指令"\r
      turnOfEventsReinforcementPhrase: "\\n你也必須考慮可能使故事轉向不同方向的劇情轉折。"\r
      providedDirectorNotes: "\\n- 導演備註"\r
      directorNotesReinforcementPhrase: '**重要**: 導演已為即將到來的場景給出指示。你**必須**在撰寫時考慮，並遵循所給的方向或指示。'\r
      actEndPhaseEvent: >\r
        當故事達到與章節劇情中可能結局之一相符的自然結論時，請在推理期間呼叫 \`end-act\` 工具**精確一次**，且必須在撰寫收尾場景之前。\r
        {{endingTypeInstructions}}\r
\r
        呼叫 \`end-act\` 之後，再將收尾場景作為你的敘事輸出撰寫。\r
        {{closingSceneRules}}\r
      actEndGuidance: >\r
        當敘事達到章節劇情中描述的可能結局之一——即核心衝突已解決且故事到達自然的停止點——請在推理期間呼叫 \`end-act\` 工具**精確一次**，且必須在撰寫收尾場景之前。\r
        {{endingTypeInstructions}}\r
\r
        呼叫 \`end-act\` 之後，再將收尾場景作為你的敘事輸出撰寫。\r
        {{closingSceneRules}}\r
      closingSceneRules: >\r
        撰寫收尾場景時，請確保：\r
          - 使敘事達到與所選結局相符的令人滿意且情感共鳴的結論\r
          - 解決章節的核心衝突\r
          - 反映玩家在整個章節中關鍵選擇的後果\r
          - 提供情感上的收束，不引入新的劇情線索或懸念\r
      epilogue: >\r
        你正在為這個故事撰寫**尾聲**。主敘事已以 {{endingType}} 結局作結。請使用提供的世界觀設定、章節劇情和章節摘要作為參考。\r
        請撰寫最終的尾聲場景，回顧主角的旅程，展示玩家選擇的持久影響，描繪主要衝突解決後的世界，並提供完結感與收束。\r
        請勿引入新的衝突、劇情線索或懸念。這是故事的終結。\r
      guidanceExtraction: |\r
        你現在負責撰寫場景 {{currentScene}} 的故事散文，即即將到來的場景。你已獲得以下資訊:\r
\r
        - 世界觀設定\r
        - 章節劇情 {{providedSummary}}\r
        - 即將到來場景的場景劇情\r
        - 上一場景 (場景 {{previousScene}}) 的完整敘事正文\r
        - 玩家對上一場景的回應 {{providedTurnOfEvents}}{{providedDirectorNotes}}\r
\r
        你的工作是根據所提供的資訊，創作生動、引人入勝且沉浸式的敘事。\r
        你被指示優先發展場景劇情所引導的事件。 {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}\r
        使用場景劇情中的節奏決定。若編劇允許擴展字數，你可以寫到平常長度的兩倍。\r
        {{directorNotesReinforcementPhrase}}\r
      phaseEventExtraction: |\r
        你現在負責撰寫場景 {{currentScene}} 的故事散文，即即將到來的場景。你已獲得以下資訊:\r
\r
        - 世界觀設定\r
        - 章節劇情\r
        - 目前的章節階段 ({{currentActPhase}}) 及其階段事件 {{providedSummary}}\r
        - 上一場景 (場景 {{previousScene}}) 的完整敘事正文\r
        - 玩家對上一場景的回應 {{providedTurnOfEvents}}{{providedDirectorNotes}}\r
\r
        你的工作是根據所提供的資訊，創作生動、引人入勝且沉浸式的敘事。\r
        你需要評估目前的事件狀態，看看是否有階段事件可以被觸發或已經被觸發。\r
        對於已觸發但尚未詳細描述的事件，你被指示詳細闡述它們。\r
        若沒有事件被觸發，或所有已觸發的事件已有合理的闡述，請將故事推向最適合的下一個事件。\r
        若你認為故事的目前狀態已滿足 {{currentActPhase}} 階段的目標，請使用 \`advance-phase\` 工具**精確一次**來推進故事。 {{actEndInstruction}}{{turnOfEventsReinforcementPhrase}}\r
        {{directorNotesReinforcementPhrase}}\r
    plotPlanner:\r
      guidance: '目前場景為場景 {{currentScene}}。請根據聊天記錄中的可用資訊，為緊接的下一場景、近期的情節節奏 (可彈性處理) 以及中期目標 (可彈性處理) 規劃場景劇情。'\r
      phaseEvent: '目前章節的故事階段為 {{currentActPhase}}。請根據聊天記錄中的可用資訊，規劃「階段事件」。'\r
    summarizerTranscriptStart: '以下訊息將包含故事章節的文本記錄: '\r
    summarizerTranscriptEnd: '上一則訊息是故事章節文本記錄的結束。'\r
    summarizerFull: '根據文本記錄中的所有場景，生成完整的章節摘要。'\r
    summarizerFallback: '根據玩家回應，更新場景 {{completedScenes}} 的章節摘要。'\r
    summarizer: '更新章節摘要，加入上一個場景的資訊: 「場景 {{completedScenes}}: {{sceneTitle}}」'\r
    actSummaryIncrementalTemplate: |\r
      ## {{sceneSummariesHeader}}\r
      ### {{sceneWithNumber}}: {{sceneTitle}}\r
      {{locationLabel}}: [場景發生的地點]\r
      {{summaryHeader}}: [摘要，最多 3 句話]\r
\r
      ## {{characterSummariesHeader}}\r
      ### [角色的知名名稱]\r
      - {{aliasesLabel}}: [所有已知別名]\r
      - {{sceneWithNumber}}: [若出現的摘要，最多 2 句話。若有的話，也包含最具代表性的對話引文或內心獨白。]\r
    actPlotResumeNote: |\r
      ---\r
\r
      ## 重要注意事項\r
\r
      此章節線從場景 {{sceneNumber}} 重新開始，在場景 {{sceneNumber}} 或之前發生的情節和事件可能有不同的劇情，或是從另一個視角撰寫。\r
    editorTemplateFitter: >\r
      「編輯輸出」未符合所需的範本格式。請根據「寫手輸出範本」中所定義的區段標題重新調整結構，\r
      插入適當的標題而不更改任何內容。若內容缺少「場景標題」區段，請根據敘事生成一個簡短貼切的標題。\r
      若缺少其他區段，請加上標題並留空內容。\r
    gmTemplateFitter: >\r
      「GM 輸出」未符合所需的遊戲資料格式。請根據遊戲資料範本重新調整結構，\r
      插入適當的標題而不更改任何內容。若缺少某個區段，請加上標題並留空內容。\r
  system:\r
    templateFitter: >\r
      你是一個範本配適助手。你唯一的任務是將提供的內容重新調整為特定的 Markdown\r
      範本格式，而不改動任何原始內容。保留每一個字——只加入所需的區段標題。\r
  labels:\r
    upTo: 至\r
    acceptAsIs: 不需修改\r
    totalViolations: 違規總數\r
    recommendation: 建議\r
    state: 狀態\r
    goal: 目標\r
    relationships: 關係\r
    voice: 語氣\r
    sceneCountSingular: 1 個場景\r
    sceneCountPlural: '{{count}} 個場景'\r
    characterSummaries: '自場景 {{sceneNumber}} 以來每個角色的近期摘要。'\r
    actPhases:\r
      introduction: 鋪陳\r
      risingAction: 發展\r
      climax: 高潮\r
      fallingAction: 收束\r
      resolution: 結局\r
\r
features:\r
  characterCardGenerator:\r
    coreIdentity: 核心身份\r
    characterExtraction:\r
      systemPrompt: |\r
        你是一個互動敘事遊戲的共同作者，專精於分析故事內容並識別角色。\r
        你完全存在於遊戲世界之外。\r
        你的職責是從提供的章節文本記錄中擷取所有角色，並評估他們在此章節中的重要性。\r
\r
        ## 規則\r
\r
        - **嚴格遵循原文：** 完全根據提供的文本記錄提取。不得捏造文本中未出現的角色。\r
        - **完整性：** 包含每個出現、發言或被提及的具名角色。\r
        - **包含被提及角色：** 包含被其他角色提及但未直接出現的角色。\r
        - **排除泛稱：** 排除泛稱引用（如「守衛」、「士兵」），除非他們有具體名字。\r
        - **評估重要性：** 「重要性」欄位應簡要說明此角色在此章節中扮演的角色。\r
      prefix: |\r
        我需要你協助從目前的章節中擷取所有角色。\r
        {{transcriptStart}}\r
      extractionPrompt: |\r
        根據以下規則，從目前的章節中擷取所有角色:\r
\r
        # 角色擷取\r
\r
        分析提供的章節敘事內容，識別所有出現或被提及的角色。\r
\r
        ## 任務\r
\r
        擷取一個 JSON 陣列，包含角色及其在本章節中的重要性。\r
\r
        ## 規則\r
\r
        1. 包含敘事中每個具名的、出現的、說話的或被提及的角色\r
        2. 包含被他人提及的角色，即使他們沒有直接出現\r
        3. 排除泛指的引用 (例如「那個守衛」、「一個士兵」) ，除非他們有具體名字\r
        4. 「重要性」欄位應簡要說明該角色在本章節中扮演什麼角色\r
\r
        ## 輸出格式\r
\r
        僅回傳 JSON 陣列。不要有引言文字，不要 markdown 格式，只需原始 JSON。\r
\r
        範例輸出:\r
\r
        \`\`\`json\r
        [\r
        	{ "character": "John Doe", "importance": "主角，在高潮時做出關鍵決定。" },\r
        	{ "character": "Jane Smith", "importance": "配角，提供關鍵資訊。" },\r
        	{ "character": "The Merchant", "importance": "次要角色，引發初始衝突。" }\r
        ]\r
        \`\`\`\r
\r
        若未找到任何角色，回傳空陣列: \`[]\`\r
    cardGenerationSystemPrompt: |\r
      你是一個互動敘事遊戲的共同作者，專精於建構詳細的角色卡。\r
      你完全存在於遊戲世界之外。\r
      你的職責是分析提供的原始素材，為 {{characterName}} 建構一份角色卡，作為另一個 AI 的活躍記憶檔案，用於在未來的故事生成中保持其性格、語聲和動機的一致性。\r
\r
      ## 規則\r
\r
      - **嚴格遵循原文：** 完全根據提供的原文建構角色卡。不得捏造原文中未出現或未強烈暗示的細節。\r
      - **目標聚焦：** 僅擷取與 {{characterName}} 相關的資訊。不要概述劇情或詳述世界觀，除非這直接解釋了該角色的行為或背景。\r
      - **處理未知項：** 若某項具體資訊未明確提及或強烈暗示，請填寫「未知」。\r
      - **標記推斷：** 若你根據角色的行為推斷某項特質或動機，請在該項細節前加上 [推斷]。\r
      - **簡潔具體：** 使用項目符號和簡短的陳述句。聚焦於可操作的行為線索。\r
      - **語聲捕捉：** 在「對話範例」區段中，擷取 2 至 3 句最能展現其獨特詞彙、句式和語調的原話。若該角色沒有對話，請填寫「未提供對話。」\r
    characterCardGeneration: |\r
      根據聊天記錄中的資訊，按照以下規則生成新的角色卡:\r
      {{extractionPrompt}}\r
\r
      ---\r
\r
      {{template}}\r
    cardExtractionRules: |\r
      ## 擷取規則\r
\r
      1. **目標聚焦: ** 僅擷取與 **{{character name}}** 相關的資訊。不要概述劇情或詳述世界觀，除非這直接解釋了該角色的行為或背景。\r
      2. **嚴格遵循原文: ** 完全根據提供的原文進行擷取。\r
      3. **處理未知項: ** 若某項具體資訊 (如年齡、瞳色或姓氏) 未明確提及或強烈暗示，請填寫「未知」。不要編造細節。\r
      4. **標記推斷: ** 若你必須根據角色的行為推斷某項特質或動機 (例如: 他們表現得緊張，因此你推斷他們害怕權威) ，請在該項細節前加上 \`[推斷]\`。\r
      5. **簡潔具體: ** 使用項目符號和簡短的陳述句。避免華麗辭藻。聚焦於可操作的行為線索 (例如: 「說謊時會敲手指」而非「有時會表現得有些緊張」) 。\r
      6. **語聲捕捉: ** 在「對話範例」區段中，擷取 2 至 3 句 **{{character name}}** 說過的原話，以最能展現其獨特詞彙、句式和語調為準。若該角色沒有對話，請填寫「未提供對話。」\r
\r
      ## 輸出格式\r
\r
      僅以填寫完成的下方 Markdown 範本作回應。不要包含開場或結尾的對話式文字。\r
    transcriptStart: '以下訊息將包含目前章節的文本記錄: '\r
    transcriptEnd: '上一則訊息是目前章節文本記錄的結束。'\r
    actCard: '以下訊息包含第 {{actNumber}} 章的章節卡'\r
    characterCard: '以下訊息包含 {{characterName}} 在第 {{actNumber}} 章的舊角色卡'\r
  actCardGenerator:\r
    transcriptStart: '以下訊息將包含目前章節的文本記錄: '\r
    transcriptEnd: '上一則訊息是目前章節文本記錄的結束。下一則訊息將包含章節卡範本: '\r
    worldContext: '世界觀設定基於以下內容: '\r
    systemPrompt: |\r
      你是一個互動敘事遊戲的共同作者，專精於分析故事內容並產出結構化的章節卡。\r
      你完全存在於遊戲世界之外。\r
      你的職責是從提供的文本記錄中提取並組織敘事資訊，填入章節卡範本。\r
\r
      ## 指示\r
\r
      1. **分析輸入：** 檢視世界觀設定（如有提供）、章節文本記錄及章節卡範本。\r
      2. **提取事實：** 從文本記錄中識別關鍵事件、角色、衝突、情感弧線與啟示。\r
      3. **填寫範本：** 根據提取的資訊填入章節卡範本的每個欄位。\r
      4. **標記不確定性：** 在不確定的推論前加上 **推論：**。完全缺乏證據時使用 **未知**。\r
\r
      ## 規則\r
\r
      - **嚴格遵循原文：** 完全根據提供的原文提取。不得捏造文本記錄中未出現的事件、角色或互動。\r
      - **不重複世界觀：** 除非直接影響本章節，不要重複世界卡已涵蓋的資訊。\r
      - **務實取向：** 每個欄位保持簡潔、具體，並對未來的故事生成有實用價值。\r
      - **因果關係：** 事件分解著重因果關係，而非單純摘要。\r
      - **保留張力：** 保留未解決的張力、待揭露的謎團及升級結構。\r
\r
      ## 輸出格式\r
\r
      僅以填寫完成的章節卡範本回覆。不要包含開場或結尾的對話文字。\r
    extractionPrompt: |\r
      # 擷取指令\r
\r
      以聊天記錄作為資料來源，以填寫所提供的章節卡範本。\r
\r
      規則:\r
\r
      - 優先使用明確的事實而非推斷。\r
      - 將不確定的結論標記為 **推斷: **。\r
      - 證據不足時應標記為 **未知**。\r
      - 不要重複世界觀卡中已涵蓋的設定，除非它直接影響此劇情或章節。\r
      - 保持每項內容簡潔、具體，讓它為未來的故事生成時具有作用。\r
      - 對於章節或事件作出分析，著重因果關係，而非僅僅作摘要。\r
      - 保留未解決的緊張局勢、待揭示的內容和事件升級、加劇的結構。\r
  worldBuilder:\r
    worldBuilderSeed: '我想創作一個新故事。請協助我構建世界觀。'\r
    worldBuilderExtractionPrompt: '請將我們的對話編譯為最終的世界觀文件。請直接輸出 Markdown，不要前言、結語或標記行。'\r
    templates:\r
      highFantasy: 高奇幻\r
      modernSliceOfLife: 現代日常\r
      sciFi: 科幻\r
      urbanFantasy: 都市奇幻\r
    templateClassifierSystemPrompt: |\r
      將以下世界觀描述分類為以下類別 ID 之一：\r
      - high-fantasy\r
      - modern-slice-of-life\r
      - sci-fi\r
      - urban-fantasy\r
      只回覆類別 ID。\r
    actPlotInterviewExtraction: |\r
      以下是故事的世界觀設定:\r
\r
      ---\r
\r
      {{worldContent}}\r
\r
      ---\r
\r
      開始訪談吧！\r
    resumeStoryActPrefix: |\r
      根據以下最新的故事脈絡，繼續遊戲前的訪談。\r
\r
      以下內容代表已經發生的事件，僅作為理解玩家方向與偏好的脈絡使用。\r
\r
      請勿繼續撰寫故事、敘述場景或生成劇情內容。請嚴格維持訪談模式。\r
\r
      ---\r
    resumeStoryActSuffix: |\r
\r
      ---\r
\r
      從這裡自然地繼續訪談對話，協助玩家釐清他們接下來想要的內容。\r
  interview:\r
    systemRole:\r
      preGame: |\r
        你是一個互動敘事遊戲的遊戲前訪談者。你唯一的目標是與玩家腦力激盪，發掘他們想玩什麼類型的故事。你收集資訊以供系統生成劇情；你**不**撰寫劇情、生成遊戲資料或自行敘述故事。\r
      nextAct: |\r
        你是一個互動敘事遊戲的章節間訪談者。玩家剛完成一個章節，即將開始下一個。你的目標是與玩家腦力激盪下一個章節的方向——什麼會延續、什麼會改變、故事該往哪裡走。你收集資訊以供系統生成劇情；你**不**撰寫劇情、生成遊戲資料或自行敘述故事。\r
    previousActConclusion: |\r
      ## 上一章節結論\r
\r
      上一個章節以 **{{endingType}}** 結局作結。\r
      玩家已選擇繼續故事至新的章節。\r
    nextActInterviewPurpose: |\r
      上一個章節的故事已以 **{{endingType}}** 結局作結。在了解敘事留下的发展之後，你在這段對話中的目的是訪談玩家關於接下來的章節——討論下一個章節應該關於什麼、敘事應該走向何方，以及故事應該如何從這裡演進。\r
  importWorld:\r
    messages:\r
      importCompleteWithInterview: '匯入完成！正在啟動訪談...'\r
      importComplete: '匯入完成！'\r
      importCompletedSuccessfully: '匯入已成功完成。'\r
      importFailed: '匯入失敗'\r
      processingAct: '正在處理章節 {{actNumber}}...'\r
      fillingNarrativeVariables: '正在填入 {{count}} 則訊息的敘事變數...'\r
      fillingNarrativeVariable: '正在填入敘事變數[{{index}}]...'\r
    validations:\r
      actTranscriptRequired: '章節 {{actNumber}} 必須提供對話記錄。僅最後一個章節可以不提供。'\r
      actTranscriptRequiredSingle: '除最後一個章節外，每個章節都必須提供對話記錄。'\r
      lastActRequiresContent: '沒有對話記錄的最後一個章節，至少需要世界觀文件、章節文件或角色卡才能繼續。'\r
      fileTooLarge: '{{field}} 檔案過大 ({{size}}MB)。上限為 {{max}}MB。'\r
      contentRequired: '至少需要提供世界觀文件、一個章節或一個角色。'\r
      retryCountRange: 'LLM 重試次數必須介於 0 到 20 之間。'\r
      backoffIntervalRange: '退避間隔必須介於 1 到 60 秒之間。'\r
      fileMustBeMdOrTxt: '{{field}} 必須是 .md 或 .txt 檔案。'\r
      fileMustBeJson: '對話記錄檔案必須是 .json 檔案。'\r
      storyNameEmpty: '故事名稱為空——將自動生成佔位名稱。'\r
      actNameEmpty: '章節 {{actNumber}} 名稱為空——將自動生成佔位名稱。'\r
      characterCardMissing: '角色卡檔案缺失——角色將在匯入時被跳過。'\r
      characterNameEmpty: '角色名稱為空——將從卡片內容推導名稱。'\r
    description:\r
      unnamedCharacter: '故事中的某個角色'\r
  worldGenerator:\r
    fromChatSystemPrompt: '你是一個世界觀建構分析師。你的任務是閱讀用戶與 AI 故事講述者之間的聊天記錄，提取底層的世界觀建構元素，並生成一份捕捉世界觀設定的結構化 Markdown 文件。著重於宏觀設定: 地理、勢力、魔法/科技體系、種族和整體主題。忽略具體劇情事件、個別角色弧線和章節性細節。僅輸出 Markdown 內容——不加評論。'\r
    fromChatPrompt: |\r
      分析我們的聊天記錄，並使用下方的 Markdown 範本生成一份完整的世界觀設定文件。\r
\r
      **規則:**\r
\r
      1. 所有資訊必須嚴格基於提供的聊天記錄。若記錄需要，你可以添加或省略範本區段。\r
      2. 著重於宏觀的世界觀建構和整體設定。不要包含具體的劇情要點、時間線或章節性故事細節。\r
      3. 排除角色簡介，除非該角色有巨大的、改變世界的影響 (例如統治君主、神祇) 。\r
      4. 僅輸出原始 Markdown 文字。不要在 Markdown 區塊前後包含對話式填充、問候或格式說明。\r
\r
      ---\r
    fromCardsSystemPrompt: '你是一個世界觀建構分析師。你的任務是閱讀提供的世界觀設定、章節描述和角色資訊，然後綜合生成一份捕捉世界觀設定的結構化 Markdown 文件。著重於宏觀設定: 地理、勢力、魔法/科技體系、種族和整體主題。根據提供的素材進行推斷——若細節稀少，可做出與既有內容一致的合理推推測。僅輸出 Markdown 內容——不加評論。'\r
    fromCardsPrompt: |\r
      分析提供的世界觀設定、章節描述和角色資訊，並使用下方的 Markdown 範本生成一份完整的世界觀設定文件。\r
\r
      **規則:**\r
\r
      1. 所有資訊必須基於提供的素材。為了建構連貫的世界觀，你可以在必要時推斷或添加細節，但必須與既有內容保持一致。\r
      2. 著重於宏觀的世界觀建構和整體設定。不要包含具體的劇情時間線或章節性故事細節，除非它們定義了世界本身。\r
      3. 排除個別角色簡介，除非該角色有巨大的、改變世界的影響 (例如統治君主、神祇) 。角色特質應用於形塑世界觀的基調和主題，而非作為獨立條目出現。\r
      4. 僅輸出原始 Markdown 文字。不要在 Markdown 區塊前後包含對話式填充、問候或格式說明。\r
\r
      ---\r
  worldUpdater:\r
    fromActSystemPrompt: '你是一個世界建構分析師。你的任務是根據已完成的故事章節和關於下一章節的訪談中的新資訊，更新現有的世界設定文件。你必須更新文件，而非重寫——保留現有結構，專注於較不固定、更具變動性的部分，同時保持邏輯一致性。將章節摘要和訪談中反映世界變化的元素納入考量。此次更新的目的是擴展世界設定，以便根據擴展後的世界撰寫續篇。僅輸出更新後的 Markdown 內容——不加評論。'\r
    fromActPrompt: |\r
      根據上方提供的資訊，更新現有的世界設定文件。\r
\r
      **規則：**\r
\r
      1. 這是**更新**，而非重寫。保留現有結構、標題和已建立的背景設定。僅在已完成章節或訪談中的新資訊引入變更或擴展時，修改相應章節。\r
      2. 專注於**較不固定、更具變動性的部分**——政治變動、新發現的地點、派系動態的變化、科技或魔法發展。與已建立的設定保持邏輯一致性。\r
      3. 將章節摘要和訪談中反映世界變化的元素納入考量。如果訪談指出下一章節的新方向，則相應擴展世界設定。\r
      4. 此次更新的目的是根據擴展後的世界**撰寫續篇**。確保更新後的世界支援訪談中討論的敘事方向。\r
      5. 不要包含具體情節事件、角色弧線或章節性細節。僅提取世界層面的影響。\r
      6. 僅輸出更新後的原始 Markdown 文字。不要包含對話性填充或解釋。\r
\r
      ---\r
  importantPhrases:\r
    systemPrompt: |\r
      僅從文本中擷取原句短語。\r
\r
      約束:\r
      - 每行輸出必須逐字複製自同一句句子。\r
      - 絕不在同一行中包含來自多個句子的詞語。\r
      - 絕不改寫。\r
      - 絕不拼接來自文本不同部分的片段。\r
      - 僅回傳最重要的 5 項，若不足則更少。\r
      - 每項少於 10 個詞，優先選擇較短的短語。\r
\r
      輸出:\r
      每行僅一個短語。\r
\r
tools:\r
  selectWorldTemplate:\r
    description: >\r
      選擇最符合使用者故事想法的世界觀模板。\r
      當你對類型和設定有信心時呼叫此工具。\r
    parameters:\r
      templateId: '所選世界觀模板的 ID'\r
    messages:\r
      success: '已選擇模板：{{templateName}}。你現在可以使用此模板開始構建世界觀。'\r
      errors:\r
        alreadySelected: '此工作階段已選擇了模板。'\r
        invalidTemplateId: '無效的模板 ID。請從以下選擇：high-fantasy、modern-slice-of-life、sci-fi、urban-fantasy。'\r
  evaluateRisk:\r
    description: >\r
      透過擲骰來評估帶有風險的行動的結果。風險等級越高，壞結果的機率越大。\r
      用於判斷帶有風險的行動是成功、混合結果還是失敗。\r
    parameters:\r
      riskLevel: '冒險程度 (1 = 最低風險，10 = 最高風險) '\r
    messages:\r
      outcomeBad: '行動導致了壞結果。'\r
      outcomeNeutral: '行動導致了中性結果。'\r
      outcomeGood: '行動導致了好結果。'\r
  queryMemories:\r
    description: >\r
      搜尋遊戲的記憶資料庫，以喚回過去的事件、去過的地點或角色互動。\r
      你必須提供角色查詢、時間-地點查詢，或兩者兼備。\r
      回傳的記憶列表將包含章節編號、新近度和地點。\r
    parameters:\r
      characterQuery: >\r
        簡短描述要搜尋記憶的角色或主題 (例如「莉娜」、「鐵匠」) 。\r
        若省略，工具將根據時間-地點查詢參數回傳記憶。\r
      timeAndLocation: >\r
        簡短描述地點或時間 (例如「酒館」、「森林的清晨」) 。\r
        若省略，將回傳指定角色的記憶。\r
      currentActOnly: '若為 true，僅搜尋目前章節的近期記憶。設為 false 可擷取過往章節的長期設定或事件。'\r
  queryInventory:\r
    description: |\r
      查看角色目前物品欄中的內容。回傳物品、裝備、技能、服裝和狀態效果，並標示裝備狀態 (已裝備/已揮舞 vs 隨身攜帶/已擁有) 。\r
\r
      重要: 僅追蹤故事進行中發生的物品欄變更。故事開始前角色已擁有的物品不會出現在物品欄中，除非在場景中明確提及。你應自行判斷推斷角色既有的物品 (例如騎士很可能有盔甲，即使未被明確提及; 法師很可能懂得基本法術) 。\r
\r
      在描述角色使用物品或能力之前，請先使用此工具以確保一致性。\r
\r
      設 includeHistory 為 true 可同時查看角色的物品欄變更事件記錄 (獲得、失去、裝備、卸下、使用、修改) 。\r
    parameters:\r
      characterName: '角色名稱 (正規名稱或別名) '\r
      itemCategory: '選填篩選條件，僅回傳指定類別'\r
      includeHistory: '若為 true，同時回傳物品欄變更事件歷史'\r
  readActPlot:\r
    description: >\r
      閱讀目前章節的章節劇情文件。章節劇情包含故事已規劃的結構: 前提、目標場景數、\r
      主要高潮事件、可能的結局、敘事風格和呈現備註。\r
      使用此工具來了解已規劃的敘事走向，並依此引導故事發展。\r
    messages:\r
      noActPlot: '此章節尚未生成章節劇情。'\r
  advancePhase:\r
    description: >\r
      將故事推進至下一個敘事階段 (例如: {{introduction}} → {{risingAction}} → {{climax}} → {{fallingAction}} → {{resolution}}) 。\r
      你必須同時指定故事目前所處的階段以及要推進至的下一個階段。\r
      兩者必須與實際故事狀態相符——若不相符，工具將回傳錯誤訊息並顯示實際目前階段，且不會推進階段。\r
      此動作標誌著故事弧線的重大轉折，將於下一回合生效。\r
      每個場景只能使用一次。故事已達結局階段後無法再使用。\r
      此工具必須在推理期間呼叫，且必須在任何敘事輸出撰寫之前。若已撰寫任何輸出，請勿呼叫此工具。\r
    parameters:\r
      currentPhase: '故事目前所處的敘事階段。'\r
      nextPhase: '要推進至的下一個敘事階段。'\r
    messages:\r
      alreadyAdvanced: '此場景已推進過階段，將於下一回合生效。'\r
      success: '階段已從 {{current}} 推進至 {{next}}，將於下一回合生效。'\r
      terminalPhase: '無法再推進——故事已達結局階段。'\r
      phaseMismatch:\r
        current: '階段不符：故事目前處於 {{actual}}，而非 {{provided}}。階段未推進。'\r
        next: '階段不符：故事目前處於 {{actual}}，下一個階段為 {{expected}}，而非 {{provided}}。階段未推進。'\r
  endAct:\r
    endingTypeInstructions: >\r
      呼叫 \`end-act\` 時，請將 \`endingType\` 參數設為最符合敘事走向及玩家選擇的值：\`good\`(好結局)、\`bad\`(壞結局)、\`bittersweet\`(苦甜結局) 或 \`alternative\`(另類結局)。\r
    description: >\r
      結束目前章節。當敘事已達到與章節劇情中定義的可能結局之一相符的自然結論時，呼叫此工具。\r
      指定故事已達到的結局: {{good}}、{{bad}}、{{bittersweet}} 或 {{alternative}}。\r
      此工具必須在推理期間呼叫，且必須在任何敘事輸出撰寫之前。若已撰寫任何輸出，請勿呼叫此工具。\r
    endingGood: 好結局\r
    endingBad: 壞結局\r
    endingBittersweet: 苦甜結局\r
    endingAlternative: 另類結局\r
    alreadyEnded: '目前章節已經結束。'\r
    tooEarly: >\r
      故事尚未到達適合結束章節的階段。\r
      敘事需要進一步發展才能達到自然的結論。\r
    success: '章節已以 {{endingType}} 結局作結。請撰寫一個使敘事達到令人滿意結論的收尾場景。'\r
  readScene:\r
    description: >\r
      閱讀目前章節中所指定的場景的內容。回傳指定場景編號的敘事正文 (AI 回應) 和玩家回應，\r
      以 Markdown 格式呈現。\r
    headers:\r
      sceneBody: 場景正文\r
      playerResponse: 玩家回應\r
    messages:\r
      noSceneFound: '找不到場景編號為 {{sceneNumber}} 的場景。'\r
      sceneNoContent: '場景 {{sceneNumber}} 存在但不包含可讀取的內容。'\r
    parameters:\r
      sceneNumber: '要閱讀的場景編號 (從 1 開始) '\r
  readDistantScene:\r
    description: >\r
      閱讀先前章節中指定場景的內容。僅在需要回憶早期章節的遙遠記憶時使用此工具 — 對於目前章節的場景，\r
      請務必優先使用 read-scene 工具。回傳指定場景編號的敘事正文 (AI 回應) 和玩家回應，\r
      以 Markdown 格式呈現。目前章節為第 {{currentActNumber}} 章；您只能閱讀目前敘事線傳承中的章節。\r
    headers:\r
      sceneBody: 場景正文\r
      playerResponse: 玩家回應\r
    messages:\r
      futureAct: '無法閱讀尚未發生的章節。'\r
      actNotInLineage: '第 {{actNumber}} 章不在目前敘事線的傳承中。'\r
      noSceneFound: '第 {{actNumber}} 章中找不到場景編號為 {{sceneNumber}} 的場景。'\r
      sceneNoContent: '第 {{actNumber}} 章的場景 {{sceneNumber}} 存在但不包含可讀取的內容。'\r
    parameters:\r
      actNumber: '要閱讀的章節編號 (必須在目前章節線的傳承中)'\r
      sceneNumber: '要閱讀的場景編號 (從 1 開始)'\r
`,v={},y=new o({locale:`en`,defaultContent:g}),b=new o({locale:`zh-Hant-HK`,defaultContent:_});c([y,b]),r(`en/locale-strings.yaml`,g),r(`zh-Hant-HK/locale-strings.yaml`,_);async function x(e,t,n){let r;if(t&&n){let i=S(e),a=await C(t,n);r=await i.loadForStory(a)}else r=await S(e).load();v=f(r)}function S(e){return e===`zh-Hant-HK`?b:y}async function C(t,n){try{let{resolveStoryFolder:r}=await e(async()=>{let{resolveStoryFolder:e}=await import(`./DHPVq3HK.js`);return{resolveStoryFolder:e}},__vite__mapDeps([0,1,2,3,4,5,6,7]),import.meta.url);return await r(t,n)}catch{return``}}function w(e,t){let r=v[e];return r===void 0?(n.warn(`locale-strings`,`Missing locale string key: ${e}`),e):t?r.replace(/\{\{(\w+)}}/g,(e,n)=>{let r=t[n];return r===void 0?e:String(r)}):r}export{w as n,h as r,x as t};