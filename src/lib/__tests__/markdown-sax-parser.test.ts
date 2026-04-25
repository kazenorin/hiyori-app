import { describe, it, expect } from 'vitest';
import { createMarkdownSaxParser, type ElementInfo, type ContextNode } from '../markdown/markdown-sax-parser';

interface Event {
	event: 'enter' | 'leave' | 'text';
	data: ElementInfo | string;
	context: readonly ContextNode[];
}

function feedAll(chunks: string[]): Event[] {
	const events: Event[] = [];
	const parser = createMarkdownSaxParser({
		onEnterElement: (el, ctx) => events.push({ event: 'enter', data: el, context: [...ctx] }),
		onLeaveElement: (el, ctx) => events.push({ event: 'leave', data: el, context: [...ctx] }),
		onText: (text, ctx) => events.push({ event: 'text', data: text, context: [...ctx] }),
	});
	for (const chunk of chunks) {
		parser.feed(chunk);
	}
	parser.flush();
	return events;
}

function enters(events: Event[], type: string): Event[] {
	return events.filter((e) => e.event === 'enter' && (e.data as ElementInfo).type === type);
}

function leaves(events: Event[], type: string): Event[] {
	return events.filter((e) => e.event === 'leave' && (e.data as ElementInfo).type === type);
}

function texts(events: Event[]): string {
	return events
		.filter((e) => e.event === 'text')
		.map((e) => e.data as string)
		.join('');
}

