import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { DocumentPicker, DraftForm } from "./views.tsx"

export default function Editor(): ReactNode {
	const [documentId, setDocumentId] = useState(`Document A`)
	const [draft, setDraft] = useState(``)
	useEffect(() => {
		setDraft(``)
	}, [documentId])
	return (
		<>
			<DocumentPicker documentId={documentId} onChange={setDocumentId} />
			<DraftForm text={draft} onChange={setDraft} label={documentId} />
		</>
	)
}
