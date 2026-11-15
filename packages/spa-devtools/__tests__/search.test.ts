import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { scheduleGraph } from "../src/ecology-graph.ts"
import {
	captureStateSearch,
	indexStateSearch,
	matchStateSearch,
} from "../src/search.ts"

function finish<T>(iterator: Generator<void, T>): T {
	let step = iterator.next()
	while (!step.done) step = iterator.next()
	return step.value
}
const fixture = () =>
	new Silo({ name: `search`, lifespan: `ephemeral`, isProduction: true })
const index = (silo: Silo, view: `atoms` | `selectors` = `atoms`) =>
	finish(indexStateSearch(captureStateSearch(silo.store, view)!))

it(`search-cached-values: copies only cached scalars, distinguishing absent and cached undefined`, () => {
	const silo = fixture()
	for (const [key, value] of Object.entries({
		text: `hello`,
		number: 42,
		bool: false,
		nil: null,
		undef: undefined,
	})) {
		silo.atom<unknown>({ key, default: null })
		silo.store.valueMap.set(key, value)
	}
	silo.atom<unknown>({ key: `uncached`, default: () => 99 })
	const snapshot = index(silo)
	expect(snapshot.documents.find((doc) => doc.key === `undef`)!.value).toBe(
		`copied`,
	)
	expect(
		snapshot.documents
			.find((doc) => doc.key === `uncached`)!
			.fields.some((field) => field.kind === `value`),
	).toBe(false)
	for (const [query, key] of [
		[`hello`, `text`],
		[`42`, `number`],
		[`false`, `bool`],
		[`null`, `nil`],
		[`undefined`, `undef`],
	]) {
		expect(
			finish(matchStateSearch(snapshot, query)).hits.some(
				(hit) => hit.document.key === key,
			),
		).toBe(true)
	}
	expect(snapshot.uncachedValues).toBe(1)
})

it(`search-value-passive: does not evaluate, await, coerce or inspect hostile values, or alter cache, graph or families`, () => {
	const silo = fixture(),
		callback = vi.fn(() => {
			throw new Error(`hostile callback`)
		})
	const proxy = new Proxy(
		{},
		{ get: callback, getPrototypeOf: callback, ownKeys: callback },
	)
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	const object = {
		get secret() {
			return callback()
		},
		toString: callback,
		toJSON: callback,
		[Symbol.toPrimitive]: callback,
	}
	const values = [
		proxy,
		revoked.proxy,
		object,
		[],
		() => callback(),
		1n,
		Symbol(`secret`),
		Promise.resolve(2),
	]
	for (const [i, value] of values.entries()) {
		silo.atom<unknown>({ key: `object${i}`, default: null })
		silo.store.valueMap.set(`object${i}`, value)
	}
	silo.atom<unknown>({ key: `dormant`, default: callback })
	silo.selector<number>({ key: `selector`, get: callback })
	const familyAtoms = silo.atomFamily<number, string>({
		key: `family`,
		default: callback,
	})
	silo.store.families.get(familyAtoms.key)!.create(`existing`)
	silo.selectorFamily<number, string>({
		key: `emptySelectors`,
		get: () => callback,
	})
	const before = [...silo.store.valueMap],
		graph = silo.store.selectorGraph.toJSON(),
		members = [...silo.store.atoms.keys()]
	const atoms = index(silo),
		selectors = index(silo, `selectors`)
	for (const query of [`secret`, `object`, `undefined`, `family`, `selector`]) {
		finish(matchStateSearch(atoms, query))
		finish(matchStateSearch(selectors, query))
	}
	expect(atoms.skippedValues).toBe(values.length)
	expect(callback).not.toHaveBeenCalled()
	expect(silo.store.valueMap.size).toBe(before.length)
	for (const [key, value] of before)
		expect(silo.store.valueMap.get(key)).toBe(value)
	expect(silo.store.selectorGraph.toJSON()).toEqual(graph)
	expect([...silo.store.atoms.keys()]).toEqual(members)
	expect(selectors.documents.some((doc) => doc.kind === `family`)).toBe(true)
})

