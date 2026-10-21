import {
	MosaicLexicalTextEditor,
	type MosaicLexicalTextEditorClassNames,
	type MosaicLexicalTextEditorProps,
} from "atom.io/realtime-react-lexical"
import type { ReactElement } from "react"

import "./LexicalMarkdownEditor.css"
import css from "./LexicalMarkdownEditor.module.css"

export type { RenderedCollaboratorSelection } from "atom.io/realtime-react-lexical"

const classNames = {
	caret: `LexicalMarkdownEditor_caret`,
	contentEditable: `LexicalMarkdownEditor_contentEditable`,
	editor: `LexicalMarkdownEditor_editor`,
	label: `LexicalMarkdownEditor_label`,
	overlays: `LexicalMarkdownEditor_overlays`,
	paragraph: `LexicalMarkdownEditor_paragraph`,
	placeholder: `LexicalMarkdownEditor_placeholder`,
	presence: `LexicalMarkdownEditor_presence`,
	selection: `LexicalMarkdownEditor_selection`,
} satisfies MosaicLexicalTextEditorClassNames

export type LexicalMarkdownEditorProps = Omit<
	MosaicLexicalTextEditorProps,
	`className` | `classNames`
>

/** Template-owned visual treatment for Atom.io's headless Lexical adapter. */
export function LexicalMarkdownEditor(
	properties: LexicalMarkdownEditorProps,
): ReactElement {
	return (
		<lexical-markdown-editor className={css.class}>
			<MosaicLexicalTextEditor
				/* @lasertag-adopt-subtree */
				{...properties}
				classNames={classNames}
			/>
		</lexical-markdown-editor>
	)
}
