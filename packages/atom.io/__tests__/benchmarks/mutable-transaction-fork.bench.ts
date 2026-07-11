import { Silo } from "atom.io"
import { OList } from "atom.io/transceivers/o-list"
import { UList } from "atom.io/transceivers/u-list"
import * as v from "vitest"

const SIZES = [1_000, 10_000, 30_000] as const
const OPTIONS = {
	time: 400,
	iterations: 10,
	warmupTime: 100,
	warmupIterations: 3,
} as const

function prepareUList(size: number): () => void {
	const prefix = `benchmark/mutable-transaction-fork/u-list/${size}`
	const silo = makeSilo(prefix)
	const stateAtom = silo.mutableAtom<UList<number>>({
		// eslint-disable-next-line atom.io/naming-convention -- benchmark cases need unique state keys
		key: `${prefix}/state`,
		class: UList,
	})
	silo.setState(
		stateAtom,
		new UList(Array.from({ length: size }, (_, index) => index)),
	)
	const mutate = silo.transaction<() => void>({
		key: `${prefix}/transaction`,
		do: ({ set }) => {
			set(stateAtom, (list) => {
				if (list.has(-1)) list.delete(-1)
				else list.add(-1)
				return list
			})
		},
	})
	return silo.runTransaction(mutate, `${prefix}/instance`)
}

function prepareOList(size: number): () => void {
	const prefix = `benchmark/mutable-transaction-fork/o-list/${size}`
	const silo = makeSilo(prefix)
	const stateAtom = silo.mutableAtom<OList<number>>({
		// eslint-disable-next-line atom.io/naming-convention -- benchmark cases need unique state keys
		key: `${prefix}/state`,
		class: OList,
	})
	const values = Array.from({ length: size }, (_, index) => index + 1)
	silo.setState(stateAtom, new OList<number>(...values))
	const mutate = silo.transaction<() => void>({
		key: `${prefix}/transaction`,
		do: ({ set }) => {
			set(stateAtom, (list) => {
				list[0] = list[0] === -1 ? -2 : -1
				return list
			})
		},
	})
	return silo.runTransaction(mutate, `${prefix}/instance`)
}

function makeSilo(name: string): Silo {
	const silo = new Silo({
		name,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.store.loggers[0].logLevel = null
	return silo
}

for (const size of SIZES) {
	v.bench(`${size} item UList`, prepareUList(size), OPTIONS)
	v.bench(`${size} item OList`, prepareOList(size), OPTIONS)
}
