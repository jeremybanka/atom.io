import { render, waitFor } from "@testing-library/react"
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
