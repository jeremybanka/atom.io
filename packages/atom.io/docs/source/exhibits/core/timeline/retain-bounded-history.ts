import type { TimelineEffect } from "atom.io"
import { atom, timeline } from "atom.io"

export const documentAtom = atom<string>({
	key: `document`,
	default: ``,
})

export const keepLatest100Steps: TimelineEffect = ({
	cullUndoSteps,
	onRecord,
}) => {
	onRecord(() => {
		cullUndoSteps(100)
	})
}

export const documentTimeline = timeline({
	key: `document`,
	scope: [documentAtom],
	effects: [keepLatest100Steps],
})
