import { Silo } from "atom.io"
import { Group } from "three"

export const firstStore = new Silo({
	name: `first`,
	lifespan: `ephemeral`,
	isProduction: true,
})
export const secondStore = new Silo({
	name: `second`,
	lifespan: `ephemeral`,
	isProduction: true,
})
export const firstCountAtom = firstStore.atom<number>({
	key: `firstCount`,
	default: 0,
})
export const secondCountAtom = secondStore.atom<number>({
	key: `secondCount`,
	default: 10,
})
export const firstHistoryTimeline = firstStore.timeline({
	key: `firstHistory`,
	scope: [firstCountAtom],
})
export const secondHistoryTimeline = secondStore.timeline({
	key: `secondHistory`,
	scope: [secondCountAtom],
})
export const parents = new Map([
	[`first`, new Group()],
	[`second`, new Group()],
	[`standalone`, new Group()],
])
export const cleanups = { dom: 0, scene: 0 }
export const refs: Record<string, HTMLButtonElement | null> = {}
