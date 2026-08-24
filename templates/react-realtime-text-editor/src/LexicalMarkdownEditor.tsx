import {
	MosaicLexicalTextEditor,
	type MosaicLexicalTextEditorProps,
} from "atom.io/realtime-react-lexical"
import type { ReactElement } from "react"

import css from "./LexicalMarkdownEditor.module.css"

export type { RenderedCollaboratorSelection } from "atom.io/realtime-react-lexical"

/** Template styling around Atom.io's supported Mosaic-to-Lexical adapter. */
export function LexicalMarkdownEditor(
	properties: MosaicLexicalTextEditorProps,
): ReactElement {
	return (
		<lexical-markdown-editor className={css.class}>
			<MosaicLexicalTextEditor {...properties} />
		</lexical-markdown-editor>
	)
}
