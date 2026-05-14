Please analyze the provided role-play transcript and extract the memorable events for the important characters.

**Step 1: Analysis**
Before generating your final output, create a `<scratchpad>` block. Inside it:

- List all named characters in the text.
- Filter out generic or one-off characters, keeping only those who are important and likely to appear again.
- Briefly map out the timeline of events, explicitly identifying scene changes (when characters move to new locations or time skips ahead).
- Crucially, distinguish between events happening in the present scene and past events that characters are merely recalling.
- Identify who all pronouns refer to so you can use explicit names in your final output.
- Note any items, equipment, skills, clothing, or status effects that characters gain, lose, use, or are explicitly described as having during the scene.

**Step 2: Markdown Output**
Generate the final memory extraction using exactly the following Markdown format.

**Header Rules (Time and Location):**

- Format headers consistently: Use the format `### [Time], [Specific Location]`. E.g.: `### Late Afternoon, The Royal Library` or `### Next Morning, John's Kitchen`.
- Keep headers concise: Do not exceed 8 words for the time and location header.
- Create new sections for scene changes: Create a new `### [Time], [Specific Location]` block whenever the character moves to a new place or a noticeable amount of time passes.
- Resolve all pronouns to explicit names. Never use pronouns (he, she, him, her, they) to refer to characters without first referring who that person/thing is. The header must make sense when out of context. E.g., use "Early morning, Lucy's bedroom", not "Early morning, her bedroom".

**Formatting Rules for Bullet Points:**

- Each extracted thought, action, dialog, or recalled memory must be **exactly one written sentence**.
- Every sentence must begin with the character's name.
- Resolve all pronouns to explicit names. Never use pronouns to refer to characters without first referring who that person/thing is. The sentence must make sense when out of context. E.g., use "John thought that Mary liked him", not "John thought that she liked him".
- For thoughts occurring in the present scene, use the format: `[Name] thought that [thought].`
- For dialogs, use the format: `[Name] said to [Target]: "[Quote or summary]."`
- For present actions, use the format: `[Name] [action performed].`
- For past events being remembered, use the format: `[Name] recalled that [past event or memory].`

**Step 3: Inventory Extraction**
After the memories for each character, also extract their current inventory if any items are mentioned or directly implied in the scene. Inventory includes:

- **item**: Tangible objects the character carries (weapons, potions, keys, tools, food, etc.)
- **equipment**: Worn or wielded items (armor, rings, cloaks, shields, etc.)
- **skill**: Abilities the character has demonstrated or is known to possess (spellcasting, lockpicking, stealth, etc.)
- **clothing**: What the character is wearing (robes, boots, hat, etc.)
- **status**: Temporary conditions affecting the character (poisoned, invisible, wounded, etc.)

For each character with inventory, add an `#### Inventory` subsection after their memories:

```
#### Inventory

- **item**: Iron Sword - A battered but serviceable blade [carried]
- **equipment**: Leather Armor - Worn and patched [equipped]
- **clothing**: Travel Cloak - Dark green, weather-stained [equipped]
- **skill**: Basic Swordsmanship - Trained but not exceptional [known]
- **status**: Mildly Wounded - Cut on left arm [known]
```

**Inventory Rules:**

- Only extract inventory **explicitly mentioned or strongly implied in the current scene**. Do not infer items from character archetypes or backstory (e.g., do not assume a knight has armor unless it is mentioned).
- Each item line format: `**category**: Name - Description [equip_status]`
- The `[equip_status]` tag is required for every item:
  - `[equipped]` — worn, wielded, or actively in use
  - `[carried]` — on the character's person but not in active use
  - `[owned]` — possessed but not on person (stashed, in storage)
  - `[known]` — abstract/knowledge-based (abilities, skills)
- Multiple instances of the same item use "(xN)" notation: `**item**: Healing Potion (x2) - Restores minor wounds [carried]`
- Only include inventory that the character currently possesses at the end of the scene. If a character lost or used an item, do not include it.
- If no inventory is mentioned for a character, omit the `#### Inventory` section entirely.

**Step 4: Inventory Change Events**

For each character, also identify **explicit inventory events** that occurred during the scene. These are actions where a character gains, loses, equips, unequips, uses, or modifies an item.

After the `#### Inventory` section (if present), add an `#### Inventory Changes` subsection:

```
#### Inventory Changes

- **acquired**: Iron Sword - Picked up from the fallen knight
- **lost**: Wooden Shield - Shattered in combat
- **equipped**: Leather Armor - Put on before the battle
- **unequipped**: Travel Cloak - Took off to avoid detection
- **used**: Healing Potion - Drank to heal wounds
- **modified**: Enchanted Ring - Absorbed a new enchantment
```

**Change Event Rules:**

- Each line format: `**change_type**: Item Name - Description`
- Valid change types:
  - `acquired` — Character gained a new item they did not previously have
  - `lost` — Character no longer has an item (dropped, destroyed, stolen, given away)
  - `equipped` — Character put on, wielded, or activated an item they already possessed
  - `unequipped` — Character took off, sheathed, or deactivated an item they still possess
  - `used` — Character consumed or expended an item (potion drunk, scroll read, charge spent)
  - `modified` — An existing item was altered (upgraded, enchanted, repaired, corrupted)
- Only record **explicitly narrated** changes. Do not infer changes by comparing current inventory to previous scenes. If a sword isn't mentioned in the latest scene, that does NOT mean the character lost it.
- The description should briefly explain how the change occurred.
- If no inventory changes occurred for a character, omit the `#### Inventory Changes` section entirely.

<scratchpad>
[Your internal analysis goes here, explicitly noting scene changes, and if events are current or recalled]
</scratchpad>

## [Character Name]

### [Time], [Specific Location]

- [Character Name] recalled that [describe past memory].
- [Character Name] thought that [describe current thought].
- [Character Name] said to [Recipient Name]: "[Quote or summary]".
- [Character Name] [describe action].
- [Character Name] [describe another action].

#### Inventory

- **equipment**: Iron Sword - A battered but serviceable blade [carried]

### [Next Time], [Next Specific Location]

- [Character Name] [describe another action at the time and location].

## [Next Character Name]

### [Time], [Specific Location]

- [Character Name] [describe action].
- [Character Name] said to [Recipient Name]: "[Quote or summary]".

# Transcript to analyze:
