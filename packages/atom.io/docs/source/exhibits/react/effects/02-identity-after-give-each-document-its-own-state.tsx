import { useI, useO } from "@atom.io/react"
import { atomFamily } from "atom.io"
import type { ReactNode } from "react"
import { useState } from "react"

import { DocumentPicker, DraftForm } from "./views.tsx"

const draftAtoms = atomFamily<string, string>({
	key: `draft`,
	default: ``,
})
export default function Editor(): ReactNode {
	const [documentId, setDocumentId] = useState(`Document A`)
	const draft = useO(draftAtoms, documentId)
	const setDraft = useI(draftAtoms, documentId)
	return (
		<>
			<DocumentPicker documentId={documentId} onChange={setDocumentId} />
			<DraftForm text={draft} onChange={setDraft} label={documentId} />
		</>
	)
}
