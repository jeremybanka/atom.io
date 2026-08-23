import {
	$createTextNode,
	$getRoot,
	$isElementNode,
	$isLineBreakNode,
	$isTextNode,
	type ElementNode,
	type LexicalNode,
	type PointType,
	type RangeSelection,
} from "lexical"

export type LexicalLinearPoint = {
	readonly node: LexicalNode
	readonly offset: number
}

export type LineStartCaretReference = {
	readonly index: number | null
	readonly lineDelta: number
}

/** Find the preceding glyph for a caret at a nonempty visual line end. */
export function lineEndCaretReference(
	text: string,
	requestedOffset: number,
): number | null {
	const offset = Math.max(0, Math.min(requestedOffset, text.length))
	if (offset === 0 || text[offset - 1] === `\n`) return null
	if (offset < text.length && text[offset] !== `\n`) return null
	return offset - 1
}

/** Find measurable neighboring text for a caret at an explicit line start. */
export function lineStartCaretReference(
	text: string,
	requestedOffset: number,
): LineStartCaretReference | null {
	const offset = Math.max(0, Math.min(requestedOffset, text.length))
	if (offset !== 0 && text[offset - 1] !== `\n`) return null
	let next = offset
	while (next < text.length && text[next] === `\n`) next++
	if (next < text.length) {
		return { index: next, lineDelta: -(next - offset) }
	}
	let previous = offset - 1
	while (previous >= 0 && text[previous] === `\n`) previous--
	if (previous < 0) return { index: null, lineDelta: 0 }
	return {
		index: previous,
		lineDelta: text
			.slice(previous + 1, offset)
			.split(`\n`)
			.slice(1).length,
	}
}

/** Materialize text on an empty visual row instead of joining the next line. */
export function $insertTextAtBlankLineBoundary(
	selection: RangeSelection,
	text: string,
): boolean {
	if (!selection.isCollapsed() || selection.anchor.type !== `element`)
		return false
	const parent = selection.anchor.getNode()
	if (!$isElementNode(parent)) return false
	const offset = selection.anchor.offset
	const next = parent.getChildAtIndex(offset)
	const previous = offset === 0 ? null : parent.getChildAtIndex(offset - 1)
	if (
		!$isLineBreakNode(next) &&
		!(next === null && $isLineBreakNode(previous))
	) {
		return false
	}
	const inserted = $createTextNode(text)
	if (next === null) parent.append(inserted)
	else next.insertBefore(inserted)
	inserted.selectEnd()
	return true
}

/** Convert a root-relative UTF-16 offset back to a Lexical node-local point. */
export function $pointAtRootOffset(
	root: ElementNode,
	requested: number,
): LexicalLinearPoint | null {
	const length = root.getTextContentSize()
	const target = Math.max(0, Math.min(requested, length))
	let traversed = 0
	let last: LexicalNode | null = null
	const visit = (node: LexicalNode): LexicalLinearPoint | null => {
		if ($isElementNode(node)) {
			if (node !== root && target === traversed) return { node, offset: 0 }
			const children = node.getChildren()
			for (let index = 0; index < children.length; index++) {
				const child = children[index]
				const result = visit(child)
				if (result !== null) return result
				if (
					$isElementNode(child) &&
					!child.isInline() &&
					index !== children.length - 1
				) {
					if (target < traversed + 2) return { node, offset: index + 1 }
					traversed += 2
				}
			}
			return target === traversed ? { node, offset: children.length } : null
		}
		const size = node.getTextContentSize()
		const start = traversed
		const end = start + size
		last = node
		if (target < end) {
			if ($isTextNode(node)) return { node, offset: target - start }
			const parent = node.getParent()
			if (parent === null) return null
			return {
				node: parent,
				offset: node.getIndexWithinParent() + (target === start ? 0 : 1),
			}
		}
		if (target === start) {
			if ($isTextNode(node)) return { node, offset: 0 }
			const parent = node.getParent()
			return parent === null
				? null
				: { node: parent, offset: node.getIndexWithinParent() }
		}
		traversed = end
		return null
	}
	const found = visit(root)
	if (found !== null) return found
	if (last === null) return { node: root, offset: 0 }
	const finalNode = last as LexicalNode
	if ($isTextNode(finalNode)) {
		return { node: finalNode, offset: finalNode.getTextContentSize() }
	}
	const parent = finalNode.getParent()
	return parent === null
		? { node: root, offset: root.getChildrenSize() }
		: { node: parent, offset: finalNode.getIndexWithinParent() + 1 }
}

function rootRelativePointOffset(root: ElementNode, point: PointType): number {
	const locate = (element: ElementNode, base: number): number | null => {
		const children = element.getChildren()
		if (point.type === `element` && point.key === element.getKey()) {
			let offset = base
			for (
				let index = 0;
				index < Math.min(point.offset, children.length);
				index++
			) {
				const child = children[index]
				offset += child.getTextContentSize()
				if (
					$isElementNode(child) &&
					!child.isInline() &&
					index !== children.length - 1
				) {
					offset += 2
				}
			}
			return offset
		}
		let offset = base
		for (let index = 0; index < children.length; index++) {
			const child = children[index]
			if (point.type === `text` && point.key === child.getKey()) {
				return offset + Math.min(point.offset, child.getTextContentSize())
			}
			if ($isElementNode(child)) {
				const found = locate(child, offset)
				if (found !== null) return found
			}
			offset += child.getTextContentSize()
			if (
				$isElementNode(child) &&
				!child.isInline() &&
				index !== children.length - 1
			) {
				offset += 2
			}
		}
		return null
	}
	const located = locate(root, 0)
	if (located === null) {
		throw new Error(`A Lexical selection point is outside the Markdown root.`)
	}
	return located
}

/** Lexical points are node-local; Mosaic positions are root-relative UTF-16. */
export function $getRootRelativeSelectionOffsets(
	selection: RangeSelection,
): readonly [number, number] {
	const root = $getRoot()
	return [
		rootRelativePointOffset(root, selection.anchor),
		rootRelativePointOffset(root, selection.focus),
	]
}
