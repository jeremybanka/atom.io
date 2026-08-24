import { act, render, waitFor } from "@testing-library/react"
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
	$setSelection,
	createEditor,
} from "lexical"

describe(`Lexical Markdown editor`, () => {
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
		expect(
			rendered.container
				.querySelector(`collaborator-presence`)
				?.getAttribute(`data-selection-end`),
		).toBe(`7`)
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
					second.selectStart()
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
})
