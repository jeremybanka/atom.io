import type { VNode } from "@atom.io/spa"
import { useTimeline } from "@atom.io/spa"
import { atom, timeline } from "atom.io"

export const noteAtom = atom<string>({ key: `note`, default: `` })
const noteHistoryTimeline = timeline({ key: `noteHistory`, scope: [noteAtom] })

export function UndoNote(): VNode {
	const history = useTimeline(noteHistoryTimeline)
	return (
		<button disabled={history.getCursor() === 0} onClick={history.undo}>
			Undo typing
		</button>
	)
}
