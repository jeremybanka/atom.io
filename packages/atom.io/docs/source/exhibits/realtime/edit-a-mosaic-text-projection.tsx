import type { MosaicTextSelection } from "atom.io/realtime"
import type { MosaicTextProjectionClient } from "atom.io/realtime-client"
import {
	type MosaicTextEditorRemoteSelection,
	useMosaicTextEditor,
	useMosaicTextRange,
} from "atom.io/realtime-react"
import type { JSX } from "react"

type Collaborator = {
	readonly color: string
	readonly name: string
}

type EditorSurfaceProps = {
	readonly onDirty: () => void
	readonly onSelectionChange: (anchor: number, head: number) => void
	readonly onValueChange: (value: string, composing: boolean) => void
	readonly remoteSelections: readonly MosaicTextEditorRemoteSelection<Collaborator>[]
	readonly selection: readonly [number, number] | null
	readonly value: string
}

declare const EditorSurface: (props: EditorSurfaceProps) => JSX.Element
declare const client: MosaicTextProjectionClient
declare const connected: boolean
declare const documentLength: number
declare const peers: readonly {
	readonly id: string
	readonly selection: MosaicTextSelection | null
	readonly value: Collaborator
}[]
declare const publishSelection: (selection: MosaicTextSelection) => Promise<void>

export function CollaborativeTextEditor(): JSX.Element {
	const range = useMosaicTextRange(client, {
		end: Math.min(documentLength, 16_384),
		kind: `utf16-range`,
		start: 0,
	})
	const projection = range.status === `ready` ? range.projection : null
	const editor = useMosaicTextEditor({
		client,
		connected,
		documentLength,
		peers,
		projection,
		publishSelection,
		replace: ({ selection, text }) =>
			client.edit({
				anchor: selection.anchor,
				head: selection.head,
				text,
				type: `replace`,
			}),
	})

	if (editor.projection === null) return <p>Loading text…</p>
	return (
		<EditorSurface
			onDirty={editor.onDirty}
			onSelectionChange={editor.onSelectionChange}
			onValueChange={editor.onValueChange}
			remoteSelections={editor.remoteSelections}
			selection={editor.selection}
			value={editor.text}
		/>
	)
}
