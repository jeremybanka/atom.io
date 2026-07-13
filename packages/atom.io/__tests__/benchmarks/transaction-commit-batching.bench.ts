import { Silo } from "atom.io"
import { bench, describe } from "vitest"

import { createNullLogger } from "../__util__/nullLogger.ts"

type CommitMode = `batched` | `default playback`

type BenchmarkHarness = {
	run: () => void
	verify: () => void
}

type TransactionCase = {
	label: string
	readsPerSelector: number
	selectorCount: number
	writes: number
}

const SAMPLE_OPTIONS = {
	iterations: 20,
	time: 1_000,
	throws: true,
	warmupIterations: 5,
	warmupTime: 250,
} as const

function invariant(condition: boolean, message: string): asserts condition {
	if (!condition) {
		throw new Error(`Benchmark correctness check failed: ${message}`)
	}
}

function createTransactionHarness(
	benchmarkCase: TransactionCase,
	commitMode: CommitMode,
): BenchmarkHarness {
	const { readsPerSelector, selectorCount, writes } = benchmarkCase
	const silo = new Silo({
		name: `transaction-commit-${commitMode}-${writes}-${selectorCount}-${readsPerSelector}`,
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
	const stride = selectorCount === 0 ? 0 : Math.ceil(writes / selectorCount)
	const selectorInputs = Array.from({ length: selectorCount }, (_, index) =>
		Array.from(
			{ length: readsPerSelector },
			(__, offset) => valueAtoms[(index * stride + offset) % writes],
		),
	)
	const totalSelectors = selectorInputs.map((inputs, index) =>
		silo.selector<number>({
			key: `total-${index}`,
			get: ({ get }) => {
				let total = 0
				for (const valueAtom of inputs) {
					total += get(valueAtom)
				}
				return total
			},
		}),
	)
	const latestSelectorValues = new Array<number>(selectorCount).fill(0)
	const selectorUpdateCounts = new Array<number>(selectorCount).fill(0)
	for (const [index, totalSelector] of totalSelectors.entries()) {
		silo.subscribe(
			totalSelector,
			({ newValue }) => {
				latestSelectorValues[index] = newValue
				selectorUpdateCounts[index] += 1
			},
			`subscriber-${index}`,
		)
	}

	const commitOption =
		commitMode === `batched` ? { commit: `batched` as const } : {}
	const setAllValuesTX = silo.transaction<(nextValue: number) => void>({
		key: `set-all-values`,
		...commitOption,
		do: ({ set }, nextValue) => {
			for (const valueAtom of valueAtoms) {
				set(valueAtom, nextValue)
			}
		},
	})
	const setAllValues = silo.runTransaction(setAllValuesTX)
	let nextValue = 0
	let outcomeCount = 0
	let latestOutcomeValue = 0
	silo.subscribe(
		setAllValuesTX,
		({ params }) => {
			outcomeCount += 1
			latestOutcomeValue = params[0]
		},
		`outcome`,
	)

	const run = () => {
		setAllValues(++nextValue)
	}
	const verify = () => {
		invariant(
			outcomeCount === nextValue,
			`${commitMode} published ${outcomeCount} outcomes after ${nextValue} commits`,
		)
		invariant(
			latestOutcomeValue === nextValue,
			`${commitMode} published outcome ${latestOutcomeValue}; expected ${nextValue}`,
		)
		for (const valueAtom of valueAtoms) {
			invariant(
				silo.getState(valueAtom) === nextValue,
				`${commitMode} left an atom short of commit ${nextValue}`,
			)
		}
		for (const [index, totalSelector] of totalSelectors.entries()) {
			const expected = readsPerSelector * nextValue
			invariant(
				silo.getState(totalSelector) === expected,
				`${commitMode} selector ${index} did not compute ${expected}`,
			)
			invariant(
				latestSelectorValues[index] === expected,
				`${commitMode} selector ${index} did not notify ${expected}`,
			)
		}
	}

	// Smoke-check both the final values and the defining notification behavior before
	// collecting timings. `teardown` below checks correctness again outside the timer.
	const countsBeforeSmokeCheck = [...selectorUpdateCounts]
	run()
	verify()
	for (const [index, updateCount] of selectorUpdateCounts.entries()) {
		const expectedIncrease = commitMode === `batched` ? 1 : readsPerSelector
		invariant(
			updateCount - countsBeforeSmokeCheck[index] === expectedIncrease,
			`${commitMode} selector ${index} notified ${
				updateCount - countsBeforeSmokeCheck[index]
			} times; expected ${expectedIncrease}`,
		)
	}

	return { run, verify }
}

function createSetStateHarness(withSelector: boolean): BenchmarkHarness {
	const silo = new Silo({
		name: `ordinary-set-state-${withSelector ? `selector` : `atom`}`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.store.logger = createNullLogger()

	const valueAtom = silo.atom<number>({ key: `value`, default: 0 })
	const doubledSelector = withSelector
		? silo.selector<number>({
				key: `doubled`,
				get: ({ get }) => get(valueAtom) * 2,
			})
		: null
	let latestSelectorValue = 0
	if (doubledSelector) {
		silo.subscribe(
			doubledSelector,
			({ newValue }) => {
				latestSelectorValue = newValue
			},
			`subscriber`,
		)
	}

	let nextValue = 0
	const run = () => {
		silo.setState(valueAtom, ++nextValue)
	}
	const verify = () => {
		invariant(
			silo.getState(valueAtom) === nextValue,
			`ordinary setState left the atom short of update ${nextValue}`,
		)
		if (doubledSelector) {
			const expected = nextValue * 2
			invariant(
				silo.getState(doubledSelector) === expected,
				`ordinary setState selector did not compute ${expected}`,
			)
			invariant(
				latestSelectorValue === expected,
				`ordinary setState selector did not notify ${expected}`,
			)
		}
	}

	run()
	verify()
	return { run, verify }
}

const TRANSACTION_CASES = [
	{
		label: `write-only`,
		writes: 64,
		selectorCount: 0,
		readsPerSelector: 0,
	},
	{
		label: `one wide aggregate`,
		writes: 64,
		selectorCount: 1,
		readsPerSelector: 64,
	},
	{
		label: `partitioned selectors`,
		writes: 64,
		selectorCount: 8,
		readsPerSelector: 8,
	},
	{
		label: `overlapping selectors`,
		writes: 64,
		selectorCount: 8,
		readsPerSelector: 16,
	},
	{
		label: `larger partitioned graph`,
		writes: 256,
		selectorCount: 16,
		readsPerSelector: 16,
	},
] as const satisfies readonly TransactionCase[]

describe(`transaction commit batching`, () => {
	for (const benchmarkCase of TRANSACTION_CASES) {
		describe(`${benchmarkCase.label}: ${benchmarkCase.writes} writes / ${benchmarkCase.selectorCount} selectors / ${benchmarkCase.readsPerSelector} reads each`, () => {
			for (const commitMode of [`default playback`, `batched`] as const) {
				const harness = createTransactionHarness(benchmarkCase, commitMode)
				bench(commitMode, harness.run, {
					...SAMPLE_OPTIONS,
					teardown: harness.verify,
				})
			}
		})
	}
})

describe(`ordinary setState control`, () => {
	for (const withSelector of [false, true]) {
		const harness = createSetStateHarness(withSelector)
		bench(withSelector ? `one write / one selector` : `one write`, harness.run, {
			...SAMPLE_OPTIONS,
			teardown: harness.verify,
		})
	}
})
