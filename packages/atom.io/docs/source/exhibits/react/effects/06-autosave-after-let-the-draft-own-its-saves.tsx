import { useI, useO } from "@atom.io/react"
import { atomFamily, disposeState } from "atom.io"

import { createAutosaver } from "./helpers.ts"
import { DraftForm } from "./views.tsx"

type Draft = { text: string; status: string }
const draftAtoms = atomFamily<Draft, string>({
	key: `draft`,
	default: { text: ``, status: `Ready` },
	effects: (draftId) => [
		({ onSet, setSelf }) => {
			const autosave = createAutosaver(draftId, (status) => {
				setSelf((draft) => ({ ...draft, status }))
			})
			onSet(({ newValue, oldValue }) => {
				if (newValue.text !== oldValue?.text) autosave.schedule(newValue.text)
			})
			return autosave.cancel
		},
	],
})
export function DraftEditor({ draftId }: { draftId: string }) {
	const draft = useO(draftAtoms, draftId)
	const setDraft = useI(draftAtoms, draftId)
	const edit = (text: string) => setDraft((current) => ({ ...current, text }))
	return <DraftForm {...draft} onChange={edit} />
}
export function discardDraft(draftId: string): void {
	disposeState(draftAtoms, draftId)
}
