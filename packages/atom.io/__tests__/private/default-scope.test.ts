import { Silo } from "atom.io"

import { getFallback } from "../../src/internal/get-state/get-fallback.ts"

const config = {
	name: `defaults`,
	lifespan: `ephemeral`,
	isProduction: true,
} as const
let active = `outside`
const inScope = <T>(name: string, run: () => T): T => {
	const previous = active
	active = name
	try {
		return run()
	} finally {
		active = previous
	}
}

it(`keeps definitions shared while defaults, lazy family members, resets, and transactions use their evaluating store`, () => {
	const definitions = new Silo(config)
	const valueAtom = definitions.atom<string>({
		key: `value`,
		default: () => active,
	})
	const valueAtoms = definitions.atomFamily<string, number>({
		key: `value`,
		default: (id: number) => `${active}:${id}`,
	})
	const refreshTransaction = definitions.transaction({
		key: `refresh`,
		do: ({ reset, get }) => {
			reset(valueAtom)
			return get(valueAtom)
		},
	})
	const first = new Silo(config, definitions.store)
	const second = new Silo(config, definitions.store)
	first.store.runDefault = (run) => inScope(`first`, run)
	second.store.runDefault = (run) => inScope(`second`, run)
	expect(first.getState(valueAtom)).toBe(`first`)
	expect(second.getState(valueAtom)).toBe(`second`)
	expect(first.getState(valueAtoms, 1)).toBe(`first:1`)
	expect(second.getState(valueAtoms, 2)).toBe(`second:2`)
	first.setState(valueAtom, `edited`)
	expect(first.runTransaction(refreshTransaction)()).toBe(`first`)
	second.resetState(valueAtoms, 2)
	expect(second.getState(valueAtoms, 2)).toBe(`second:2`)
	expect(active).toBe(`outside`)
	const copy = new Silo(config, first.store)
	expect(copy.getState(valueAtom)).toBe(`outside`)
})

it(`scopes family fallback evaluation too`, () => {
	const silo = new Silo(config)
	silo.store.logger.error = () => {}
	const fallbackAtoms = silo.atomFamily<string, number>({
		key: `fallback`,
		default: (id: number) => `${active}:${id}`,
	})
	silo.store.runDefault = (run) => inScope(`fallback`, run)
	const valueAtoms = silo.store.families.get(fallbackAtoms.key)!
	expect(
		getFallback(silo.store, { key: `fallback(3)`, type: `atom` }, valueAtoms, 3),
	).toBe(`fallback:3`)
})
