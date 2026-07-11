import { Silo } from "atom.io"
import { bench, describe } from "vitest"

import { createNullLogger } from "../__util__/nullLogger.ts"

const COMMIT_MODE =
	process.env[`ATOM_IO_BENCHMARK_COMMIT`] === `batched` ? `batched` : `playback`
const COMMIT_OPTION = { commit: COMMIT_MODE } as const

type BenchmarkHarness = {
	run: () => void
}

function createBenchmarkHarness(
	writes: number,
	selectorCount: number,
): BenchmarkHarness {
	const silo = new Silo({
		name: `transaction-commit-${writes}-${selectorCount}`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.store.logger = createNullLogger()

	const valueAtoms = Array.from({ length: writes }, (_, index) =>
		silo.atom<number>({
			key: `value-${index}`,
			default: 0,
		}),
	)
	const totalSelectors = Array.from({ length: selectorCount }, (_, index) =>
		silo.selector<number>({
			key: `total-${index}`,
			get: ({ get }) => {
				let total = 0
				for (const valueAtom of valueAtoms) {
					total += get(valueAtom)
				}
				return total
			},
		}),
	)
	for (const [index, totalSelector] of totalSelectors.entries()) {
		silo.subscribe(totalSelector, () => {}, `subscriber-${index}`)
	}

	const setAllValuesTX = silo.transaction<(nextValue: number) => void>({
		key: `set-all-values`,
		...COMMIT_OPTION,
		do: ({ set }, nextValue) => {
			for (const valueAtom of valueAtoms) {
				set(valueAtom, nextValue)
			}
		},
	})
	const setAllValues = silo.runTransaction(setAllValuesTX)
	let nextValue = 0

	return {
		run: () => {
			setAllValues(++nextValue)
		},
	}
}

const CASES = [
	{ writes: 16, selectorCount: 1 },
	{ writes: 64, selectorCount: 0 },
	{ writes: 64, selectorCount: 1 },
	{ writes: 64, selectorCount: 8 },
	{ writes: 256, selectorCount: 1 },
] as const

describe(`transaction commit batching`, () => {
	for (const { writes, selectorCount } of CASES) {
		const harness = createBenchmarkHarness(writes, selectorCount)
		bench(
			`${writes} writes / ${selectorCount} downstream selectors`,
			() => {
				harness.run()
			},
			{
				time: 300,
				warmupTime: 100,
				iterations: 2,
				warmupIterations: 1,
			},
		)
	}
})
