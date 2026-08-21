import { render, waitFor } from "@testing-library/react"

import { LexicalMarkdownEditor } from "../src/LexicalMarkdownEditor.tsx"

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
})
