import { atomFamily } from "atom.io"
import { createKeyContext, useO } from "atom.io/react"
import type { JSX } from "react/jsx-runtime"

type DocumentKey = `document::${string}`

const DocumentKey = createKeyContext<DocumentKey>(
	`DocumentKey`,
	`document::untitled`,
)
const documentTitleAtoms = atomFamily<string, DocumentKey>({
	key: `documentTitle`,
	default: `Untitled`,
})

function DocumentTitle(): JSX.Element {
	const documentKey = DocumentKey.use()
	const title = useO(documentTitleAtoms, documentKey)

	return <h2>{title}</h2>
}

export function DocumentPane(props: { documentKey: DocumentKey }): JSX.Element {
	return (
		<DocumentKey.Provider value={props.documentKey}>
			<DocumentTitle />
		</DocumentKey.Provider>
	)
}
