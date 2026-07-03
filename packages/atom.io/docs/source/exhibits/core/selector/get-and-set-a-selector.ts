import { atom, getState, selector, setState } from "atom.io"

const priceInCentsAtom = atom<number>({
	key: `priceInCents`,
	default: 0,
})

const priceInDollarsSelector = selector<number>({
	key: `priceInDollars`,
	get: ({ get }) => get(priceInCentsAtom) / 100,
	set: ({ set }, dollars) => {
		set(priceInCentsAtom, Math.round(dollars * 100))
	},
})

getState(priceInDollarsSelector) // -> 0

setState(priceInDollarsSelector, 12.34)

getState(priceInCentsAtom) // -> 1234
getState(priceInDollarsSelector) // -> 12.34
