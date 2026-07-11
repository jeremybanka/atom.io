import {
	createRegularAtomFamily,
	findInStore,
	getFromStore,
	type RootStore,
	Store,
} from "atom.io/internal"
import * as v from "vitest"

type ComplexKey = readonly (number | string)[]

function makeComplexKey(seed: number): ComplexKey {
	return [
		`key:${seed}`,
		...Array.from({ length: 256 }, (_, index) => seed * 1_000 + index),
	]
}

function makeStore(name: string): RootStore {
	const store = new Store({
		name,
		lifespan: `ephemeral`,
		isProduction: true,
	}) as RootStore
	store.loggers[0].logLevel = null
	return store
}

function makeFamily(store: RootStore, key: string) {
	return createRegularAtomFamily<number, ComplexKey, never>(store, {
		key,
		default: 0,
	})
}

const readStore = makeStore(`family-key-read-benchmark`)
const readFamily = makeFamily(readStore, `family-key-read-benchmark`)
const readToken = findInStore(readStore, readFamily, makeComplexKey(1))
getFromStore(readStore, readToken)

const findStore = makeStore(`family-key-find-benchmark`)
const findFamily = makeFamily(findStore, `family-key-find-benchmark`)
const missingKey = makeComplexKey(2)

const creationKeys = Array.from({ length: 8 }, (_, index) =>
	makeComplexKey(index + 10),
)

v.describe(`family key serialization`, () => {
	v.bench(
		`read an existing member token`,
		() => {
			getFromStore(readStore, readToken)
		},
		{ time: 750, warmupTime: 250 },
	)

	v.bench(
		`find an uncreated member`,
		() => {
			findInStore(findStore, findFamily, missingKey)
		},
		{ time: 750, warmupTime: 250 },
	)

	v.bench(
		`create eight complex-key members`,
		() => {
			const store = makeStore(`family-key-create-benchmark`)
			const family = makeFamily(store, `family-key-create-benchmark`)
			for (const key of creationKeys) {
				getFromStore(store, family, key)
			}
		},
		{ time: 750, warmupTime: 250 },
	)
})
