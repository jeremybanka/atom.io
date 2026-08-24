import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { createDOMRange, createRectsFromDOMRange } from "@lexical/selection"
import { transformMosaicTextSelection } from "atom.io/realtime-client"
import {
	$createLineBreakNode,
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	$isTextNode,
	$setSelection,
	COMMAND_PRIORITY_HIGH,
	CONTROLLED_TEXT_INSERTION_COMMAND,
	type ElementNode,
	type LexicalEditor as LexicalEditorInstance,
} from "lexical"
import {
	type CSSProperties,
	type KeyboardEvent,
	type MutableRefObject,
	type ReactElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react"

import {
	$getRootRelativeSelectionOffsets,
	$insertTextAtBlankLineBoundary,
	$pointAtRootOffset,
	lineEndCaretReference,
	lineStartCaretReference,
} from "./lexical-linear-offset.ts"

const MOSAIC_PROJECTION_TAG = `mosaic-projection`

export type RenderedCollaboratorSelection = {
	readonly color: string
	readonly end: number
	readonly name: string
	readonly session: string
	readonly start: number
}

export type MosaicLexicalTextEditorProps = {
	readonly className?: string
	readonly onDirty?: () => void
	readonly onError: (error: Error) => void
	readonly onRedo: () => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onUndo: () => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selection?: readonly [number, number] | null
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
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

function $appendProjectedText(paragraph: ElementNode, value: string): void {
	const lines = value.split(`\n`)
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]
		if (line.length > 0) paragraph.append($createTextNode(line))
		if (index < lines.length - 1) paragraph.append($createLineBreakNode())
	}
}

function $restoreRootRelativeSelection(
	root: ElementNode,
	offsets: readonly [number, number],
): void {
	const anchor = $pointAtRootOffset(root, offsets[0])
	const focus = $pointAtRootOffset(root, offsets[1])
	if (anchor === null || focus === null) return
	const selection = $createRangeSelection()
	selection.anchor.set(
		anchor.node.getKey(),
		anchor.offset,
		$isTextNode(anchor.node) ? `text` : `element`,
	)
	selection.focus.set(
		focus.node.getKey(),
		focus.offset,
		$isTextNode(focus.node) ? `text` : `element`,
	)
	$setSelection(selection)
}

function localRect(rect: DOMRect, container: DOMRect): OverlayRect {
	return {
		height: rect.height,
		left: rect.left - container.left,
		top: rect.top - container.top,
		width: rect.width,
	}
}

function numericStyle(value: string): number {
	const parsed = Number.parseFloat(value)
	return Number.isFinite(parsed) ? parsed : 0
}

function measureCharacter(
	editor: LexicalEditorInstance,
	root: ReturnType<typeof $getRoot>,
	index: number,
): DOMRect | null {
	const start = $pointAtRootOffset(root, index)
	const end = $pointAtRootOffset(root, index + 1)
	if (start === null || end === null) return null
	const range = createDOMRange(
		editor,
		start.node,
		start.offset,
		end.node,
		end.offset,
	)
	if (range === null) return null
	return (
		Array.from(range.getClientRects()).find((rect) => rect.height > 0) ??
		range.getBoundingClientRect()
	)
}

function measureCaret(
	editor: LexicalEditorInstance,
	root: ReturnType<typeof $getRoot>,
	rootElement: HTMLElement,
	offset: number,
	boundary: DOMRect,
): DOMRect {
	const style = getComputedStyle(rootElement)
	const lineHeight = numericStyle(style.lineHeight) || 24
	const text = root.getTextContent()
	const reference = lineStartCaretReference(text, offset)
	if (reference === null) {
		const lineEnd = lineEndCaretReference(text, offset)
		const measured =
			lineEnd === null ? null : measureCharacter(editor, root, lineEnd)
		if (measured !== null && measured.height > 0) {
			return new DOMRect(measured.right, measured.top, 0, measured.height)
		}
		return boundary.height > 0
			? boundary
			: new DOMRect(boundary.x, boundary.y, 0, lineHeight)
	}
	const rootRect = rootElement.getBoundingClientRect()
	const measured =
		reference.index === null
			? null
			: measureCharacter(editor, root, reference.index)
	return new DOMRect(
		rootRect.left + numericStyle(style.paddingLeft),
		(measured?.top ?? rootRect.top + numericStyle(style.paddingTop)) +
			reference.lineDelta * lineHeight,
		0,
		lineHeight,
	)
}

