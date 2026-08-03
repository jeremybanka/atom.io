import { atom, timeline } from "atom.io"

export const documentAtom = atom<string>({
	key: `document`,
	default: ``,
})

export const documentTimeline = timeline({
	key: `document`,
	scope: [documentAtom],
	retention: {
		maxUndoSteps: 100,
		overflow: `drop-oldest`,
	},
})
