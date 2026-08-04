import { Silo } from "atom.io"
import { afterAll, bench, describe } from "vitest"

const WRITE_COUNT = 64

describe(`transaction commit with a shared downstream selector`, () => {
	const silo = new Silo({
		name: `transaction-atomic-commit-benchmark`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const valueAtoms = Array.from({ length: WRITE_COUNT }, (_, index) =>
		silo.atom<number>({ key: `value-${index}`, default: 0 }),
	)
	const totalSelector = silo.selector<number>({
		key: `total`,
		get: ({ get }) =>
			valueAtoms.reduce((sum, valueAtom) => sum + get(valueAtom), 0),
	})
	const incrementAllTransaction = silo.transaction<() => void>({
		key: `incrementAll`,
		do: ({ get, set }) => {
			for (const valueAtom of valueAtoms) {
				set(valueAtom, get(valueAtom) + 1)
			}
		},
	})
	const stop = silo.subscribe(totalSelector, () => {})

	bench(`64 writes feeding one selector`, () => {
		silo.runTransaction(incrementAllTransaction)()
	})

	afterAll(() => {
		stop()
	})
})
