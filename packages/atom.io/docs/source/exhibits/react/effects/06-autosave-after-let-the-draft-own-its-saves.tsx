import { useI, useO } from "@atom.io/react"
import { atomFamily } from "atom.io"
import type { ReactNode } from "react"

import { createAutosaver } from "./helpers.ts"
import { DraftForm } from "./views.tsx"

type Draft = { text: string; status: string }
export const draftAtoms = atomFamily<Draft, string>({
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

export function DraftEditor({ draftId }: { draftId: string }): ReactNode {
	const draft = useO(draftAtoms, draftId)
	const setDraft = useI(draftAtoms, draftId)
	const edit = (text: string) => {
		setDraft((current) => ({ ...current, text }))
	}
	return <DraftForm {...draft} onChange={edit} />
}
