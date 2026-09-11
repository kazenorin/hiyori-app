import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryFileSystem } from '$lib/fs/file-system-in-memory';
import { setFileSystem, fs } from '$lib/fs/file-system';

const { mockGenerateActPlot, mockEnsureWorldFile, mockResolveStoryFolder, mockGetLineDir, mockGetActNumber } = vi.hoisted(() => ({
	mockGenerateActPlot: vi.fn(),
	mockEnsureWorldFile: vi.fn(),
	mockResolveStoryFolder: vi.fn(),
	mockGetLineDir: vi.fn(),
	mockGetActNumber: vi.fn(),
}));

vi.mock('$lib/logging/logger', () => ({
	log: { info: vi.fn(async () => {}), error: vi.fn(async () => {}), warn: vi.fn(async () => {}), debug: vi.fn(async () => {}) },
	fileLog: vi.fn(async () => {}),
}));
vi.mock('$lib/ai/act-plot/act-plot-generator', () => ({ generateActPlot: mockGenerateActPlot }));
vi.mock('$lib/ai/world-generator', () => ({ ensureWorldFile: mockEnsureWorldFile }));
vi.mock('$lib/fs/story-folders', () => ({ resolveStoryFolder: mockResolveStoryFolder }));
vi.mock('$lib/ai/card-output-path', () => ({ getLineDir: mockGetLineDir }));
vi.mock('$lib/db/acts', () => ({ getActNumber: mockGetActNumber }));

import { ensureActPlot } from '$lib/ai/act-plot';

const LINE_DIR = '/story/act-1/main-line';
const story = { id: 's1', name: 'Story', locale: 'en', createdAt: 0, updatedAt: 0 };
const actLine = { id: 'line-1', actId: 'act-1', isMainLine: true } as never;

describe('ensureActPlot requirements sidecar', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		setFileSystem(new InMemoryFileSystem());
		mockEnsureWorldFile.mockResolvedValue('WORLD');
		mockResolveStoryFolder.mockResolvedValue('/story');
		mockGetLineDir.mockResolvedValue(LINE_DIR);
		mockGetActNumber.mockResolvedValue(1);
		mockGenerateActPlot.mockResolvedValue('PLOT');
	});

	it('passes the sidecar body to generateActPlot, writes act-plot.md, then deletes the sidecar', async () => {
		await fs.writeTextFileEnsuringDir(`${LINE_DIR}/requirements.md`, '- **Must:** No dragons');

		const result = await ensureActPlot({ story, actLine, actNumber: 1 });

		expect(mockGenerateActPlot.mock.calls[0][0].requirements).toBe('- **Must:** No dragons');
		expect(result).toBe('PLOT');
		expect(await fs.exists(`${LINE_DIR}/act-plot.md`)).toBe(true);
		expect(await fs.exists(`${LINE_DIR}/requirements.md`)).toBe(false);
	});

	it('passes an empty requirements string and still generates when no sidecar exists', async () => {
		await ensureActPlot({ story, actLine, actNumber: 1 });
		// A missing sidecar reads as '' by contract, which the generator's trim-guard omits downstream.
		expect(mockGenerateActPlot.mock.calls[0][0].requirements).toBe('');
		expect(await fs.exists(`${LINE_DIR}/act-plot.md`)).toBe(true);
	});

	it('returns the existing plot without generating when act-plot.md is already present', async () => {
		await fs.writeTextFileEnsuringDir(`${LINE_DIR}/act-plot.md`, 'EXISTING');
		const result = await ensureActPlot({ story, actLine, actNumber: 1 });
		expect(result).toBe('EXISTING');
		expect(mockGenerateActPlot).not.toHaveBeenCalled();
	});
});
