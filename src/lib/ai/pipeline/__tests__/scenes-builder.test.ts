import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/definitions/common-headers', () => ({
	sectionFormat: (t: string, lvl = 2) => `${'#'.repeat(lvl)} ${t}\n\n`,
	sceneTitleHeader: () => 'Scene Title',
	backgroundHeader: () => 'Background',
	narrativeBodyHeader: () => 'Narrative Body',
	turnOfEventsHeader: () => 'Turn of Events',
	playerResponseHeader: () => 'Player Response',
	upcomingScenePlotHeader: () => 'Upcoming Scene Plot',
	scenesHeader: () => 'Scenes',
}));
vi.mock('$lib/definitions/common-labels', () => ({ sceneWithNumberLabel: (n: number | string) => `Scene ${n}` }));
// scenes-builder only needs `hasContent` from message-builder; stub it so the test does not
// pull message-builder's heavy transitive graph (narrative-types, pipeline-sections, template-renderer, …),
// which cannot link against the partial common-headers/common-labels mocks above.
vi.mock('../message-builder', () => ({
	hasContent: (v: string | null | undefined): v is string => v != null && v.trim().length > 0,
}));

import { buildScenesSections, buildScenesMessage } from '../scenes-builder';
import type { UIMessage } from '$lib/ai/chat/types';

const assistant = (sceneNumber: number, over: Partial<NonNullable<UIMessage['variables']>> = {}): UIMessage => ({
	id: `a${sceneNumber}`,
	role: 'assistant',
	content: '',
	sceneNumber,
	variables: { sceneTitle: null, background: null, narrativeBody: null, turnOfEvents: null, cg: null, gameData: null, ...over },
});
const user = (sceneNumber: number, content: string): UIMessage => ({ id: `u${sceneNumber}`, role: 'user', content, sceneNumber });

describe('buildScenesSections', () => {
	it('emits one ## Scene block per completed assistant scene, starting at fromScene', () => {
		const messages = [
			assistant(10, { narrativeBody: 'old' }),
			assistant(11, { narrativeBody: 'eleven' }),
			assistant(12, { narrativeBody: 'twelve' }),
		];
		const out = buildScenesSections(messages, 11).join('\n');
		expect(out).toContain('## Scene 11');
		expect(out).toContain('## Scene 12');
		expect(out).not.toContain('## Scene 10'); // below SP ⇒ frozen in the summary, not repeated raw
		expect(out).toContain('eleven');
	});

	it('folds the following player response into the scene block', () => {
		const messages = [assistant(11, { narrativeBody: 'eleven' }), user(12, 'I open the door')];
		const out = buildScenesSections(messages, 11).join('\n');
		expect(out).toContain('### Player Response');
		expect(out).toContain('I open the door');
	});

	it('omits blank fields but keeps the narrative body', () => {
		const messages = [assistant(11, { narrativeBody: 'only body' })];
		const out = buildScenesSections(messages, 11).join('\n');
		expect(out).toContain('### Narrative Body');
		expect(out).not.toContain('### Scene Title');
		expect(out).not.toContain('### Background');
	});

	it('skips assistant messages without a narrative body (incomplete scenes)', () => {
		expect(buildScenesSections([assistant(11)], 11)).toEqual([]);
	});
});

describe('buildScenesMessage', () => {
	it('prefixes the sections with a level-1 Scenes header', () => {
		const msg = buildScenesMessage([assistant(11, { narrativeBody: 'eleven' })], 11);
		expect(msg.startsWith('# Scenes\n\n')).toBe(true);
		expect(msg).toContain('## Scene 11');
	});
});
