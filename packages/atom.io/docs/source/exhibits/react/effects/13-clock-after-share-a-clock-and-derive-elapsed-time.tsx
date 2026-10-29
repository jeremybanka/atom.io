import { useO } from "@atom.io/react"
import { atom, selectorFamily } from "atom.io"

import { every } from "./every.ts"

const clockAtom = atom<number>({
	key: `clock`,
	default: () => Date.now(),
	effects: [({ setSelf }) => every(1000, () => setSelf(Date.now()))],
})
const ageSelectors = selectorFamily<number, number>({
	key: `age`,
	get:
		(savedAt) =>
		({ get }) =>
			Math.floor((get(clockAtom) - savedAt) / 1000),
})
export function SavedLabel({ savedAt }: { savedAt: number }) {
	const seconds = useO(ageSelectors, savedAt)
	return <output>Saved {seconds} seconds ago</output>
}
