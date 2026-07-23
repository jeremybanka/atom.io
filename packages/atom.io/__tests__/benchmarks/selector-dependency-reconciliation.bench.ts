import type { ReadableToken, RegularAtomToken } from "atom.io"
import { Silo } from "atom.io"
import * as v from "vitest"

const OPTIONS = {
	time: 400,
	warmupTime: 100,
} as const

const consumeUpdate = () => {}

function makeSilo(name: string): Silo {
	const silo = new Silo({
		name: `benchmark/selector-dependency-reconciliation/${name}`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	silo.store.loggers[0].logLevel = null
	return silo
}

function buildChain(
	silo: Silo,
	prefix: string,
	depth: number,
): { root: RegularAtomToken<number>; terminal: ReadableToken<number> } {
	const rootAtom = silo.atom<number>({
		key: `root`,
		default: 0,
	})
	let terminal: ReadableToken<number> = rootAtom
	for (let level = 0; level < depth; ++level) {
		const dependency: ReadableToken<number> = terminal
		terminal = silo.selector<number>({
			key: `${prefix}/selector/${level}`,
			get: ({ get }): number => get(dependency) + 1,
		})
	}
	return { root: rootAtom, terminal }
}

function prepareChain(depth: number): () => void {
	const prefix = `chain/${depth}`
	const silo = makeSilo(prefix)
	const { root, terminal } = buildChain(silo, prefix, depth)
	silo.subscribe(terminal, consumeUpdate, `${prefix}/subscriber`)
	let next = 0
	return () => {
		silo.setState(root, (next ^= 1))
	}
}

function prepareFanout(width: number): () => void {
	const prefix = `fanout/${width}`
	const silo = makeSilo(prefix)
	const rootAtom = silo.atom<number>({
		key: `root`,
		default: 0,
	})
	const leafSelectors = Array.from({ length: width }, (_, index) =>
		silo.selector<number>({
			key: `${prefix}/leaf/${index}`,
			get: ({ get }) => get(rootAtom) + index,
		}),
	)
	const totalSelector = silo.selector<number>({
		key: `total`,
		get: ({ get }) => {
			let sum = 0
			for (const leafSelector of leafSelectors) sum += get(leafSelector)
			return sum
		},
	})
	silo.subscribe(totalSelector, consumeUpdate, `${prefix}/subscriber`)
	let next = 0
	return () => {
		silo.setState(rootAtom, (next ^= 1))
	}
}

function prepareDynamicBranches(branchWidth: number): () => void {
	const prefix = `dynamic/${branchWidth}`
	const silo = makeSilo(prefix)
	const chooseRightAtom = silo.atom<boolean>({
		key: `chooseRight`,
		default: false,
	})
	const makeBranch = (name: string) =>
		Array.from({ length: branchWidth }, (_, index) =>
			silo.atom<number>({
				key: `${prefix}/${name}/${index}`,
				default: index,
			}),
		)
	const left = makeBranch(`left`)
	const right = makeBranch(`right`)
	const selectedTotalSelector = silo.selector<number>({
		key: `selectedTotal`,
		get: ({ get }) => {
			const selected = get(chooseRightAtom) ? right : left
			let sum = 0
			for (const state of selected) sum += get(state)
			return sum
		},
	})
	silo.subscribe(selectedTotalSelector, consumeUpdate, `${prefix}/subscriber`)
	let next = false
	return () => {
		next = !next
		silo.setState(chooseRightAtom, next)
	}
}

function prepareSubscribers(subscriberCount: number): () => void {
	const depth = 32
	const prefix = `subscribers/${subscriberCount}`
	const silo = makeSilo(prefix)
	const { root, terminal } = buildChain(silo, prefix, depth)
	for (let index = 0; index < subscriberCount; ++index) {
		silo.subscribe(terminal, consumeUpdate, `${prefix}/subscriber/${index}`)
	}
	let next = 0
	return () => {
		silo.setState(root, (next ^= 1))
	}
}

v.bench(`chain depth 16`, prepareChain(16), OPTIONS)
v.bench(`chain depth 64`, prepareChain(64), OPTIONS)
v.bench(`fanout width 8`, prepareFanout(8), OPTIONS)
v.bench(`fanout width 64`, prepareFanout(64), OPTIONS)
v.bench(`dynamic branches width 8`, prepareDynamicBranches(8), OPTIONS)
v.bench(`dynamic branches width 64`, prepareDynamicBranches(64), OPTIONS)
v.bench(`32-deep chain with 1 subscriber`, prepareSubscribers(1), OPTIONS)
v.bench(`32-deep chain with 32 subscribers`, prepareSubscribers(32), OPTIONS)
