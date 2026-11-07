import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { UIMessage } from '#lib/ai/chat/types.ts';

const mockGetLatestActShortSummaryEntry = vi.fn();
const mockUpdateActShortSummary = vi.fn();
const mockGetActLine = vi.fn();
const mockTraceActLineChain = vi.fn();

vi.mock('#lib/db/act-lines.ts', () => ({
	getLatestActShortSummaryEntry: (...args: unknown[]) => mockGetLatestActShortSummaryEntry(...args),
	updateActShortSummary: (...args: unknown[]) => mockUpdateActShortSummary(...args),
	getActLine: (...args: unknown[]) => mockGetActLine(...args),
}));
vi.mock('#lib/db/acts.ts', () => ({
	traceActLineChain: (...args: unknown[]) => mockTraceActLineChain(...args),
}));
vi.mock('#lib/db/database.ts', () => ({
	getDatabase: () => ({ select: vi.fn(async () => []), execute: vi.fn(async () => ({ rowsAffected: 0 })) }),
}));

import { resolveScenePlot, getStorySoFar, saveActShortSummary } from '#lib/features/context-manager.ts';

function msg(id: string, sceneNumber: number, scenePlot?: string): UIMessage {
	return { id, role: 'assistant', content: '', sceneNumber, scenePlot };
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('resolveScenePlot', () => {
	const messages = [msg('m1', 1, 'Plot one'), msg('m2', 2), msg('m3', 3, 'Plot three')];

	it('guidance mode resolves the clicked scene and marks it editable when it is the latest scene', () => {
		expect(resolveScenePlot(messages, 3, 'guidance', 3)).toEqual({
			messageId: 'm3',
			scenePlot: 'Plot three',
			ownerSceneNumber: 3,
			editable: true,
		});
	});

	it('guidance mode returns null when the clicked scene has no plot', () => {
		expect(resolveScenePlot(messages, 2, 'guidance', 3)).toBeNull();
	});

	it('phaseEvent mode resolves a DIFFERENT scene than the one clicked, and reports the owner honestly', () => {
		// The carry-forward writes only pipeline state, never the message row, so only every Nth
		// message carries a plot. Showing scene 4's plot for a scene-7 click is correct, not a bug.
		expect(resolveScenePlot(messages, 2, 'phaseEvent', 3)).toEqual({
			messageId: 'm3',
			scenePlot: 'Plot three',
			ownerSceneNumber: 3,
			editable: true,
		});
	});

	it('is read-only when the owner scene is not the act line latest scene', () => {
		const result = resolveScenePlot(messages, 2, 'phaseEvent', 5);
		expect(result?.ownerSceneNumber).toBe(3);
		expect(result?.editable).toBe(false);
	});

	it('is read-only when the latest scene number is unknown', () => {
		expect(resolveScenePlot(messages, 3, 'guidance', null)?.editable).toBe(false);
	});

	it('treats an empty-string plot as absent rather than offering an editable blank', () => {
		expect(resolveScenePlot([msg('m1', 1, '')], 1, 'guidance', 1)).toBeNull();
	});

	it('returns null on an empty message list', () => {
		expect(resolveScenePlot([], 1, 'phaseEvent', 1)).toBeNull();
	});
});

describe('getStorySoFar', () => {
	it('lists exactly what the pipeline sends: ancestors only, newest act first', async () => {
		// traceActLineChain returns ascending; run-manager does .slice(0, -1) over it.
		mockTraceActLineChain.mockResolvedValue([
			{ actLineId: 'line-1', actNumber: 1, isMainLine: true },
			{ actLineId: 'line-2', actNumber: 2, isMainLine: true },
			{ actLineId: 'line-3', actNumber: 3, isMainLine: true },
		]);
		mockGetActLine.mockImplementation(async (id: string) => ({ id, name: `Name ${id}`, isMainLine: true }));
		mockGetLatestActShortSummaryEntry.mockImplementation(async (id: string) => ({
			eventId: `evt-${id}`,
			value: `Summary for ${id}. [2 scenes]`,
		}));

		const entries = await getStorySoFar('line-3');

		expect(entries.map((e) => e.actNumber)).toEqual([2, 1]);
		expect(entries[0]).toEqual({
			eventId: 'evt-line-2',
			actLineId: 'line-2',
			actNumber: 2,
			lineName: 'Name line-2',
			isMainLine: true,
			value: 'Summary for line-2. [2 scenes]',
		});
		// The current act must never be queried — the pipeline does not send it as previous context.
		expect(mockGetLatestActShortSummaryEntry).not.toHaveBeenCalledWith('line-3');
	});

	it('skips ancestors with no summary row, exactly as the pipeline skips them', async () => {
		mockTraceActLineChain.mockResolvedValue([
			{ actLineId: 'line-1', actNumber: 1, isMainLine: true },
			{ actLineId: 'line-2', actNumber: 2, isMainLine: false },
		]);
		mockGetActLine.mockResolvedValue({ id: 'line-1', name: 'Act One Line', isMainLine: true });
		mockGetLatestActShortSummaryEntry.mockResolvedValue(null);

		expect(await getStorySoFar('line-2')).toEqual([]);
	});

	it('returns an empty list for a first act, which has no ancestors', async () => {
		mockTraceActLineChain.mockResolvedValue([{ actLineId: 'line-1', actNumber: 1, isMainLine: true }]);
		expect(await getStorySoFar('line-1')).toEqual([]);
		expect(mockGetLatestActShortSummaryEntry).not.toHaveBeenCalled();
	});

	it('preserves the branch flag so the panel can distinguish a divergent ancestor', async () => {
		mockTraceActLineChain.mockResolvedValue([
			{ actLineId: 'line-1', actNumber: 1, isMainLine: false },
			{ actLineId: 'line-2', actNumber: 2, isMainLine: true },
		]);
		mockGetActLine.mockResolvedValue({ id: 'line-1', name: 'Branch Line', isMainLine: false });
		mockGetLatestActShortSummaryEntry.mockResolvedValue({ eventId: 'evt-1', value: 'Branch summary' });

		const entries = await getStorySoFar('line-2');
		expect(entries[0].isMainLine).toBe(false);
		expect(entries[0].lineName).toBe('Branch Line');
		expect(entries[0].value).toBe('Branch summary');
	});
});

describe('saveActShortSummary', () => {
	// The stored value is opaque: nothing else in the system parses it, so the whole string is
	// editable and must round-trip verbatim. D5 is satisfied by never regenerating any part of it.
	it('writes a value carrying a scene-count marker back unchanged', async () => {
		await saveActShortSummary('evt-1', 'The party fled north. [3 scenes]');
		expect(mockUpdateActShortSummary).toHaveBeenCalledWith('evt-1', 'The party fled north. [3 scenes]');
	});

	it('writes a value with no marker back unchanged', async () => {
		await saveActShortSummary('evt-1', 'The party fled north.');
		expect(mockUpdateActShortSummary).toHaveBeenCalledWith('evt-1', 'The party fled north.');
	});

	it('trims surrounding whitespace, matching the generator own normalization', async () => {
		await saveActShortSummary('evt-1', '  The party fled north. [3 scenes]  \n');
		expect(mockUpdateActShortSummary).toHaveBeenCalledWith('evt-1', 'The party fled north. [3 scenes]');
	});

	it('keeps a trailing bracket group that is prose editable instead of classifying it as a marker', async () => {
		// The old split matched ANY trailing bracket group and peeled it into a read-only field, so
		// a prose aside could never be edited. Read then save: the whole string must survive both.
		mockTraceActLineChain.mockResolvedValue([
			{ actLineId: 'line-1', actNumber: 1, isMainLine: true },
			{ actLineId: 'line-2', actNumber: 2, isMainLine: true },
		]);
		mockGetActLine.mockResolvedValue({ id: 'line-1', name: 'Act One', isMainLine: true });
		mockGetLatestActShortSummaryEntry.mockResolvedValue({ eventId: 'evt-1', value: 'The gate fell. [unresolved]' });

		const [entry] = await getStorySoFar('line-2');
		expect(entry.value).toBe('The gate fell. [unresolved]');

		await saveActShortSummary(entry.eventId, entry.value);
		expect(mockUpdateActShortSummary).toHaveBeenCalledWith('evt-1', 'The gate fell. [unresolved]');
	});

	it('does not swallow a write failure — the caller must surface it', async () => {
		mockUpdateActShortSummary.mockRejectedValue(new Error('db locked'));
		await expect(saveActShortSummary('evt-1', 'body')).rejects.toThrow('db locked');
	});
});
