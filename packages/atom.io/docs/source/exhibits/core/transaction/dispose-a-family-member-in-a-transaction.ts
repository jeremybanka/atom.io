import { atom, atomFamily, transaction } from "atom.io"

type Draft = {
	id: string
	title: string
}

export const draftAtoms = atomFamily<Draft, string>({
	key: `draft`,
	default: (id) => ({ id, title: `` }),
})

export const draftKeysAtom = atom<string[]>({
	key: `draftKeys`,
	default: [],
})

export const deleteDraftTransaction = transaction<(draftId: string) => void>({
	key: `deleteDraft`,
	do: ({ dispose, get, set }, draftId) => {
		const draftIds = get(draftKeysAtom)
		if (!draftIds.includes(draftId)) return

		set(
			draftKeysAtom,
			draftIds.filter((id) => id !== draftId),
		)
		dispose(draftAtoms, draftId)
	},
})
