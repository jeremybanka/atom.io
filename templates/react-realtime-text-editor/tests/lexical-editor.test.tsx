import { act, render, waitFor } from "@testing-library/react"
import {
	$createParagraphNode,
	$createRangeSelection,
	$createTextNode,
	$getRoot,
	$getSelection,
	$isRangeSelection,
	$setSelection,
	createEditor,
} from "lexical"

import { LexicalMarkdownEditor } from "../src/LexicalMarkdownEditor.tsx"
import {
	$getRootRelativeSelectionOffsets,
	$pointAtRootOffset,
	transformSelectionAcrossTextChange,
} from "../src/lexical-linear-offset.ts"

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
			<LexicalMarkdownEditor {...properties} value="alpha" />,
		)
		const editor = await rendered.findByRole(`textbox`)
		await waitFor(() => expect(editor.textContent).toBe(`alpha`))
		editor.focus()
		expect(document.activeElement).toBe(editor)

		rendered.rerender(<LexicalMarkdownEditor {...properties} value="alpha!" />)
		await waitFor(() => expect(editor.textContent).toBe(`alpha!`))
		expect(rendered.getByRole(`textbox`)).toBe(editor)
		expect(document.activeElement).toBe(editor)
	})

	test(`moves carets and reversed selections across remote prefixes`, () => {
		expect(
			transformSelectionAcrossTextChange(
				`alpha omega`,
				`prefix alpha omega`,
				[6, 6],
			),
		).toEqual([13, 13])
		expect(
			transformSelectionAcrossTextChange(
				`prefix alpha omega`,
				`prefix more alpha omega`,
				[18, 13],
			),
		).toEqual([23, 18])
		expect(
			transformSelectionAcrossTextChange(`prefix alpha`, `prefix`, [12, 12]),
		).toEqual([6, 6])
		expect(
			transformSelectionAcrossTextChange(`alpha`, `alpha!`, [2, 2]),
		).toEqual([2, 2])
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
			<LexicalMarkdownEditor {...properties} value="alpha omega" />,
		)
		const editor = await rendered.findByRole(`textbox`)
		await waitFor(() => expect(editor.textContent).toBe(`alpha omega`))
		const text = editor.querySelector(`span`)?.firstChild ?? null
		expect(text).toBeInstanceOf(Text)
		const selection = getSelection()
		expect(selection).not.toBeNull()
		await act(async () => {
			selection!.setBaseAndExtent(text!, 6, text!, 6)
			editor.focus()
			await Promise.resolve()
		})
		await waitFor(() => expect(reported).toEqual([6, 6]))

		rendered.rerender(
			<LexicalMarkdownEditor
				{...properties}
				selection={[13, 13]}
				value="prefix alpha omega"
			/>,
		)
		await waitFor(() => expect(editor.textContent).toBe(`prefix alpha omega`))
		await waitFor(() => {
			const restored = getSelection()
			expect(restored?.anchorOffset).toBe(13)
			expect(restored?.focusOffset).toBe(13)
		})
		expect(reported).toEqual([6, 6])
		expect(document.activeElement).toBe(editor)
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
