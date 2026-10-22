import type { MosaicTextEditorView } from "@atom.io/realtime/react"
import { MosaicLexicalTextEditor } from "@atom.io/realtime/react/lexical"
import type { JSX } from "react"

type Collaborator = {
	readonly color: string
	readonly name: string
}

type Props = {
	readonly editor: MosaicTextEditorView<Collaborator>
	readonly onError: (error: Error) => void
	readonly onRedo: () => void
	readonly onUndo: () => void
}

export function CollaborativeLexicalSurface({
	editor,
	onError,
	onRedo,
	onUndo,
}: Props): JSX.Element {
	return (
		<MosaicLexicalTextEditor
			onDirty={editor.onDirty}
			onError={onError}
			onRedo={onRedo}
			onSelectionChange={editor.onSelectionChange}
			onUndo={onUndo}
			onValueChange={editor.onValueChange}
			selection={editor.selection}
			selections={editor.remoteSelections.map(({ end, id, start, value }) => ({
				color: value.color,
				end,
				name: value.name,
				session: id,
				start,
			}))}
			value={editor.text}
		/>
	)
}
