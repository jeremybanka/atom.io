import {
	atom,
	atomFamily,
	selector,
	timeline,
	timelineFamily,
	transaction,
} from "atom.io"

type User = {
	id: string
	name: string
}

export const countAtom = atom<number>({
	key: `count`,
	default: 0,
})

export const userAtoms = atomFamily<User, string>({
	key: `user`,
	default: (id) => ({ id, name: `` }),
})

export const countLabelSelector = selector<string>({
	key: `countLabel`,
	get: ({ get }) => `${get(countAtom)} users`,
})

export const countTimeline = timeline({
	key: `count`,
	scope: [countAtom],
})

export const userTimelines = timelineFamily<string>({
	key: `user`,
	scope: [],
})

export const resetTransaction = transaction<() => void>({
	key: `reset`,
	do: ({ reset }) => {
		reset(countAtom)
	},
})

// `userAtoms` with `key: "users"` would be reported and autofixed to `"user"`.