function measureSelection(
	editor: LexicalEditorInstance,
	selection: RenderedCollaboratorSelection,
): OverlaySelection | null {
	const rootElement = editor.getRootElement()
	if (rootElement === null) return null
	return editor.getEditorState().read(() => {
		const root = $getRoot()
		const length = root.getTextContentSize()
		if (
			selection.start < 0 ||
			selection.end < 0 ||
			selection.start > length ||
			selection.end > length
		) {
			return null
		}
		const start = $pointAtRootOffset(
			root,
			Math.min(selection.start, selection.end),
		)
		const end = $pointAtRootOffset(
			root,
			Math.max(selection.start, selection.end),
		)
		const head = $pointAtRootOffset(root, selection.end)
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
		const caret = localRect(
			measureCaret(
				editor,
				root,
				rootElement,
				selection.end,
				headRange.getBoundingClientRect(),
			),
			container,
		)
		return { ...selection, caret, rects: measured }
	})
}

function MosaicProjectionPlugin({
	selection,
	selectionRef,
	suppressedSelectionRef,
	value,
}: {
	readonly selection: readonly [number, number] | null
	readonly selectionRef: MutableRefObject<readonly [number, number] | null>
	readonly suppressedSelectionRef: MutableRefObject<
		readonly [number, number] | null
	>
	readonly value: string
}): null {
	const [editor] = useLexicalComposerContext()
	useLayoutEffect(() => {
		editor.update(
			() => {
				const root = $getRoot()
				const previousValue = root.getTextContent()
				if (previousValue === value) return
				const currentSelection = $getSelection()
				const offsets =
					selectionRef.current ??
					($isRangeSelection(currentSelection)
						? $getRootRelativeSelectionOffsets(currentSelection)
						: null)
				const transformedOffsets =
					selection ??
					(offsets === null
						? null
						: transformMosaicTextSelection(previousValue, value, offsets))
				const paragraph = $createParagraphNode()
				root.clear().append(paragraph)
				if (value.length === 0) {
					paragraph.selectStart()
					return
				}
				$appendProjectedText(paragraph, value)
				if (transformedOffsets !== null) {
					selectionRef.current = transformedOffsets
					suppressedSelectionRef.current = transformedOffsets
					$restoreRootRelativeSelection(root, transformedOffsets)
				}
			},
			{ tag: MOSAIC_PROJECTION_TAG },
		)
	}, [editor, selection, selectionRef, suppressedSelectionRef, value])
	return null
}

