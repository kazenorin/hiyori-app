import type { OutputDescriptor, MatchDescriptor, HeaderMatch, ListMatch, ListItemMatch, ListLabeledItemMatch } from './types';
import { set } from 'lodash-es';
import { marked } from 'marked';

export function parseContent<T = Record<string, unknown>>(content: string, descriptors?: OutputDescriptor[]): T;
export function parseContent<T>(content: string, descriptors: OutputDescriptor[], output: T): T;

export function parseContent(
	content: string,
	descriptors: OutputDescriptor[] = [],
	output?: Record<string, unknown>
): Record<string, unknown> {
	const target = output ?? {};

	if (descriptors.length > 0) {
		for (const descriptor of descriptors) {
			if (descriptor.match) {
				const value = extractValue(content, descriptor.match, {
					bodyOnly: descriptor.bodyOnly ?? false,
					currentLevelOnly: descriptor.currentLevelOnly ?? false,
				});
				set(target, descriptor.outputPath, value);
			} else {
				set(target, descriptor.outputPath, content);
			}
		}
	} else {
		set(target, 'output', content);
	}

	return target;
}

interface ExtractionOptions {
	bodyOnly: boolean;
	currentLevelOnly: boolean;
}

interface ListItemToken {
	raw: string;
	text: string;
	tokens?: { type: string; text?: string }[];
}

function extractValue(content: string, match: MatchDescriptor, options: ExtractionOptions): unknown {
	switch (match.type) {
		case 'list':
			return extractList(content, match, options);
		case 'list_item':
			return extractListItem(content, match, options);
		case 'list_labeled_item':
			return extractLabeledListItem(content, match, options);
		case 'header':
			return extractHeader(content, match, options);
	}
}

function resolveSourceContent(content: string, parent: MatchDescriptor | undefined): string {
	if (!parent) return content;
	if (parent.type === 'header') {
		const sections = splitByHeaders(content);
		const parentSection = sections.find((s) => s.header.toLowerCase() === (parent.content?.toLowerCase() ?? ''));
		return parentSection ? content.slice(parentSection.rawStart, parentSection.rawEnd) : content;
	}
	return content;
}

function extractList(content: string, match: ListMatch, options: ExtractionOptions): string[] {
	let sourceContent = resolveSourceContent(content, match.parent);

	if (match.parent?.type === 'list_item') {
		const parentRef = match.parent;
		const tokens = marked.lexer(sourceContent);
		const lists = tokens.filter((t) => t.type === 'list');
		const parentListIndex = parentRef.listIndex ?? 0;
		const parentList = lists[parentListIndex];
		if (!parentList || !('items' in parentList) || !Array.isArray(parentList.items)) return [];
		const itemIndex = parentRef.itemIndex ?? 0;
		const item = parentList.items[itemIndex] as ListItemToken | undefined;
		if (!item) return [];
		sourceContent = item.text;
	}

	const tokens = marked.lexer(sourceContent);
	const lists = tokens.filter((t) => t.type === 'list');
	const listIndex = match.listIndex ?? 0;
	const target = lists[listIndex];
	if (!target || !('items' in target) || !Array.isArray(target.items)) return [];

	return target.items.map((item: ListItemToken) => {
		if (options.bodyOnly) {
			if (options.currentLevelOnly && item.tokens) {
				return item.tokens
					.filter((t) => t.type !== 'list')
					.map((t) => t.text ?? '')
					.join('')
					.trim();
			}
			return item.text.trim();
		}
		return item.raw.replace(/\n$/, '');
	});
}

function extractListItem(content: string, match: ListItemMatch, options: ExtractionOptions): unknown {
	const sourceContent = resolveSourceContent(content, match.parent);

	const tokens = marked.lexer(sourceContent);
	const lists = tokens.filter((t) => t.type === 'list');
	const listIndex = match.parent?.type === 'list' ? (match.parent.listIndex ?? 0) : 0;
	const target = lists[listIndex];
	if (!target || !('items' in target) || !Array.isArray(target.items)) return null;

	const itemIndex = match.itemIndex ?? 0;
	const item = target.items[itemIndex] as ListItemToken | undefined;
	if (!item) return null;

	if (options.bodyOnly) return item.text.trim();
	return item.raw.replace(/\n$/, '');
}

function extractLabeledListItem(content: string, match: ListLabeledItemMatch, options: ExtractionOptions): unknown {
	const sourceContent = resolveSourceContent(content, match.parent);

	const tokens = marked.lexer(sourceContent);
	const lists = tokens.filter((t) => t.type === 'list');
	const listIndex = match.listIndex ?? (match.parent?.type === 'list' ? (match.parent.listIndex ?? 0) : 0);
	const target = lists[listIndex];
	if (!target || !('items' in target) || !Array.isArray(target.items)) return null;

	const label = (match.content ?? '').toLowerCase();
	const item = target.items.find((item: ListItemToken) => item.text.toLowerCase().startsWith(label + ':'));
	if (!item) return null;

	if (options.bodyOnly) {
		const colonIndex = item.text.indexOf(':');
		if (colonIndex === -1) return null;
		return item.text.slice(colonIndex + 1).trim();
	}
	return item.raw.replace(/\n$/, '');
}

