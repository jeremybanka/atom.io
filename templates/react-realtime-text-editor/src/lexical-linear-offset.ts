import {
	$getRoot,
	$isElementNode,
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

/** Carry a root-relative selection through one authoritative text replacement. */
export function transformSelectionAcrossTextChange(
	before: string,
	after: string,
	selection: readonly [number, number],
): readonly [number, number] {
	let start = 0
	while (
		start < before.length &&
		start < after.length &&
		before[start] === after[start]
	) {
		start++
	}
	let suffix = 0
	while (
		suffix < before.length - start &&
		suffix < after.length - start &&
		before[before.length - suffix - 1] === after[after.length - suffix - 1]
	) {
		suffix++
	}
	const end = before.length - suffix
	const insertedLength = after.length - start - suffix
	const transform = (offset: number): number => {
		if (offset < start) return offset
		if (offset > end) return offset + insertedLength - (end - start)
		return start + insertedLength
	}
	return [transform(selection[0]), transform(selection[1])]
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