it(`search-value-ranking: deterministic full key, word, prefix, substring and one-edit matches before value-only hits`, () => {
	const silo = fixture()
	for (const [key, value] of [
		[`unrelated`, `cartQuantity`],
		[`cartQuantityBySku`, ``],
		[`cartQuantity`, ``],
		[`otherCartQuantity`, ``],
		[`orderTotal`, ``],
		[`fulfillment`, ``],
	]) {
		silo.atom<unknown>({ key, default: `` })
		silo.store.valueMap.set(key, value)
	}
	const snapshot = index(silo)
	expect(
		finish(matchStateSearch(snapshot, `cartQuantity`)).hits.map(
			(hit) => hit.document.key,
		),
	).toEqual([
		`cartQuantity`,
		`cartQuantityBySku`,
		`otherCartQuantity`,
		`unrelated`,
	])
	expect(
		finish(matchStateSearch(snapshot, `cart quan`)).hits.map(
			(hit) => hit.document.key,
		),
	).toContain(`cartQuantity`)
	for (const query of [
		`oder totl`,
		`orderTotla`,
		`orderTotall`,
		`orderTtal`,
		`fulfilment`,
	]) {
		const result = finish(matchStateSearch(snapshot, query))
		expect(result.hits.length, query).toBeGreaterThan(0)
		expect(result.hits[0].approximate, query).toBe(true)
	}
	expect(finish(matchStateSearch(snapshot, `zz`)).hits).toEqual([])
	const limited = finish(matchStateSearch(snapshot, `cartQuantitz`, 0))
	expect(limited.approximateLimited).toBe(true)
	expect(limited.comparisons).toBe(0)
	expect(
		finish(matchStateSearch(snapshot, `cartQuantity`, 1)).hits.some(
			(hit) => hit.document.key === `cartQuantity`,
		),
	).toBe(true)
})

it(`search-value-bounds: limits text before normalization, query words, result rows and typo comparisons; cancellation drops generations`, () => {
	const silo = fixture()
	for (let i = 0; i < 120; i++) {
		const key = `matching-${i}`
		silo.atom<unknown>({ key, default: `` })
		silo.store.valueMap.set(key, `x`.repeat(1_000_000) + `hiddenSuffix`)
	}
	silo.atom<unknown>({
		key: `a b c d e f g h i j k l m n o p q r`,
		default: null,
	})
	const capture = captureStateSearch(silo.store, `atoms`)!
	expect(capture.characters).toBeLessThan(120 * 2200 + 100)
	const snapshot = finish(indexStateSearch(capture))
	expect(snapshot.truncatedText).toBe(121)
	expect(finish(matchStateSearch(snapshot, `hiddenSuffix`)).hits).toEqual([])
	const all = finish(matchStateSearch(snapshot, `matching`))
	expect(all.matching).toBe(120)
	expect(all.hits).toHaveLength(100)
	for (const query of [`x`.repeat(257), `a b c d e f g h i`])
		expect(finish(matchStateSearch(snapshot, query)).validation).not.toBe(``)
	expect(finish(matchStateSearch(snapshot, ``)).hits).toEqual([])
	const run = vi.fn(),
		queued: (() => void)[] = []
	const cancel = scheduleGraph(
		indexStateSearch(capture),
		run,
		(task) => {
			queued.push(task)
			return () => {}
		},
		() => 0,
	)
	cancel()
	queued[0]()
	expect(run).not.toHaveBeenCalled()
	const partial = captureStateSearch(silo.store, `atoms`, { maxNodes: 1 })!
	expect(partial.partial).toBe(true)
	const fuzzy = finish(matchStateSearch(snapshot, `matcheng`, 7))
	expect(fuzzy.comparisons).toBe(7)
	expect(fuzzy.approximateLimited).toBe(true)
})

it(`literal highlights map compatibility characters, decomposed accents, astral symbols and overlapping words safely`, () => {
	const silo = fixture()
	for (const key of [`cafe\u0301`, `ｃａｒｔ`, `😀`, `<img>`, `banana`])
		silo.atom<unknown>({ key, default: 0 })
	const snapshot = index(silo)
	for (const [query, key, range] of [
		[`café`, `cafe\u0301`, [0, 5]],
		[`cart`, `ｃａｒｔ`, [0, 4]],
		[`😀`, `😀`, [0, 2]],
	] as const) {
		const hit = finish(matchStateSearch(snapshot, query)).hits.find(
			(entry) => entry.document.key === key,
		)!
		expect(hit.ranges).toEqual([range])
	}
	expect(finish(matchStateSearch(snapshot, `ban ana`)).hits[0].ranges).toEqual([
		[0, 6],
	])
	expect(finish(matchStateSearch(snapshot, `img`)).hits[0].document.key).toBe(
		`<img>`,
	)
})

