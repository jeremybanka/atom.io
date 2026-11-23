import type { Loadable } from "atom.io"
import { atom, selector } from "atom.io"

export const trailIdAtom = atom<string>({
	key: `trailId`,
	default: `lake-loop`,
})

export const trailDistanceKmSelector = selector<Loadable<number>, Error>({
	key: `trailDistanceKm`,
	catch: [Error],
	get: async ({ get }) => {
		const trailId = get(trailIdAtom)
		const response = await fetch(
			`/exhibit-data/trails/${encodeURIComponent(trailId)}.json`,
		)
		if (!response.ok) throw new Error(`Could not load trail "${trailId}"`)
		const trail: { distanceKm: number } = await response.json()
		return trail.distanceKm
	},
})