describe('MarkdownSaxParser', () => {
	describe('basic element recognition', () => {
		it('emits root enter/leave for empty input', () => {
			const events = feedAll([]);
			const rootEnters = enters(events, 'root');
			const rootLeaves = leaves(events, 'root');
			expect(rootEnters).toHaveLength(1);
			expect(rootLeaves).toHaveLength(1);
			expect(rootEnters[0].data).toEqual({ type: 'root', depth: 0 });
		});

		it('parses H1 header with name', () => {
			const events = feedAll(['# Title\n']);
			const h1 = enters(events, 'header');
			expect(h1).toHaveLength(1);
			expect(h1[0].data).toEqual({ type: 'header', depth: 1, headerLevel: 1, name: 'Title' });
		});

		it('parses all header levels H1-H6', () => {
			for (let level = 1; level <= 6; level++) {
				const prefix = '#'.repeat(level);
				const events = feedAll([`${prefix} Test\n`]);
				const h = enters(events, 'header');
				expect(h).toHaveLength(1);
				expect(h[0].data).toEqual({ type: 'header', depth: level, headerLevel: level, name: 'Test' });
			}
		});

		it('parses unordered list with - marker', () => {
			const events = feedAll(['- Item 1\n']);
			const list = enters(events, 'list');
			expect(list).toHaveLength(1);
			expect(list[0].data).toEqual({ type: 'list', depth: 2, listLevel: 1, ordered: false });
		});

		it('parses unordered list with * marker', () => {
			const events = feedAll(['* Item A\n']);
			const list = enters(events, 'list');
			expect(list).toHaveLength(1);
			expect(list[0].data).toEqual({ type: 'list', depth: 2, listLevel: 1, ordered: false });
		});

		it('parses ordered list', () => {
			const events = feedAll(['1. First\n']);
			const list = enters(events, 'list');
			expect(list).toHaveLength(1);
			expect(list[0].data).toEqual({ type: 'list', depth: 2, listLevel: 1, ordered: true });
		});

		it('parses ordered list with multi-digit number', () => {
			const events = feedAll(['10. Tenth item\n']);
			const list = enters(events, 'list');
			expect(list).toHaveLength(1);
			expect(list[0].data).toEqual({ type: 'list', depth: 2, listLevel: 1, ordered: true });
		});

		it('recognizes --- as horizontal rule', () => {
			const events = feedAll(['---\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('recognizes *** as horizontal rule', () => {
			const events = feedAll(['***\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('recognizes ___ as horizontal rule', () => {
			const events = feedAll(['___\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('recognizes ---- as horizontal rule', () => {
			const events = feedAll(['----\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('streams plain text immediately', () => {
			const events = feedAll(['Hello world\n']);
			expect(texts(events)).toBe('Hello world\n');
		});
	});

	describe('implicit page', () => {
		it('creates page before first content', () => {
			const events = feedAll(['Some text\n']);
			const pageEnters = enters(events, 'page');
			expect(pageEnters).toHaveLength(1);
			// Page enters before text
			const pageEnterIdx = events.findIndex((e) => e.event === 'enter' && (e.data as ElementInfo).type === 'page');
			const textIdx = events.findIndex((e) => e.event === 'text');
			expect(pageEnterIdx).toBeLessThan(textIdx);
		});

		it('does not create page for empty input', () => {
			const events = feedAll([]);
			expect(enters(events, 'page')).toHaveLength(0);
		});
	});

	describe('header transitions', () => {
		it('H1 then H2 creates child', () => {
			const events = feedAll(['# Chapter\n## Section\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(2);
			expect(headers[0].data).toEqual({ type: 'header', depth: 1, headerLevel: 1, name: 'Chapter' });
			expect(headers[1].data).toEqual({ type: 'header', depth: 2, headerLevel: 2, name: 'Section' });
		});

		it('H2 then H1 closes H2', () => {
			const events = feedAll(['# One\n## Sub\n# Two\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(3);
			expect(headers[0].data).toEqual(expect.objectContaining({ headerLevel: 1, name: 'One' }));
			expect(headers[1].data).toEqual(expect.objectContaining({ headerLevel: 2, name: 'Sub' }));
			expect(headers[2].data).toEqual(expect.objectContaining({ headerLevel: 1, name: 'Two' }));
			// H2 leaves before H1 enters
			const subLeave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).headerLevel === 2);
			const twoEnter = events.findIndex((e) => e.event === 'enter' && (e.data as ElementInfo).name === 'Two');
			expect(subLeave).toBeLessThan(twoEnter);
		});

		it('H2 H3 H2 closes H3 then H2 for sibling', () => {
			const events = feedAll(['## A\n### B\n## C\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(3);
			// H3 B should be closed, then H2 A closed, then H2 C opens
			const h3Leave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).headerLevel === 3);
			const h2ALeave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).name === 'A');
			const h2CEnter = events.findIndex((e) => e.event === 'enter' && (e.data as ElementInfo).name === 'C');
			expect(h3Leave).toBeLessThan(h2ALeave);
			expect(h2ALeave).toBeLessThan(h2CEnter);
		});

		it('H1 to H3 skips H2', () => {
			const events = feedAll(['# Top\n### Deep\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(2);
			expect(headers[1].data).toEqual(expect.objectContaining({ headerLevel: 3, name: 'Deep' }));
		});

		it('closes list before opening header', () => {
			const events = feedAll(['- item\n# Header\n']);
			const listLeave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).type === 'list');
			const headerEnter = events.findIndex((e) => e.event === 'enter' && (e.data as ElementInfo).type === 'header');
			expect(listLeave).toBeLessThan(headerEnter);
		});
	});

	describe('list transitions', () => {
		it('two items at same indentation are siblings', () => {
			const events = feedAll(['- A\n- B\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(2);
			// First list leaves, second enters as sibling
			const firstLeave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).listLevel === 1);
			const secondEnter = events.indexOf(listEnters[1]);
			expect(firstLeave).toBeLessThan(secondEnter);
		});

		it('nested list with more indentation is child', () => {
			const events = feedAll(['- Outer\n  - Inner\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(2);
			expect(listEnters[0].data).toEqual(expect.objectContaining({ listLevel: 1 }));
			expect(listEnters[1].data).toEqual(expect.objectContaining({ listLevel: 2 }));
		});

		it('less indentation closes nested list', () => {
			const events = feedAll(['- A\n  - B\n- C\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(3);
			expect(listEnters[2].data).toEqual(expect.objectContaining({ listLevel: 1 }));
		});

		it('tab counts as 3 spaces', () => {
			const events = feedAll(['- A\n\t- B\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(2);
			expect(listEnters[1].data).toEqual(expect.objectContaining({ listLevel: 2 }));
		});

		it('mixed ordered and unordered', () => {
			const events = feedAll(['- Unordered\n1. Ordered\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(2);
			expect(listEnters[0].data).toEqual(expect.objectContaining({ ordered: false }));
			expect(listEnters[1].data).toEqual(expect.objectContaining({ ordered: true }));
		});

		it('triple-nested then back to first level', () => {
			const events = feedAll(['- L1\n  - L2\n    - L3\n- Back\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(4);
			expect(listEnters[0].data).toEqual(expect.objectContaining({ listLevel: 1 }));
			expect(listEnters[1].data).toEqual(expect.objectContaining({ listLevel: 2 }));
			expect(listEnters[2].data).toEqual(expect.objectContaining({ listLevel: 3 }));
			expect(listEnters[3].data).toEqual(expect.objectContaining({ listLevel: 1 }));
		});
	});

	describe('horizontal rule transitions', () => {
		it('closes all contexts and creates new page', () => {
			const events = feedAll(['# Header\n---\n# New Section\n']);
			const pages = enters(events, 'page');
			expect(pages).toHaveLength(2);
			// Header from page 1 leaves before HR
			const headerLeave = events.findIndex((e) => e.event === 'leave' && (e.data as ElementInfo).type === 'header');
			expect(headerLeave).toBeGreaterThan(-1);
		});

		it('multiple rules create multiple pages', () => {
			const events = feedAll(['Text\n---\nMore\n---\nEnd\n']);
			expect(enters(events, 'page')).toHaveLength(3);
		});
	});

	describe('context reporting', () => {
		it('header context includes name', () => {
			const events = feedAll(['## My Header\n']);
			const headerEnter = events.find((e) => e.event === 'enter' && (e.data as ElementInfo).type === 'header')!;
			const ctx = headerEnter.context;
			const headerCtx = ctx.find((c) => c.type === 'header');
			expect(headerCtx?.name).toBe('My Header');
		});

		it('text event reports current context stack', () => {
			const events = feedAll(['# Title\nSome content\n']);
			const textEvent = events.find((e) => e.event === 'text' && (e.data as string) === 'S');
			expect(textEvent).toBeDefined();
			const ctx = textEvent!.context;
			expect(ctx.some((c) => c.type === 'root')).toBe(true);
			expect(ctx.some((c) => c.type === 'page')).toBe(true);
			expect(ctx.some((c) => c.type === 'header' && c.name === 'Title')).toBe(true);
		});

		it('list context includes list level and ordered flag', () => {
			const events = feedAll(['- item\n']);
			const listEnter = events.find((e) => e.event === 'enter' && (e.data as ElementInfo).type === 'list')!;
			const ctx = listEnter.context;
			const listCtx = ctx.find((c) => c.type === 'list');
			expect(listCtx?.listLevel).toBe(1);
			expect(listCtx?.ordered).toBe(false);
		});

		it('nested list reports full hierarchy', () => {
			const events = feedAll(['## Section\n- item\n  - nested\n']);
			const nestedEnter = events.find(
				(e) => e.event === 'enter' && (e.data as ElementInfo).type === 'list' && (e.data as ElementInfo).listLevel === 2
			)!;
			expect(nestedEnter).toBeDefined();
			const ctx = nestedEnter.context;
			expect(ctx.filter((c) => c.type === 'list')).toHaveLength(2);
			expect(ctx.some((c) => c.type === 'header')).toBe(true);
		});
	});

	describe('streaming and chunking', () => {
		it('handles full document in one chunk', () => {
			const doc = '# Title\nSome text\n## Sub\n- item\n---\n# Page 2\n';
			const events = feedAll([doc]);
			expect(enters(events, 'page')).toHaveLength(2);
			expect(enters(events, 'header')).toHaveLength(3);
			expect(enters(events, 'list')).toHaveLength(1);
		});

		it('handles document split across arbitrary chunks', () => {
			const chunks = ['# ', 'Title\n', 'Some ', 'text\n', '## ', 'Sub\n'];
			const events = feedAll(chunks);
			expect(enters(events, 'header')).toHaveLength(2);
			expect(texts(events)).toContain('Some text\n');
		});

		it('handles header split mid-name', () => {
			const events = feedAll(['# Hea', 'der\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(1);
			expect(headers[0].data).toEqual(expect.objectContaining({ name: 'Header' }));
		});

		it('handles structural char at chunk boundary', () => {
			const events = feedAll(['text\n', '# Title\n']);
			expect(texts(events)).toContain('text\n');
			expect(enters(events, 'header')).toHaveLength(1);
		});

		it('streams text chars immediately', () => {
			const events = feedAll(['H', 'e', 'l', 'l', 'o']);
			const textEvents = events.filter((e) => e.event === 'text');
			expect(textEvents).toHaveLength(5);
			expect(texts(events)).toBe('Hello');
		});

		it('streams text chars in list immediately', () => {
			const events = feedAll([' - He', 'll', 'o']);
			const textEvents = events.filter((e) => e.event === 'text');
			expect(textEvents).toHaveLength(3);
			expect(textEvents[0].data).toBe('He');
			expect(textEvents[1].data).toBe('ll');
			expect(texts(events)).toBe('Hello');
		});
	});

	describe('edge cases', () => {
		it('#nope without space is text', () => {
			const events = feedAll(['#nope\n']);
			expect(enters(events, 'header')).toHaveLength(0);
			expect(texts(events)).toContain('#nope\n');
		});

		it('7 hashes is text', () => {
			const events = feedAll(['####### not a header\n']);
			expect(enters(events, 'header')).toHaveLength(0);
			expect(texts(events)).toContain('#######');
		});

		it('disambiguates - text from ---', () => {
			const events = feedAll(['- list item\n---\n']);
			expect(enters(events, 'list')).toHaveLength(1);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('flush processes unterminated line', () => {
			const events = feedAll(['# Header']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(1);
			expect(headers[0].data).toEqual(expect.objectContaining({ name: 'Header' }));
		});

		it('flush streams unterminated text', () => {
			const events = feedAll(['Hello']);
			expect(texts(events)).toBe('Hello');
		});

		it('whitespace-only line is text', () => {
			const events = feedAll(['   \n']);
			expect(texts(events)).toContain('   \n');
		});

		it('header with trailing whitespace trims name', () => {
			const events = feedAll(['# Title   \n']);
			const headers = enters(events, 'header');
			expect(headers[0].data).toEqual(expect.objectContaining({ name: 'Title' }));
		});

		it('header with empty content', () => {
			const events = feedAll(['# \n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(1);
			expect(headers[0].data).toEqual(expect.objectContaining({ name: '' }));
		});

		it('indented header is recognized', () => {
			const events = feedAll(['  ## Indented\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(1);
			expect(headers[0].data).toEqual(expect.objectContaining({ headerLevel: 2, name: 'Indented' }));
		});

		it('consecutive horizontal rules', () => {
			const events = feedAll(['---\n---\n']);
			expect(enters(events, 'page')).toHaveLength(3);
		});

		it('- - - is horizontal rule', () => {
			const events = feedAll(['- - -\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('indented --- is horizontal rule', () => {
			const events = feedAll(['  ---\n']);
			expect(enters(events, 'page')).toHaveLength(2);
		});

		it('indented ordered list', () => {
			const events = feedAll(['  1. Nested\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(1);
			expect(listEnters[0].data).toEqual(expect.objectContaining({ listLevel: 1, ordered: true }));
		});

		it('ordered list nested inside unordered list', () => {
			const events = feedAll(['- item\n  1. nested ordered\n']);
			const listEnters = enters(events, 'list');
			expect(listEnters).toHaveLength(2);
			expect(listEnters[0].data).toEqual(expect.objectContaining({ ordered: false, listLevel: 1 }));
			expect(listEnters[1].data).toEqual(expect.objectContaining({ ordered: true, listLevel: 2 }));
		});

		it('consecutive headers with no text between', () => {
			const events = feedAll(['## A\n## B\n']);
			const headers = enters(events, 'header');
			expect(headers).toHaveLength(2);
			// Sibling headers: A must leave before B enters
			const aLeave = events.findIndex(
				(e) => e.event === 'leave' && (e.data as ElementInfo).type === 'header' && (e.data as ElementInfo).headerLevel === 2
			);
			const bEnter = events.indexOf(headers[1]);
			expect(aLeave).toBeLessThan(bEnter);
		});

		it('flush with no feed emits only root', () => {
			const events = feedAll(['']);
			const rootEnters = enters(events, 'root');
			const rootLeaves = leaves(events, 'root');
			expect(rootEnters).toHaveLength(1);
			expect(rootLeaves).toHaveLength(1);
			expect(enters(events, 'page')).toHaveLength(0);
		});
	});
});
