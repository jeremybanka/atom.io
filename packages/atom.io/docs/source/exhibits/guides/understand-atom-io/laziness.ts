import { atom, getState, selector, setState } from "atom.io"

const countAtom = atom<number>({
	key: `count`,
	default: 0,
})

const doubledSelector = selector<number>({
	key: `doubled`,
	get: ({ get }) => {
		console.log(`computing doubledSelector`)
		return get(countAtom) * 2
	},
})

setState(countAtom, 2)
// Still nothing logged. No one has asked for doubledSelector yet.

getState(doubledSelector)
// Logs once and returns 4.
