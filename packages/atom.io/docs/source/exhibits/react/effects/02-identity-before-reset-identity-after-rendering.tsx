import { useEffect, useState } from "react"

import { DraftForm } from "./views.tsx"

export function Editor({ documentId }: { documentId: string }) {
	const [draft, setDraft] = useState(``)
	useEffect(() => {
		setDraft(``)
	}, [documentId])
	return <DraftForm text={draft} onChange={setDraft} label={documentId} />
}
