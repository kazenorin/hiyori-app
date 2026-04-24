export type ElementType = 'root' | 'page' | 'header' | 'list';

export interface ContextNode {
	type: ElementType;
	depth: number;
	headerLevel?: number;
	name?: string;
	listLevel?: number;
	ordered?: boolean;
	indentation?: number;
}

export interface ElementInfo {
	type: ElementType;
	depth: number;
	headerLevel?: number;
	name?: string;
	listLevel?: number;
	ordered?: boolean;
}

export interface MarkdownSaxCallbacks {
	onEnterElement: (element: ElementInfo, context: readonly ContextNode[]) => void;
	onLeaveElement: (element: ElementInfo, context: readonly ContextNode[]) => void;
	onText: (text: string, context: readonly ContextNode[]) => void;
}

export interface MarkdownSaxParser {
	feed(chunk: string): void;
	flush(): void;
}

type ClassifiedLine =
	| { kind: 'header'; level: number; name: string }
	| { kind: 'ulist'; content: string; indentation: number }
	| { kind: 'olist'; content: string; indentation: number }
	| { kind: 'hr' }
	| { kind: 'text'; content: string };

const HR_REGEX = /^([-_*])(?:\s*\1){2,}\s*$/;
const ORDERED_LIST_REGEX = /^(\d+)\.\s(.*)$/;

function countIndentation(line: string): { spaces: number; rest: string } {
	let spaces = 0;
	let i = 0;
	for (; i < line.length; i++) {
		if (line[i] === '\t') {
			spaces += 3;
		} else if (line[i] === ' ') {
			spaces += 1;
		} else {
			break;
		}
	}
	return { spaces, rest: line.slice(i) };
}

function classifyLine(line: string): ClassifiedLine {
	const { spaces: indentation, rest } = countIndentation(line);

	// Header: 1-6 # followed by space
	if (rest.length >= 2 && rest[0] === '#') {
		let level = 0;
		for (let i = 0; i < rest.length && i < 6; i++) {
			if (rest[i] === '#') level++;
			else break;
		}
		if (level >= 1 && level <= 6 && rest.length > level && rest[level] === ' ') {
			const name = rest.slice(level + 1).trimEnd();
			return { kind: 'header', level, name };
		}
	}

	// Unordered list: - or * followed by space (with HR disambiguation)
	if (rest.length >= 2 && (rest[0] === '-' || rest[0] === '*') && rest[1] === ' ') {
		if (HR_REGEX.test(rest)) return { kind: 'hr' };
		return { kind: 'ulist', content: rest.slice(2), indentation };
	}

	// Horizontal rule: 3+ same chars with optional spaces
	if (HR_REGEX.test(rest)) return { kind: 'hr' };

	// Ordered list: digits followed by . and space
	const olMatch = rest.match(ORDERED_LIST_REGEX);
	if (olMatch) return { kind: 'olist', content: olMatch[2], indentation };

	return { kind: 'text', content: line };
}

function stripTrailingNewline(s: string): string {
	if (s.endsWith('\r\n')) return s.slice(0, -2);
	if (s.endsWith('\n')) return s.slice(0, -1);
	return s;
}

function isStructuralStartChar(ch: string): boolean {
	return ch === '#' || ch === '-' || ch === '*' || ch === '_' || (ch >= '0' && ch <= '9');
}

function toElementInfo(node: ContextNode): ElementInfo {
	switch (node.type) {
		case 'root':
			return { type: 'root', depth: 0 };
		case 'page':
			return { type: 'page', depth: 1 };
		case 'header':
			return { type: 'header', depth: node.depth, headerLevel: node.headerLevel, name: node.name };
		case 'list':
			return { type: 'list', depth: node.depth, listLevel: node.listLevel, ordered: node.ordered };
	}
}

/**
 * Creates a streaming SAX-style Markdown parser that emits events
 * for structural elements (headers, lists, horizontal rules).
 *
 * Non-structural text streams out immediately. Headers buffer until
 * the full line is available (to capture the header name). List content
 * streams per-chunk once the marker is recognized and HR ambiguity is ruled out.
 *
 * All callbacks receive the current context stack, enabling consumers
 * to know the full hierarchy (which list in which header of which page).
 */
