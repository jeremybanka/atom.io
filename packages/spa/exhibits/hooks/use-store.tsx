import type { VNode } from "@atom.io/spa"
import { useStore } from "@atom.io/spa"
import { atom } from "atom.io"
import { getFromStore } from "atom.io/internal"

export const draftTextAtom = atom<string>({ key: `draftText`, default: `` })

export function CopyDraft(): VNode {
	const store = useStore()
	return (
		<button
			onClick={() => {
				void navigator.clipboard.writeText(getFromStore(store, draftTextAtom))
			}}
		>
			Copy draft
		</button>
	)
}