function extractHeader(content: string, match: HeaderMatch, options: ExtractionOptions): unknown {
	const sections = splitByHeaders(content);
	const matched = findSection(sections, match);

	if (!matched) return null;

	let sectionContent: string;
	let sectionBody: string;

	if (options.currentLevelOnly) {
		const ownEnd = findOwnContentEnd(sections, matched, content);
		sectionContent = content.slice(matched.rawStart, ownEnd).trim();
		const headerEnd = sectionContent.indexOf('\n');
		sectionBody = headerEnd >= 0 ? sectionContent.slice(headerEnd + 1).trim() : '';
	} else {
		sectionContent = `${matched.headerMarkdown}\n${matched.body}`.trim();
		sectionBody = matched.body;
	}

	if (match.children && match.children.length > 0) {
		const childSource = options.currentLevelOnly ? sectionContent : content.slice(matched.rawStart, matched.rawEnd);
		return parseContent(childSource, match.children);
	}

	if (options.bodyOnly) return sectionBody;
	return sectionContent;
}

function findOwnContentEnd(sections: MarkdownSection[], section: MarkdownSection, content: string): number {
	const next = sections.filter((s) => s.rawStart > section.rawStart).sort((a, b) => a.rawStart - b.rawStart)[0];
	return next ? next.rawStart : content.length;
}

function findSection(sections: MarkdownSection[], match: HeaderMatch): MarkdownSection | undefined {
	let candidates = sections.filter((s) => s.header.toLowerCase() === match.content?.toLowerCase()).sort((a, b) => a.rawStart - b.rawStart);

	if (match.headerLevel !== undefined) {
		candidates = candidates.filter((s) => s.depth === match.headerLevel);
	}

	if (match.parent && match.parent.type === 'header') {
		const parentRef = match.parent;
		const parentSections = sections.filter((s) => s.header.toLowerCase() === parentRef.content?.toLowerCase());
		for (const parent of parentSections) {
			const child = candidates.find((c) => c.startIndex > parent.startIndex && c.depth > parent.depth && c.rawStart < parent.rawEnd);
			if (child) return child;
		}
		return undefined;
	}

	if (match.ancestor && match.ancestor.type === 'header') {
		const ancestorRef = match.ancestor;
		const ancestorSections = sections.filter((s) => s.header.toLowerCase() === ancestorRef.content?.toLowerCase());
		for (const ancestor of ancestorSections) {
			const child = candidates.find((c) => c.startIndex > ancestor.startIndex && c.depth > ancestor.depth && c.group === ancestor.group);
			if (child) return child;
		}
		return undefined;
	}

	return candidates[0];
}

interface MarkdownSection {
	header: string;
	headerMarkdown: string;
	body: string;
	depth: number;
	startIndex: number;
	rawStart: number;
	rawEnd: number;
	group: number;
}

interface MarkdownSectionBuilder extends MarkdownSection {
	bodyClosed: boolean;
}

function splitByHeaders(content: string): MarkdownSection[] {
	const tokens = marked.lexer(content);
	const sections: MarkdownSection[] = [];
	const stack: MarkdownSectionBuilder[] = [];
	let index = 0;
	let group = 0;
	let offset = 0;

	for (const token of tokens) {
		const raw = 'raw' in token ? (token as { raw: string }).raw : '';
		const tokenStart = offset;

		if (token.type === 'heading') {
			const headerText = token.text ?? '';
			const depth = token.depth ?? 1;
			const headerMarkdown = '#'.repeat(depth) + ' ' + headerText;
			index++;

			const stackSizeBefore = stack.length;
			while (stack.length > 0 && stack[stack.length - 1]!.depth >= depth) {
				const popped = stack.pop()!;
				popped.rawEnd = tokenStart;
				sections.push(popped);
			}

			if (stack.length > 0 && stack.length < stackSizeBefore) {
				for (const section of stack) {
					section.bodyClosed = true;
				}
			}

			if (stack.length === 0 && stackSizeBefore > 0) {
				group++;
			}

			const section: MarkdownSectionBuilder = {
				header: headerText,
				headerMarkdown,
				body: '',
				depth,
				startIndex: index - 1,
				rawStart: tokenStart,
				rawEnd: content.length,
				group,
				bodyClosed: false,
			};

			if (stack.length > 0) {
				for (const parent of stack) {
					if (parent.bodyClosed) continue;
					parent.body += (parent.body ? '\n' : '') + headerMarkdown;
				}
			}

			stack.push(section);
		} else if (token.type === 'hr') {
			if (stack.length > 0) {
				for (const section of stack) {
					if (section.bodyClosed) continue;
					section.body += (section.body ? '\n' : '') + raw.trim();
				}
			} else {
				group++;
			}
		} else if (stack.length > 0) {
			for (const section of stack) {
				if (section.bodyClosed) continue;
				section.body += (section.body ? '\n' : '') + raw.trim();
			}
		}

		offset += raw.length;
	}

	while (stack.length > 0) {
		sections.push(stack.pop()!);
	}

	return sections;
}