export function createMarkdownSaxParser(callbacks: MarkdownSaxCallbacks): MarkdownSaxParser {
	let lineBuffer = '';
	let bufferingLine = false;
	let seenNonWhitespace = false;
	let streamingLineContent = false;
	let lineTextAccum = '';
	let atLineStart = true;
	let pageOpen = false;
	const stack: ContextNode[] = [{ type: 'root', depth: 0 }];

	callbacks.onEnterElement(toElementInfo(stack[0]), stack);

	function push(node: ContextNode): void {
		stack.push(node);
		callbacks.onEnterElement(toElementInfo(node), stack);
	}

	function pop(): void {
		const node = stack.pop()!;
		callbacks.onLeaveElement(toElementInfo(node), stack);
	}

	function current(): ContextNode {
		return stack[stack.length - 1];
	}

	function ensurePageOpen(): void {
		if (!pageOpen) {
			push({ type: 'page', depth: 1 });
			pageOpen = true;
		}
	}

	function emitText(text: string): void {
		ensurePageOpen();
		callbacks.onText(text, stack);
	}

	function findNearestListOnStack(): number {
		for (let i = stack.length - 1; i >= 0; i--) {
			if (stack[i].type === 'list') return i;
		}
		return -1;
	}

	// --- Transition helpers ---

	/** Close all elements above targetIndex (stack[targetIndex] stays). */
	function closeToIndex(targetIndex: number): void {
		while (stack.length - 1 > targetIndex) pop();
	}

	/**
	 * Close headers deeper than targetLevel, and all lists.
	 * Stop at a shallower header, page, or root.
	 */
	function closeToHeaderLevel(targetLevel: number): void {
		while (true) {
			const cur = current();
			if (cur.type === 'header') {
				const curLevel = cur.headerLevel!;
				if (curLevel > targetLevel)
					pop(); // deeper: close
				else if (curLevel === targetLevel)
					pop(); // sibling: close and stop
				else break; // shallower: stop
			} else if (cur.type === 'list') {
				pop();
			} else {
				break;
			}
		}
	}

	function processHeader(level: number, name: string): void {
		ensurePageOpen();
		closeToHeaderLevel(level);
		push({ type: 'header', depth: level, headerLevel: level, name });
		if (name) callbacks.onText(name, stack);
	}

	function processList(ordered: boolean, indentation: number, content: string): void {
		ensurePageOpen();
		const nesting = determineListNesting(indentation);
		closeToIndex(nesting.closeAbove);
		const parent = current();
		push({
			type: 'list',
			depth: parent.depth + 1,
			listLevel: nesting.listLevel,
			ordered,
			indentation,
		});
		if (content) callbacks.onText(content, stack);
	}

	function determineListNesting(indentation: number): { listLevel: number; closeAbove: number } {
		const nearestIdx = findNearestListOnStack();
		if (nearestIdx === -1) {
			return { listLevel: 1, closeAbove: stack.length - 1 };
		}
		const ancestor = stack[nearestIdx];
		const ancestorIndent = ancestor.indentation!;

		if (indentation > ancestorIndent) {
			// Child: more indented — close above ancestor but keep it
			return { listLevel: ancestor.listLevel! + 1, closeAbove: nearestIdx };
		}
		if (indentation === ancestorIndent) {
			// Sibling: same indent — close including ancestor
			return { listLevel: ancestor.listLevel!, closeAbove: nearestIdx - 1 };
		}
		// Less indented — close past ancestor, then re-evaluate
		closeToIndex(nearestIdx - 1);
		return determineListNesting(indentation);
	}

	function processHR(): void {
		ensurePageOpen();
		while (current().type !== 'root') pop();
		push({ type: 'page', depth: 1 });
		pageOpen = true;
	}

	function processClassified(classified: ClassifiedLine, rawLine: string): void {
		switch (classified.kind) {
			case 'header':
				processHeader(classified.level, classified.name);
				break;
			case 'ulist':
				processList(false, classified.indentation, classified.content);
				break;
			case 'olist':
				processList(true, classified.indentation, classified.content);
				break;
			case 'hr':
				processHR();
				break;
			case 'text':
				emitText(rawLine);
				break;
		}
	}

	// --- Feed helpers ---

	function isWhitespace(ch: string): boolean {
		return ch === ' ' || ch === '\t';
	}

	/** Switch from buffering to streaming mode after committing to a list. */
	function switchToStreaming(content: string): void {
		lineTextAccum = content;
		lineBuffer = '';
		bufferingLine = false;
		streamingLineContent = true;
	}

	/**
	 * Try to classify the current buffer as a list before seeing the newline.
	 * Returns true if committed (switched to streaming mode).
	 */
	function tryEarlyListCommit(): boolean {
		const { rest } = countIndentation(lineBuffer);
		// Header lines can never be lists — skip classification entirely
		if (rest.length > 0 && rest[0] === '#') return false;

		const classified = classifyLine(lineBuffer);

		if (classified.kind === 'olist' && classified.content) {
			processList(true, classified.indentation, '');
			switchToStreaming(classified.content);
			return true;
		}
		if (classified.kind === 'ulist' && classified.content) {
			// Only commit if first content char differs from marker (HR safety)
			if (classified.content[0] !== rest[0]) {
				processList(false, classified.indentation, '');
				switchToStreaming(classified.content);
				return true;
			}
		}
		return false;
	}

	// --- Char processing ---

	function handleStreamingChar(char: string): void {
		if (char === '\n') {
			if (lineTextAccum) emitText(lineTextAccum);
			lineTextAccum = '';
			streamingLineContent = false;
			atLineStart = true;
		} else {
			lineTextAccum += char;
		}
	}

	function handleBufferingChar(char: string): void {
		lineBuffer += char;
		if (char === '\n') {
			processClassified(classifyLine(stripTrailingNewline(lineBuffer)), lineBuffer);
			lineBuffer = '';
			bufferingLine = false;
			seenNonWhitespace = false;
			atLineStart = true;
		} else if (!seenNonWhitespace && !isWhitespace(char)) {
			seenNonWhitespace = true;
			if (!isStructuralStartChar(char)) {
				// Not structural — flush buffer as text
				emitText(lineBuffer);
				lineBuffer = '';
				bufferingLine = false;
				atLineStart = false;
			} else {
				tryEarlyListCommit();
			}
		} else if (seenNonWhitespace) {
			tryEarlyListCommit();
		}
	}

	function handleLineStartChar(char: string): void {
		if (isWhitespace(char)) {
			lineBuffer = char;
			bufferingLine = true;
			seenNonWhitespace = false;
		} else if (isStructuralStartChar(char)) {
			lineBuffer = char;
			bufferingLine = true;
			seenNonWhitespace = true;
		} else {
			emitText(char);
			atLineStart = char === '\n';
		}
	}

	function handleBodyChar(char: string): void {
		emitText(char);
		atLineStart = char === '\n';
	}

	// --- Public API ---

	return {
		feed(chunk: string): void {
			for (let i = 0; i < chunk.length; i++) {
				const char = chunk[i];
				if (streamingLineContent) handleStreamingChar(char);
				else if (bufferingLine) handleBufferingChar(char);
				else if (atLineStart) handleLineStartChar(char);
				else handleBodyChar(char);
			}

			// Emit accumulated streaming text at end of feed
			if (streamingLineContent && lineTextAccum) {
				emitText(lineTextAccum);
				lineTextAccum = '';
			}
		},

		flush(): void {
			if (streamingLineContent && lineTextAccum) {
				emitText(lineTextAccum);
				lineTextAccum = '';
				streamingLineContent = false;
			}

			if (bufferingLine && lineBuffer.length > 0) {
				processClassified(classifyLine(stripTrailingNewline(lineBuffer)), lineBuffer);
				lineBuffer = '';
				bufferingLine = false;
			}

			while (stack.length > 0) pop();
		},
	};
}
