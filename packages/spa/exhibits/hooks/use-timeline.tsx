import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter, useTimeline } from "@atom.io/spa"
import { atom, timeline } from "atom.io"

export const noteAtom = atom<string>({ key: `note`, default: `` })
const noteHistoryTimeline = timeline({ key: `noteHistory`, scope: [noteAtom] })

export default function UndoNote(): SpaElement {
	const getNote = useGetter(noteAtom)
	const setNote = useSetter(noteAtom)
	const history = useTimeline(noteHistoryTimeline)
	return (
		<>
			<input
				aria-label="Note"
				value={getNote()}
				onInput={(event) => {
					setNote(event.currentTarget.value)
				}}
			/>
			<button disabled={history.getCursor() === 0} onClick={history.undo}>
				Undo typing
			</button>
		</>
	)
}