function MosaicInputPlugin({
	onDirty,
	onSelectionChange,
	onValueChange,
	selectionRef,
	suppressedSelectionRef,
	value,
}: {
	readonly onDirty: () => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selectionRef: MutableRefObject<readonly [number, number] | null>
	readonly suppressedSelectionRef: MutableRefObject<
		readonly [number, number] | null
	>
	readonly value: string
}): ReactElement {
	const [editor] = useLexicalComposerContext()
	const lastSelection = useRef<string | null>(null)
	const composing = useRef(false)
	useEffect(() => {
		const insertAtBlankRow = (event: InputEvent): void => {
			const data = event.data
			if (
				event.inputType !== `insertText` ||
				data === null ||
				data.length === 0 ||
				event.isComposing
			) {
				return
			}
			let handled = false
			editor.update(() => {
				const selection = $getSelection()
				handled =
					$isRangeSelection(selection) &&
					$insertTextAtBlankLineBoundary(selection, data)
			})
			if (!handled) return
			event.preventDefault()
			event.stopImmediatePropagation()
			onDirty()
		}
		return editor.registerRootListener((root, previous) => {
			previous?.removeEventListener(`beforeinput`, insertAtBlankRow, true)
			root?.addEventListener(`beforeinput`, insertAtBlankRow, true)
		})
	}, [editor, onDirty])
	useEffect(
		() =>
			editor.registerCommand(
				CONTROLLED_TEXT_INSERTION_COMMAND,
				(eventOrText) => {
					if (editor.isComposing()) return false
					const text =
						typeof eventOrText === `string`
							? eventOrText
							: eventOrText.dataTransfer === null
								? eventOrText.data
								: null
					if (text === null || text.length === 0) return false
					const selection = $getSelection()
					return (
						$isRangeSelection(selection) &&
						$insertTextAtBlankLineBoundary(selection, text)
					)
				},
				COMMAND_PRIORITY_HIGH,
			),
		[editor],
	)
	return (
		<OnChangePlugin
			ignoreSelectionChange={false}
			onChange={(editorState, editorInstance, tags) => {
				if (tags.has(MOSAIC_PROJECTION_TAG)) return
				const snapshot = editorState.read(() => {
					const selection = $getSelection()
					return {
						selection: $isRangeSelection(selection)
							? $getRootRelativeSelectionOffsets(selection)
							: null,
						text: $getRoot().getTextContent(),
					}
				})
				const nextComposing = editorInstance.isComposing()
				if (snapshot.text !== value || composing.current !== nextComposing) {
					onValueChange(snapshot.text, nextComposing)
				}
				composing.current = nextComposing
				const root = editorInstance.getRootElement()
				if (
					snapshot.selection === null ||
					root === null ||
					(root !== document.activeElement &&
						!root.contains(document.activeElement))
				) {
					return
				}
				const suppressed = suppressedSelectionRef.current
				if (suppressed !== null) {
					if (
						suppressed[0] === snapshot.selection[0] &&
						suppressed[1] === snapshot.selection[1]
					) {
						selectionRef.current = snapshot.selection
						suppressedSelectionRef.current = null
					}
					// A projection can briefly move the DOM selection before Lexical has
					// restored the intended logical caret. Never publish that synthetic
					// intermediate position as collaborator presence.
					return
				}
				selectionRef.current = snapshot.selection
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
	value,
}: {
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}): ReactElement {
	const [editor] = useLexicalComposerContext()
	const [overlays, setOverlays] = useState<readonly OverlaySelection[]>([])

	useLayoutEffect(() => {
		let frame: number | null = null
		let resizeObserver: ResizeObserver | null = null
		const measure = (): void => {
			const editorHasProjection = editor
				.getEditorState()
				.read(() => $getRoot().getTextContent() === value)
			if (!editorHasProjection) return
			setOverlays((current) =>
				selections.flatMap((selection) => {
					const measured = measureSelection(editor, selection)
					if (measured !== null) return [measured]
					const previous = current.find(
						(candidate) =>
							candidate.session === selection.session &&
							candidate.start === selection.start &&
							candidate.end === selection.end,
					)
					return previous === undefined ? [] : [previous]
				}),
			)
		}
		const render = (): void => {
			if (frame !== null) cancelAnimationFrame(frame)
			frame = requestAnimationFrame(() => {
				frame = null
				measure()
			})
		}
		const observeSize = (root: HTMLElement | null): void => {
			resizeObserver?.disconnect()
			if (root === null || typeof ResizeObserver === `undefined`) {
				resizeObserver = null
				return
			}
			resizeObserver = new ResizeObserver(render)
			resizeObserver.observe(root)
		}
		const stopUpdate = editor.registerUpdateListener(render)
		const stopRoot = editor.registerRootListener((root, previous) => {
			previous?.removeEventListener(`scroll`, render)
			root?.addEventListener(`scroll`, render, { passive: true })
			observeSize(root)
			render()
		})
		window.addEventListener(`resize`, render)
		// A collaborator selection and its measured geometry must advance in the
		// same layout phase. Deferring this prop-driven measurement would render
		// the new logical offset with the previous offset's caret for one frame.
		measure()
		return () => {
			if (frame !== null) cancelAnimationFrame(frame)
			stopUpdate()
			stopRoot()
			resizeObserver?.disconnect()
			window.removeEventListener(`resize`, render)
		}
	}, [editor, selections, value])

	return (
		<collaborator-overlays aria-hidden="true">
			{selections.flatMap((selection) => {
				const measured = overlays.find(
					(candidate) => candidate.session === selection.session,
				)
				if (measured === undefined) return []
				const style = {
					"--collaborator-color": selection.color,
				} as CollaboratorStyle
				const collapsed = selection.start === selection.end
				return (
					<collaborator-presence
						key={selection.session}
						data-collaborator={selection.name}
						data-presence-kind={collapsed ? `caret` : `selection`}
						data-selection-end={selection.end}
						data-selection-start={selection.start}
						data-session={selection.session}
						style={style}
					>
						{collapsed
							? null
							: measured.rects.map((rect, index) => (
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
								height: Math.max(measured.caret.height, 20),
								left: collapsed
									? measured.caret.left
									: measured.caret.left + measured.caret.width,
								top: measured.caret.top,
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
	onDirty,
	onKeyDown,
	onSelectionChange,
	onValueChange,
	selection,
	selections,
	value,
}: {
	readonly onDirty: () => void
	readonly onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly selection: readonly [number, number] | null
	readonly selections: readonly RenderedCollaboratorSelection[]
	readonly value: string
}): ReactElement {
	const selectionRef = useRef<readonly [number, number] | null>(null)
	const suppressedSelectionRef = useRef<readonly [number, number] | null>(null)
	return (
		<lexical-editor>
			<PlainTextPlugin
				contentEditable={
					<ContentEditable
						aria-label="Shared markdown source viewport"
						id="markdown-source"
						onBeforeInput={() => {
							suppressedSelectionRef.current = null
							onDirty()
						}}
						onKeyDown={(event) => {
							suppressedSelectionRef.current = null
							onKeyDown(event)
						}}
						onPointerDown={() => {
							suppressedSelectionRef.current = null
						}}
						spellCheck
					/>
				}
				ErrorBoundary={LexicalErrorBoundary}
				placeholder={
					<editor-placeholder>Start writing Markdown…</editor-placeholder>
				}
			/>
			<MosaicProjectionPlugin
				selection={selection}
				selectionRef={selectionRef}
				suppressedSelectionRef={suppressedSelectionRef}
				value={value}
			/>
			<MosaicInputPlugin
				onDirty={onDirty}
				onSelectionChange={onSelectionChange}
				onValueChange={onValueChange}
				selectionRef={selectionRef}
				suppressedSelectionRef={suppressedSelectionRef}
				value={value}
			/>
			<MosaicPresencePlugin selections={selections} value={value} />
		</lexical-editor>
	)
}

/**
 * Lexical adapter for the renderer-neutral Mosaic text editor view.
 *
 * Projection replacement, native input boundaries, logical selection
 * restoration, and collaborator geometry are kept in one supported adapter so
 * consumers do not need React effects to synchronize them.
 */
export function MosaicLexicalTextEditor({
	className,
	onError,
	onDirty = () => undefined,
	onRedo,
	onSelectionChange,
	onUndo,
	onValueChange,
	selection = null,
	selections,
	value,
}: MosaicLexicalTextEditorProps): ReactElement {
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
		<mosaic-lexical-text-editor className={className}>
			<LexicalComposer
				initialConfig={{
					namespace: `MosaicMarkdownSource`,
					onError,
					theme: {},
				}}
			>
				<LexicalEditor
					onDirty={onDirty}
					onKeyDown={onKeyDown}
					onSelectionChange={onSelectionChange}
					onValueChange={onValueChange}
					selection={selection}
					selections={selections}
					value={value}
				/>
			</LexicalComposer>
		</mosaic-lexical-text-editor>
	)
}
