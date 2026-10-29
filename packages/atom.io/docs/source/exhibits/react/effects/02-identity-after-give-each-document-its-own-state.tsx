import { useI, useO } from "@atom.io/react"
import { atomFamily, disposeState } from "atom.io"

import { DraftForm } from "./views.tsx"

const draftAtoms = atomFamily<string, string>({
	key: `draft`,
	default: ``,
})
export function Editor({ documentId }: { documentId: string }) {
	const draft = useO(draftAtoms, documentId)
	const setDraft = useI(draftAtoms, documentId)
	return <DraftForm text={draft} onChange={setDraft} label={documentId} />
}
// The document controller calls this when closing a document discards its draft.
export function closeDocument(documentId: string): void {
	disposeState(draftAtoms, documentId)
}