it(`search-value-refresh: captured text is detached across edits and stores, and capture defers an applying transaction`, () => {
	const silo = fixture(),
		namedAtom = silo.atom<unknown>({ key: `named`, default: `before` })
	silo.getState(namedAtom)
	const first = index(silo)
	silo.setState(namedAtom, `after`)
	expect(finish(matchStateSearch(first, `before`)).hits).toHaveLength(1)
	expect(finish(matchStateSearch(first, `after`)).hits).toHaveLength(0)
	expect(finish(matchStateSearch(index(silo), `after`)).hits).toHaveLength(1)
	expect(index(fixture()).documents).toEqual([])
	const changeTransaction = silo.transaction({
		key: `change`,
		do: ({ set }) => {
			set(namedAtom, `committed`)
		},
	})
	const during: unknown[] = []
	const unsubscribe = silo.store.on.transactionApplying.subscribe(
		`test`,
		(applying) => {
			if (applying !== null) during.push(captureStateSearch(silo.store, `atoms`))
		},
	)
	silo.runTransaction(changeTransaction)()
	unsubscribe()
	expect(during).toEqual([null])
	expect(finish(matchStateSearch(index(silo), `committed`)).hits).toHaveLength(1)
})

it(`marks family counts as lower bounds when node inspection is truncated`, () => {
	const silo = fixture()
	const rowsAtoms = silo.atomFamily<number, string>({ key: `rows`, default: 0 })
	silo.store.families.get(rowsAtoms.key)!.create(`a`)
	const capture = captureStateSearch(silo.store, `atoms`, { maxNodes: 0 })!
	expect(capture.documents[0].detail).toContain(`0+ members`)
})

it(`retains the best 100 with stable order when better names arrive after the cap, while counting every match`, () => {
	const silo = fixture()
	silo.atom<string>({ key: `valueOnly`, default: `` })
	silo.store.valueMap.set(`valueOnly`, `cartQuantity`)
	for (let i = 0; i < 120; i++)
		silo.atom<number>({ key: `cartQuantityBySku${i}`, default: 0 })
	silo.atom<number>({ key: `cartQuantity`, default: 0 })
	const result = finish(matchStateSearch(index(silo), `cartQuantity`))
	expect(result.matching).toBe(122)
	expect(result.hits.map((hit) => hit.document.key)).toEqual([
		`cartQuantity`,
		...Array.from({ length: 99 }, (_, i) => `cartQuantityBySku${i}`),
	])
})

it(`projects ASCII spans without constructing a cold native segmenter, resetting shared marks between hits`, () => {
	const silo = fixture()
	for (const key of [`xxMATCHxxMATCH`, `MATCH`, `nothing`])
		silo.atom<number>({ key, default: 0 })
	const snapshot = index(silo)
	const segmenter = vi.spyOn(Intl, `Segmenter`)
	try {
		const result = finish(matchStateSearch(snapshot, `match`))
		expect(
			result.hits.find((hit) => hit.document.key === `xxMATCHxxMATCH`)!.ranges,
		).toEqual([
			[2, 7],
			[9, 14],
		])
		expect(
			result.hits.find((hit) => hit.document.key === `MATCH`)!.ranges,
		).toEqual([[0, 5]])
		expect(segmenter).not.toHaveBeenCalled()
	} finally {
		segmenter.mockRestore()
	}
})

it(`constructs one segmenter lazily for Unicode literal spans and shares it within a query`, () => {
	const silo = fixture()
	for (const key of [`café`, `café and café`])
		silo.atom<number>({ key, default: 0 })
	const snapshot = index(silo)
	const segmenter = vi.spyOn(Intl, `Segmenter`)
	try {
		const result = finish(matchStateSearch(snapshot, `café`))
		expect(result.hits.map((hit) => hit.ranges)).toEqual([
			[[0, 4]],
			[
				[0, 4],
				[9, 13],
			],
		])
		expect(segmenter).toHaveBeenCalledTimes(1)
	} finally {
		segmenter.mockRestore()
	}
})

it(`drops normalized words that cross the document bound after compatibility expansion`, () => {
	const silo = fixture(),
		key = `ﬃ`.repeat(1024)
	silo.atom<number>({ key, default: 0 })
	const document = index(silo).documents[0]
	expect(document.truncated).toBe(true)
	expect(document.fields[0].fold.length).toBe(2048)
	expect(document.fields[0].words).toEqual([])
})
