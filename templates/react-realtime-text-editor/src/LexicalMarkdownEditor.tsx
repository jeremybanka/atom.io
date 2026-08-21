import { createDOMRange, createRectsFromDOMRange } from "@lexical/selection"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getCharacterOffsets,
	$getRoot,
	$getSelection,
	$isElementNode,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	type ElementNode,
	type LexicalEditor as LexicalEditorInstance,
	type LexicalNode,
} from "lexical"
import {
	type CSSProperties,
	type KeyboardEvent,
	type ReactElement,
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from "react"

import css from "./LexicalMarkdownEditor.module.css"

const MOSAIC_PROJECTION_TAG = `mosaic-projection`

export type RenderedCollaboratorSelection = {
	readonly color: string
	readonly end: number
	readonly name: string
	readonly session: string
	readonly start: number
}

type CollaboratorStyle = CSSProperties & Record<`--collaborator-color`, string>

type OverlayRect = {
	readonly height: number
	readonly left: number
	readonly top: number
	readonly width: number
}

type OverlaySelection = RenderedCollaboratorSelection & {
	readonly caret: OverlayRect
	readonly rects: readonly OverlayRect[]
}

type LinearPoint = { readonly node: LexicalNode; readonly offset: number }

function pointAtOffset(
	root: ElementNode,
	requested: number,
): LinearPoint | null {
	const length = root.getTextContentSize()
	const target = Math.max(0, Math.min(requested, length))
	let traversed = 0
	let last: LexicalNode | null = null

	const visit = (node: LexicalNode): LinearPoint | null => {
		if ($isElementNode(node)) {
			for (const child of node.getChildren()) {
				const result = visit(child)
				if (result !== null) return result
			}
			return null
		}
		const size = node.getTextContentSize()
		const start = traversed
		const end = start + size
		last = node
		if (target < end && $isTextNode(node)) {
			return { node, offset: target - start }
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

function localRect(rect: DOMRect, container: DOMRect): OverlayRect {
	return {
		height: rect.height,
		left: rect.left - container.left,
		top: rect.top - container.top,
		width: rect.width,
	}
}

function measureSelection(
	editor: LexicalEditorInstance,
	selection: RenderedCollaboratorSelection,
): OverlaySelection | null {
	const rootElement = editor.getRootElement()
	if (rootElement === null) return null
	return editor.getEditorState().read(() => {
		const root = $getRoot()
		const start = pointAtOffset(root, Math.min(selection.start, selection.end))
		const end = pointAtOffset(root, Math.max(selection.start, selection.end))
		const head = pointAtOffset(root, selection.end)
		if (start === null || end === null || head === null) return null
		const range = createDOMRange(
			editor,
			start.node,
			start.offset,
			end.node,
			end.offset,
		)
		const headRange = createDOMRange(
			editor,
			head.node,
			head.offset,
			head.node,
			head.offset,
		)
		if (range === null || headRange === null) return null
		const container = rootElement.parentElement?.getBoundingClientRect()
		if (container === undefined) return null
		const measured = createRectsFromDOMRange(editor, range)
			.filter((rect) => rect.height > 0)
			.map((rect) => localRect(rect, container))
		const boundary = headRange.getBoundingClientRect()
		const fallbackHeight = Number.parseFloat(
			getComputedStyle(rootElement).lineHeight,
		)
		const caret = localRect(
			boundary.height > 0
				? boundary
				: new DOMRect(
						boundary.x,
						boundary.y,
						0,
						Number.isFinite(fallbackHeight) ? fallbackHeight : 24,
					),
			container,
		)
		return { ...selection, caret, rects: measured }
	})
}

function MosaicProjectionPlugin({ value }: { readonly value: string }): null {
	const [editor] = useLexicalComposerContext()
	useLayoutEffect(() => {
		editor.update(
			() => {
				const root = $getRoot()
				if (root.getTextContent() === value) return
				const currentSelection = $getSelection()
				const offsets = $isRangeSelection(currentSelection)
					? $getCharacterOffsets(currentSelection)
					: null
				const paragraph = $createParagraphNode()
				root.clear().append(paragraph)
				if (value.length === 0) {
					paragraph.selectStart()
					return
				}
				const text = $createTextNode(value)
				paragraph.append(text)
				if (offsets !== null) {
					const selection = $createRangeSelection().setTextNodeRange(
						text,
						Math.min(offsets[0], value.length),
						text,
						Math.min(offsets[1], value.length),
					)
					$setSelection(selection)
				}
			},
			{ tag: MOSAIC_PROJECTION_TAG },
		)
	}, [editor, value])
	return null
}

function MosaicInputPlugin({
	onSelectionChange,
	onValueChange,
	value,
}: {
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly value: string
}): ReactElement {
	const lastSelection = useRef<string | null>(null)
	const composing = useRef(false)
	return (
		<OnChangePlugin
			ignoreSelectionChange={false}
			onChange={(editorState, editor, tags) => {
				if (tags.has(MOSAIC_PROJECTION_TAG)) return
				const snapshot = editorState.read(() => {
					const selection = $getSelection()
					return {
						selection: $isRangeSelection(selection)
							? $getCharacterOffsets(selection)
							: null,
						text: $getRoot().getTextContent(),
					}
				})
				const nextComposing = editor.isComposing()
				if (snapshot.text !== value || composing.current !== nextComposing) {
					onValueChange(snapshot.text, nextComposing)
				}
				composing.current = nextComposing
				const root = editor.getRootElement()
				if (
					snapshot.selection === null ||
					root === null ||
					(root !== document.activeElement &&
						!root.contains(document.activeElement))
				) {
					return
				}
				const signature = snapshot.selection.join(`:`)
				if (lastSelection.current === signature) return
				lastSelection.current = signature
				onSelectionChange(snapshot.selection[0], snapshot.selection[1])
			}}
		/>
	)
}

function MosaicPresencePlugin({
	selections,
}: {
	readonly selections: readonly RenderedCollaboratorSelection[]
}): ReactElement {
	const [editor] = useLexicalComposerContext()
	const [overlays, setOverlays] = useState<readonly OverlaySelection[]>([])

	useLayoutEffect(() => {
		let frame: number | null = null
		const render = (): void => {
			if (frame !== null) cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				frame = null
				setOverlays(
					selections.flatMap((selection) => {
						const measured = measureSelection(editor, selection)
						return measured === null ? [] : [measured]
					}),
				)
			})
		}
		const stopUpdate = editor.registerUpdateListener(render)
		const stopRoot = editor.registerRootListener((root, previous) => {
			previous?.removeEventListener(`scroll`, render)
			root?.addEventListener(`scroll`, render, { passive: true })
			render()
		})
		const root = editor.getRootElement()
		const observer =
			root === null || typeof ResizeObserver === `undefined`
				? null
				: new ResizeObserver(render)
		if (root !== null) observer?.observe(root)
		window.addEventListener(`resize`, render)
		render()
		return () => {
			if (frame !== null) cancelAnimationFrame(frame)
			stopUpdate()
			stopRoot()
			observer?.disconnect()
			window.removeEventListener(`resize`, render)
		}
	}, [editor, selections])

	return (
		<collaborator-overlays aria-hidden="true">
			{overlays.map((selection) => {
				const style = {
					"--collaborator-color": selection.color,
				} as CollaboratorStyle
				const collapsed = selection.start === selection.end
				return (
					<collaborator-presence
						key={selection.session}
						data-collaborator={selection.name}
						data-presence-kind={collapsed ? `caret` : `selection`}
						style={style}
					>
						{collapsed
							? null
							: selection.rects.map((rect, index) => (
									<collaborator-selection
										key={index}
										style={{
											height: rect.height,
											left: rect.left,
											top: rect.top,
											width: Math.max(rect.width, 2),
										}}
									/>
								))}
						<collaborator-caret
							style={{
								height: Math.max(selection.caret.height, 20),
								left: collapsed
									? selection.caret.left
									: selection.caret.left + selection.caret.width,
								top: selection.caret.top,
							}}
						>
							<collaborator-label>{selection.name}</collaborator-label>
						</collaborator-caret>
					</collaborator-presence>
				)
			})}
		</collaborator-overlays>
	)
}

function LexicalEditor({
	onKeyDown,
	onSelectionChange,
	onValueChange,
	selections,
	value,
}: {
	readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}): ReactElement {
	return (
		<lexical-editor>
			<PlainTextPlugin
				contentEditable={
					<ContentEditable
						aria-label="Shared markdown source viewport"
						id="markdown-source"
						onKeyDown={onKeyDown}
						spellCheck
					/>
				}
				ErrorBoundary={LexicalErrorBoundary}
				placeholder={
					<editor-placeholder>Start writing Markdown…</editor-placeholder>
				}
			/>
			<MosaicProjectionPlugin value={value} />
			<MosaicInputPlugin
				onSelectionChange={onSelectionChange}
				onValueChange={onValueChange}
				value={value}
			/>
			<MosaicPresencePlugin selections={selections} />
		</lexical-editor>
	)
}

export function LexicalMarkdownEditor({
	onError,
	onRedo,
	onSelectionChange,
	onUndo,
	onValueChange,
	selections,
	value,
}: {
	readonly onError: (error: Error) => void
	readonly onRedo: () => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onUndo: () => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}): ReactElement {
	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>): void => {
			if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== `z`)
				return
			event.preventDefault()
			if (event.shiftKey) onRedo()
			else onUndo()
		},
		[onRedo, onUndo],
	)

	return (
		<lexical-markdown-editor className={css.class}>
			<LexicalComposer
				initialConfig={{
					namespace: `MosaicMarkdownSource`,
					onError,
					theme: {},
				}}
			>
				<LexicalEditor
					onKeyDown={onKeyDown}
					onSelectionChange={onSelectionChange}
					onValueChange={onValueChange}
					selections={selections}
					value={value}
				/>
			</LexicalComposer>
		</lexical-markdown-editor>
	)
}
