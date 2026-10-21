import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { transformMosaicTextSelection } from "atom.io/realtime-client"
import {
	$getRootRelativeSelectionOffsets,
	$insertTextAtBlankLineBoundary,
	$pointAtRootOffset,
	lineEndCaretReference,
	lineStartCaretReference,
	MosaicLexicalTextEditor,
} from "atom.io/realtime-react-lexical"
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
	CONTROLLED_TEXT_INSERTION_COMMAND,
	createEditor,
	type LexicalEditor,
} from "lexical"

describe(`Lexical Markdown editor`, () => {
	test(`renders measured collaborator selections and line-boundary carets`, async () => {
		const rangeRect = new DOMRect(30, 40, 48, 18)
		const getClientRects = vi
			.spyOn(Range.prototype, `getClientRects`)
			.mockReturnValue({
				0: rangeRect,
				item: (index: number) => (index === 0 ? rangeRect : null),
				length: 1,
				[Symbol.iterator]: function* () {
					yield rangeRect
				},
			} as DOMRectList)
		const getBoundingClientRect = vi
			.spyOn(Range.prototype, `getBoundingClientRect`)
			.mockReturnValue(rangeRect)
		const elementRect = vi
			.spyOn(HTMLElement.prototype, `getBoundingClientRect`)
			.mockReturnValue(new DOMRect(10, 20, 400, 200))
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
		}
		const rendered = render(
			<MosaicLexicalTextEditor
				{...properties}
				className="root-class"
				classNames={{
					caret: `caret-class`,
					contentEditable: `content-class`,
					editor: `editor-class`,
					label: `label-class`,
					overlays: `overlays-class`,
					paragraph: `paragraph-class`,
					placeholder: `placeholder-class`,
					presence: `presence-class`,
					selection: `selection-class`,
				}}
				selections={[
					{
						color: `#f00`,
						end: 5,
						name: `Lin`,
						session: `lin-session`,
						start: 1,
					},
				]}
				value={`alpha\n\nbeta`}
			/>,
		)
		await rendered.findByRole(`textbox`)
		expect(
			rendered.container.querySelector(`mosaic-lexical-text-editor`)?.className,
		).toBe(`root-class`)
		expect(rendered.container.querySelector(`lexical-editor`)?.className).toBe(
			`editor-class`,
		)
		expect(rendered.getByRole(`textbox`).className).toBe(`content-class`)
		expect(
			rendered.container.querySelector(`collaborator-overlays`)?.className,
		).toBe(`overlays-class`)
		expect(rendered.container.querySelector(`p`)?.className).toBe(
			`paragraph-class`,
		)
		await waitFor(() => {
			const presence = rendered.container.querySelector(
				`collaborator-presence[data-session="lin-session"]`,
			)
			expect(presence?.getAttribute(`data-presence-kind`)).toBe(`selection`)
			expect(presence?.querySelector(`collaborator-selection`)).not.toBeNull()
			expect(presence?.querySelector(`collaborator-caret`)).not.toBeNull()
			expect(presence?.className).toBe(`presence-class`)
			expect(presence?.querySelector(`collaborator-selection`)?.className).toBe(
				`selection-class`,
			)
			expect(presence?.querySelector(`collaborator-caret`)?.className).toBe(
				`caret-class`,
			)
			expect(presence?.querySelector(`collaborator-label`)?.className).toBe(
				`label-class`,
			)
		})

		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selections={[
					{
						color: `#f00`,
						end: 6,
						name: `Lin`,
						session: `lin-session`,
						start: 6,
					},
				]}
				value={`alpha\n\nbeta`}
			/>,
		)
		await waitFor(() => {
			expect(
				rendered.container
					.querySelector(`collaborator-presence`)
					?.getAttribute(`data-presence-kind`),
			).toBe(`caret`)
		})
		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selections={[
					{
						color: `#f00`,
						end: 2,
						name: `Lin`,
						session: `lin-session`,
						start: 2,
					},
				]}
				value={`\n\n`}
			/>,
		)
		await waitFor(() => {
			expect(
				rendered.container
					.querySelector(`collaborator-caret`)
					?.getAttribute(`style`),
			).toContain(`height`)
		})
		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				classNames={{ placeholder: `placeholder-class` }}
				selections={[]}
				value=""
			/>,
		)
		await waitFor(() => {
			expect(
				rendered.container.querySelector(`editor-placeholder`)?.className,
			).toBe(`placeholder-class`)
		})
		getClientRects.mockRestore()
		getBoundingClientRect.mockRestore()
		elementRect.mockRestore()
	})

	test(`handles history shortcuts and dirty input through the public adapter`, async () => {
		const onDirty = vi.fn()
		const onRedo = vi.fn()
		const onUndo = vi.fn()
		const rendered = render(
			<MosaicLexicalTextEditor
				onDirty={onDirty}
				onError={(error) => {
					throw error
				}}
				onRedo={onRedo}
				onSelectionChange={() => undefined}
				onUndo={onUndo}
				onValueChange={() => undefined}
				selection={[6, 6]}
				selections={[]}
				value={`alpha\n\n1. item`}
			/>,
		)
		const editor = await rendered.findByRole(`textbox`)
		fireEvent.pointerDown(editor)
		fireEvent.keyDown(editor, { key: `a` })
		fireEvent.keyDown(editor, { ctrlKey: true, key: `z` })
		fireEvent.keyDown(editor, { ctrlKey: true, key: `Z`, shiftKey: true })
		expect(onUndo).toHaveBeenCalledOnce()
		expect(onRedo).toHaveBeenCalledOnce()
		const ignoredInput = new InputEvent(`beforeinput`, {
			bubbles: true,
			cancelable: true,
			inputType: `deleteContentBackward`,
		})
		fireEvent(editor, ignoredInput)
		expect(ignoredInput.defaultPrevented).toBe(false)

		const beforeInput = new InputEvent(`beforeinput`, {
			bubbles: true,
			cancelable: true,
			data: `marker`,
			inputType: `insertText`,
		})
		fireEvent(editor, beforeInput)
		await waitFor(() => {
			expect(editor.textContent).toBe(`alphamarker1. item`)
			expect(editor.querySelectorAll(`br`)).toHaveLength(2)
		})
		expect(beforeInput.defaultPrevented).toBe(true)
		expect(onDirty).toHaveBeenCalled()
		const ordinaryInput = new InputEvent(`beforeinput`, {
			bubbles: true,
			cancelable: true,
			data: `x`,
			inputType: `insertText`,
		})
		fireEvent(editor, ordinaryInput)
		expect(ordinaryInput.defaultPrevented).toBe(false)
		const dirtyCalls = onDirty.mock.calls.length
		fireEvent(
			editor,
			new InputEvent(`textInput`, {
				bubbles: true,
				cancelable: true,
				data: `x`,
				inputType: `insertText`,
			}),
		)
		expect(onDirty).toHaveBeenCalledTimes(dirtyCalls + 1)
	})

	test(`handles controlled insertion at a blank-line boundary`, async () => {
		const rendered = render(
			<MosaicLexicalTextEditor
				onError={(error) => {
					throw error
				}}
				onRedo={() => undefined}
				onSelectionChange={() => undefined}
				onUndo={() => undefined}
				onValueChange={() => undefined}
				selection={[6, 6]}
				selections={[]}
				value={`alpha\n\n1. item`}
			/>,
		)
		const root = await rendered.findByRole(`textbox`)
		const editor = (
			root as HTMLElement & { readonly __lexicalEditor?: LexicalEditor }
		).__lexicalEditor
		expect(editor).toBeDefined()
		await waitFor(() => {
			expect(root.querySelectorAll(`br`)).toHaveLength(2)
		})

		act(() => {
			expect(
				editor?.dispatchCommand(CONTROLLED_TEXT_INSERTION_COMMAND, ``),
			).toBe(true)
			expect(
				editor?.dispatchCommand(
					CONTROLLED_TEXT_INSERTION_COMMAND,
					new InputEvent(`beforeinput`, {
						data: `marker`,
						inputType: `insertText`,
					}),
				),
			).toBe(true)
		})
		await waitFor(() => {
			expect(root.textContent).toBe(`alphamarker1. item`)
			expect(root.querySelectorAll(`br`)).toHaveLength(2)
		})
	})

	test(`projects an empty authoritative value without replacing the editor root`, async () => {
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
			selections: [],
		}
		const rendered = render(
			<MosaicLexicalTextEditor {...properties} value="alpha" />,
		)
		const editor = await rendered.findByRole(`textbox`)
		fireEvent(
			editor,
			new InputEvent(`textInput`, {
				bubbles: true,
				cancelable: true,
				data: `x`,
				inputType: `insertText`,
			}),
		)
		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selection={[1, 1]}
				value="alpha"
			/>,
		)
		rendered.rerender(<MosaicLexicalTextEditor {...properties} value="" />)
		await waitFor(() => {
			expect(editor.textContent).toBe(``)
		})
		expect(rendered.getByRole(`textbox`)).toBe(editor)
	})
	test(`preserves its focused root across authoritative projection updates`, async () => {
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
			selections: [],
		}
		const rendered = render(
			<MosaicLexicalTextEditor {...properties} value="alpha" />,
		)
		const editor = await rendered.findByRole(`textbox`)
		await waitFor(() => {
			expect(editor.textContent).toBe(`alpha`)
		})
		editor.focus()
		expect(document.activeElement).toBe(editor)

		rendered.rerender(<MosaicLexicalTextEditor {...properties} value="alpha!" />)
		await waitFor(() => {
			expect(editor.textContent).toBe(`alpha!`)
		})
		expect(rendered.getByRole(`textbox`)).toBe(editor)
		expect(document.activeElement).toBe(editor)
	})

	test(`does not clamp a future collaborator caret to the current document end`, async () => {
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
			selections: [
				{
					color: `#f00`,
					end: 8,
					name: `Lin`,
					session: `lin-session`,
					start: 8,
				},
			],
		}
		const rendered = render(
			<MosaicLexicalTextEditor {...properties} value="alpha" />,
		)
		await rendered.findByRole(`textbox`)
		await new Promise((resolve) => requestAnimationFrame(resolve))
		expect(rendered.container.querySelector(`collaborator-presence`)).toBeNull()

		rendered.rerender(
			<MosaicLexicalTextEditor {...properties} value="alphabet!" />,
		)
		await waitFor(() => {
			const presence = rendered.container.querySelector(
				`collaborator-presence[data-session="lin-session"]`,
			)
			expect(presence?.getAttribute(`data-selection-start`)).toBe(`8`)
			expect(presence?.getAttribute(`data-selection-end`)).toBe(`8`)
		})
	})

	test(`advances collaborator semantics in the projection render`, async () => {
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
		}
		const rendered = render(
			<MosaicLexicalTextEditor
				{...properties}
				selections={[
					{
						color: `#f00`,
						end: 6,
						name: `Lin`,
						session: `lin-session`,
						start: 6,
					},
				]}
				value="alpha kind"
			/>,
		)
		await rendered.findByRole(`textbox`)
		await waitFor(() => {
			expect(
				rendered.container
					.querySelector(`collaborator-presence`)
					?.getAttribute(`data-selection-end`),
			).toBe(`6`)
		})

		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selections={[
					{
						color: `#f00`,
						end: 7,
						name: `Lin`,
						session: `lin-session`,
						start: 7,
					},
				]}
				value="xalpha kind"
			/>,
		)
		await waitFor(() => {
			expect(
				rendered.container
					.querySelector(`collaborator-presence`)
					?.getAttribute(`data-selection-end`),
			).toBe(`7`)
		})
	})

	test(`moves carets and reversed selections across remote prefixes`, () => {
		expect(
			transformMosaicTextSelection(`alpha omega`, `prefix alpha omega`, [6, 6]),
		).toEqual([13, 13])
		expect(
			transformMosaicTextSelection(
				`prefix alpha omega`,
				`prefix more alpha omega`,
				[18, 13],
			),
		).toEqual([23, 18])
		expect(
			transformMosaicTextSelection(`prefix alpha`, `prefix`, [12, 12]),
		).toEqual([6, 6])
		expect(transformMosaicTextSelection(`alpha`, `alpha!`, [2, 2])).toEqual([
			2, 2,
		])
	})

	test(`locates leading, interior, and trailing empty-line carets`, () => {
		expect(lineStartCaretReference(`\nalpha`, 0)).toEqual({
			index: 1,
			lineDelta: -1,
		})
		expect(lineStartCaretReference(`alpha\n\nbeta`, 6)).toEqual({
			index: 7,
			lineDelta: -1,
		})
		expect(lineStartCaretReference(`alpha\n\n`, 7)).toEqual({
			index: 4,
			lineDelta: 2,
		})
		expect(lineStartCaretReference(`alpha\n`, 7)).toEqual({
			index: 4,
			lineDelta: 1,
		})
		expect(lineStartCaretReference(`alpha\nbeta`, 3)).toBeNull()
	})

	test(`locates interior and terminal nonempty line ends`, () => {
		expect(lineEndCaretReference(`alpha\nbeta`, 5)).toBe(4)
		expect(lineEndCaretReference(`alpha\nbeta`, 10)).toBe(9)
		expect(lineEndCaretReference(`alpha\nbeta`, 7)).toBeNull()
		expect(lineEndCaretReference(`alpha\n`, 6)).toBeNull()
		expect(lineEndCaretReference(``, 0)).toBeNull()
	})

	test(`restores the last focused DOM caret across a remote prefix`, async () => {
		let reported: readonly [number, number] | null = null
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: (anchor: number, head: number) => {
				reported = [anchor, head]
			},
			onUndo: () => undefined,
			onValueChange: () => undefined,
			selections: [],
		}
		const rendered = render(
			<MosaicLexicalTextEditor {...properties} value="alpha omega" />,
		)
		const editor = await rendered.findByRole(`textbox`)
		await waitFor(() => {
			expect(editor.textContent).toBe(`alpha omega`)
		})
		const text = editor.querySelector(`span`)?.firstChild ?? null
		expect(text).toBeInstanceOf(Text)
		const selection = getSelection()
		expect(selection).not.toBeNull()
		await act(async () => {
			selection!.setBaseAndExtent(text!, 6, text!, 6)
			editor.focus()
			await Promise.resolve()
		})
		await waitFor(() => {
			expect(reported).toEqual([6, 6])
		})

		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selection={[13, 13]}
				value="prefix alpha omega"
			/>,
		)
		await waitFor(() => {
			expect(editor.textContent).toBe(`prefix alpha omega`)
		})
		await waitFor(() => {
			const restored = getSelection()
			expect(restored?.anchorOffset).toBe(13)
			expect(restored?.focusOffset).toBe(13)
		})
		expect(reported).toEqual([6, 6])
		expect(document.activeElement).toBe(editor)
	})

	test(`preserves explicit blank-line nodes across authoritative projections`, async () => {
		const properties = {
			onError: (error: Error) => {
				throw error
			},
			onRedo: () => undefined,
			onSelectionChange: () => undefined,
			onUndo: () => undefined,
			onValueChange: () => undefined,
			selection: [6, 6] as const,
			selections: [],
		}
		const rendered = render(
			<MosaicLexicalTextEditor {...properties} value={`alpha\n\n1. item`} />,
		)
		const editor = await rendered.findByRole(`textbox`)
		await waitFor(() => {
			expect(editor.querySelectorAll(`br`)).toHaveLength(2)
		})
		await waitFor(() => {
			const selection = getSelection()
			expect(selection?.anchorNode).toBe(editor.querySelector(`p`))
			expect(selection?.anchorOffset).toBe(2)
			expect(selection?.focusNode).toBe(editor.querySelector(`p`))
			expect(selection?.focusOffset).toBe(2)
		})

		rendered.rerender(
			<MosaicLexicalTextEditor
				{...properties}
				selection={[6, 6]}
				value={`alpha\n\n1. item!`}
			/>,
		)
		await waitFor(() => {
			expect(editor.querySelectorAll(`br`)).toHaveLength(2)
		})
		await waitFor(() => {
			const selection = getSelection()
			expect(selection?.anchorNode).toBe(editor.querySelector(`p`))
			expect(selection?.anchorOffset).toBe(2)
		})
	})

	test(`inserts text at a blank-line element boundary`, async () => {
		const editor = createEditor({
			onError: (error) => {
				throw error
			},
		})
		await new Promise<void>((resolve) => {
			editor.update(
				() => {
					const root = $getRoot()
					const paragraph = $createParagraphNode().append(
						$createTextNode(`alpha`),
						$createLineBreakNode(),
						$createLineBreakNode(),
						$createTextNode(`1. item`),
					)
					root.clear().append(paragraph)
					paragraph.select(2, 2)
					const selection = $getSelection()
					expect($isRangeSelection(selection)).toBe(true)
					if (!$isRangeSelection(selection)) return
					expect($insertTextAtBlankLineBoundary(selection, `marker`)).toBe(true)
					expect(root.getTextContent()).toBe(`alpha\nmarker\n1. item`)
					expect($getRootRelativeSelectionOffsets(selection)).toEqual([12, 12])
				},
				{ onUpdate: resolve },
			)
		})
	})

	test(`inserts text on an empty row represented after consecutive breaks`, async () => {
		const editor = createEditor({
			onError: (error) => {
				throw error
			},
		})
		await new Promise<void>((resolve) => {
			editor.update(
				() => {
					const root = $getRoot()
					const paragraph = $createParagraphNode().append(
						$createTextNode(`alpha`),
						$createLineBreakNode(),
						$createLineBreakNode(),
						$createTextNode(`1. item`),
					)
					root.clear().append(paragraph)
					paragraph.select(3, 3)
					const selection = $getSelection()
					expect($isRangeSelection(selection)).toBe(true)
					if (!$isRangeSelection(selection)) return
					expect($insertTextAtBlankLineBoundary(selection, `marker`)).toBe(true)
					expect(root.getTextContent()).toBe(`alpha\n\nmarker\n1. item`)
					expect($getRootRelativeSelectionOffsets(selection)).toEqual([13, 13])
				},
				{ onUpdate: resolve },
			)
		})
	})

	test(`reports and restores a root-relative caret after Enter`, async () => {
		const editor = createEditor({
			onError: (error) => {
				throw error
			},
		})
		await new Promise<void>((resolve) => {
			editor.update(
				() => {
					const root = $getRoot()
					const first = $createParagraphNode().append($createTextNode(`alpha`))
					const second = $createParagraphNode()
					root.clear().append(first, second)
					second.select(0, 0)
					const entered = $getSelection()
					expect($isRangeSelection(entered)).toBe(true)
					if (!$isRangeSelection(entered)) return
					const offsets = $getRootRelativeSelectionOffsets(entered)
					expect(root.getTextContent()).toBe(`alpha\n\n`)
					expect(offsets).toEqual([7, 7])
					expect($pointAtRootOffset(root, 7)).toEqual({
						node: second,
						offset: 0,
					})

					const projected = $createParagraphNode()
					const text = $createTextNode(root.getTextContent())
					projected.append(text)
					root.clear().append(projected)
					$setSelection(
						$createRangeSelection().setTextNodeRange(
							text,
							offsets[0],
							text,
							offsets[1],
						),
					)
					const restored = $getSelection()
					expect($isRangeSelection(restored)).toBe(true)
					if ($isRangeSelection(restored)) {
						expect($getRootRelativeSelectionOffsets(restored)).toEqual([7, 7])
					}
				},
				{ onUpdate: resolve },
			)
		})
	})

	test(`maps element, break, empty-root, and detached selection points`, async () => {
		const editor = createEditor({
			onError: (error) => {
				throw error
			},
		})
		await new Promise<void>((resolve) => {
			editor.update(
				() => {
					const root = $getRoot()
					expect($pointAtRootOffset(root, 0)).toEqual({ node: root, offset: 0 })

					const paragraph = $createParagraphNode().append(
						$createTextNode(`alpha`),
						$createLineBreakNode(),
						$createTextNode(`beta`),
					)
					root.append(paragraph)
					expect($pointAtRootOffset(root, 5)).toEqual({
						node: paragraph,
						offset: 1,
					})
					paragraph.select(0, 0)
					const ordinaryBoundary = $getSelection()
					expect($isRangeSelection(ordinaryBoundary)).toBe(true)
					if ($isRangeSelection(ordinaryBoundary)) {
						expect(
							$insertTextAtBlankLineBoundary(ordinaryBoundary, `ignored`),
						).toBe(false)
					}
					paragraph.select(0, 1)
					const noncollapsed = $getSelection()
					expect($isRangeSelection(noncollapsed)).toBe(true)
					if ($isRangeSelection(noncollapsed)) {
						expect($insertTextAtBlankLineBoundary(noncollapsed, `ignored`)).toBe(
							false,
						)
					}

					const firstText = paragraph.getFirstChild()
					expect($isTextNode(firstText)).toBe(true)
					if (!$isTextNode(firstText)) return
					firstText.select(2, 2)
					const textSelection = $getSelection()
					expect($isRangeSelection(textSelection)).toBe(true)
					if ($isRangeSelection(textSelection)) {
						expect(
							$insertTextAtBlankLineBoundary(textSelection, `ignored`),
						).toBe(false)
					}

					const trailing = $createParagraphNode().append(
						$createTextNode(`tail`),
						$createLineBreakNode(),
					)
					$setSelection(null)
					root.clear().append(trailing)
					trailing.select(2, 2)
					const trailingSelection = $getSelection()
					expect($isRangeSelection(trailingSelection)).toBe(true)
					if ($isRangeSelection(trailingSelection)) {
						expect(
							$insertTextAtBlankLineBoundary(trailingSelection, `append`),
						).toBe(true)
					}
					expect(root.getTextContent()).toBe(`tail\nappend`)

					const first = $createParagraphNode().append($createTextNode(`first`))
					const second = $createParagraphNode().append($createTextNode(`second`))
					$setSelection(null)
					root.clear().append(first, second)
					expect($pointAtRootOffset(root, 6)).toEqual({ node: root, offset: 1 })
					const elementSelection = $createRangeSelection()
					elementSelection.anchor.set(second.getKey(), 0, `element`)
					elementSelection.focus.set(second.getKey(), 0, `element`)
					$setSelection(elementSelection)
					expect($getRootRelativeSelectionOffsets(elementSelection)).toEqual([
						7, 7,
					])
					const rootSelection = $createRangeSelection()
					rootSelection.anchor.set(root.getKey(), 1, `element`)
					rootSelection.focus.set(root.getKey(), 1, `element`)
					$setSelection(rootSelection)
					expect($getRootRelativeSelectionOffsets(rootSelection)).toEqual([7, 7])

					const detached = $createParagraphNode()
					detached.selectStart()
					const detachedSelection = $getSelection()
					expect($isRangeSelection(detachedSelection)).toBe(true)
					if ($isRangeSelection(detachedSelection)) {
						expect(() =>
							$getRootRelativeSelectionOffsets(detachedSelection),
						).toThrow(`outside the Markdown root`)
					}
					$setSelection(null)
				},
				{ onUpdate: resolve },
			)
		})
	})
})
