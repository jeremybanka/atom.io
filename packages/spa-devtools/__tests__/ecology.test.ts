import { Silo } from "atom.io"
import { attachIntrospectionStates } from "atom.io/introspection"
import { expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/AtomIODevtools.tsx"
import type { EcologySnapshot } from "../src/ecology.ts"
import { captureEcologySnapshot, traceEcologyRoots } from "../src/ecology.ts"

const fixture = () =>
	new Silo({ name: `ecology`, lifespan: `ephemeral`, isProduction: true })
const byKey = (snapshot: EcologySnapshot, key: string) =>
	snapshot.nodes.find((node) => node.key === key)!

it(`captures detached metadata without evaluating dormant defaults or selectors or attaching introspection`, () => {
	const silo = fixture()
	const lazy = vi.fn(() => 9),
		get = vi.fn(() => 10),
		asyncGet = vi.fn(() => Promise.resolve(11))
	silo.atom<number>({ key: `lazy`, default: lazy })
	silo.selector<number>({ key: `dormant`, get })
	silo.selector<Promise<number>>({ key: `async`, get: asyncGet })
	const broken = vi.fn(() => {
		throw new Error(`dormant failure`)
	})
	silo.selector<number>({ key: `broken`, get: broken })
	const before = [...silo.store.valueMap]
	const snapshot = captureEcologySnapshot(silo.store)
	expect(snapshot.nodes.map((node) => node.key)).toEqual([
		`lazy`,
		`dormant`,
		`async`,
		`broken`,
	])
	expect(byKey(snapshot, `lazy`).value).toEqual({ status: `unknown` })
	expect(byKey(snapshot, `dormant`).dependencies).toBe(`unknown`)
	expect(snapshot.edges).toEqual([])
	expect(snapshot.truncated).toEqual({
		nodes: false,
		families: false,
		relations: false,
	})
	for (const run of [lazy, get, asyncGet, broken])
		expect(run).not.toHaveBeenCalled()
	expect([...silo.store.valueMap]).toEqual(before)
	expect(silo.store.atoms.size).toBe(1)
	expect(traceEcologyRoots(snapshot, `dormant`)).toMatchObject({
		status: `incomplete`,
		rootKeys: [],
		unresolvedKeys: [`dormant`],
	})
	silo.setState(silo.store.atoms.get(`lazy`)!, 12)
	expect(byKey(snapshot, `lazy`).value).toEqual({ status: `unknown` })
	expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot)
})

it(`infers only coarse cached runtime types, including undefined, without traversing getters, promises or proxies`, () => {
	const silo = fixture()
	const getter = vi.fn(() => {
		throw new Error(`must not inspect`)
	})
	const object = Object.create(null) as object
	Object.defineProperty(object, `constructor`, { get: getter })
	const proxy = new Proxy({}, { get: getter, getPrototypeOf: getter })
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	const values = [
		undefined,
		true,
		1,
		2n,
		`hi`,
		Symbol(`s`),
		() => 0,
		{},
		null,
		[],
		object,
		proxy,
		revoked.proxy,
		new Promise(() => {}),
	]
	const types = [
		`undefined`,
		`boolean`,
		`number`,
		`bigint`,
		`string`,
		`symbol`,
		`function`,
		`object`,
		`null`,
		`array`,
		`object`,
		`object`,
		`unknown`,
		`object`,
	]
	for (let index = 0; index < values.length; index++) {
		const key = String(index)
		silo.atom<unknown>({ key, default: null })
		// Put exact cached objects in place; no store normalization or promise resolution is part of capture.
		silo.store.valueMap.set(key, values[index])
	}
	const snapshot = captureEcologySnapshot(silo.store)
	expect(snapshot.nodes.map((node) => node.value)).toEqual(
		types.map((type) => ({ status: `cached`, type })),
	)
	expect(getter).not.toHaveBeenCalled()
})

it(`records directional observations and distinguishes unevaluated selectors from evaluated constants and invalidated values`, () => {
	const silo = fixture()
	const leftAtom = silo.atom<number>({ key: `left`, default: 2 })
	const rightAtom = silo.atom<number>({ key: `right`, default: 3 })
	const choiceAtom = silo.atom<boolean>({ key: `choice`, default: true })
	const chooseSelector = silo.selector<number>({
		key: `choose`,
		get: ({ get }) => (get(choiceAtom) ? get(leftAtom) : get(rightAtom)),
	})
	const doubleSelector = silo.selector<number>({
		key: `double`,
		get: ({ get }) => get(chooseSelector) * 2,
	})
	const constantSelector = silo.selector<undefined>({
		key: `constant`,
		get: () => undefined,
	})
	silo.selector<number>({ key: `dormant`, get: () => 0 })
	expect(silo.getState(doubleSelector)).toBe(4)
	silo.getState(constantSelector)
	const snapshot = captureEcologySnapshot(silo.store)
	expect(snapshot.edges).toEqual([
		{ dependency: `choice`, selector: `choose` },
		{ dependency: `left`, selector: `choose` },
		{ dependency: `choose`, selector: `double` },
	])
	expect(byKey(snapshot, `constant`)).toMatchObject({
		value: { status: `cached`, type: `undefined` },
		dependencies: `observed`,
	})
	expect(traceEcologyRoots(snapshot, `constant`)).toMatchObject({
		status: `observed`,
		rootKeys: [],
		unresolvedKeys: [],
	})
	expect(traceEcologyRoots(snapshot, `double`)).toMatchObject({
		status: `observed`,
		rootKeys: [`choice`, `left`],
		cycleKeys: [],
	})
	silo.setState(choiceAtom, false)
	const invalidated = captureEcologySnapshot(silo.store)
	expect(byKey(invalidated, `choose`)).toMatchObject({
		value: { status: `unknown` },
		dependencies: `observed`,
	})
	expect(invalidated.edges).toEqual(snapshot.edges) // Last observation, not a claim about the next branch.
	expect(silo.getState(doubleSelector)).toBe(6)
	expect(
		traceEcologyRoots(captureEcologySnapshot(silo.store), `double`).rootKeys,
	).toEqual([`choice`, `right`])
	expect(snapshot.edges[1].dependency).toBe(`left`)
})

it(`preserves family identities, serialized subkeys, empty families and instantiated counts across disposal`, () => {
	const silo = fixture()
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 0,
	})
	const selectedSelectors = silo.selectorFamily<number, string>({
		key: `selected`,
		get:
			(key) =>
			({ get }) =>
				get(itemsAtoms, key),
	})
	silo.atomFamily<string, number>({ key: `empty`, default: `` })
	const a = silo.findState(itemsAtoms, `a`),
		b = silo.findState(itemsAtoms, `b`)
	silo.getState(a)
	silo.getState(b)
	const selected = silo.store.families.get(selectedSelectors.key)!.create(`a`)
	const untouched = captureEcologySnapshot(silo.store)
	expect(byKey(untouched, a.key).family).toEqual({ key: `items`, subKey: `"a"` })
	expect(
		untouched.families.map(({ key, memberCount, countComplete }) => ({
			key,
			memberCount,
			countComplete,
		})),
	).toEqual([
		{ key: `items`, memberCount: 2, countComplete: true },
		{ key: `selected`, memberCount: 1, countComplete: true },
		{ key: `empty`, memberCount: 0, countComplete: true },
	])
	expect(byKey(untouched, selected.key).dependencies).toBe(`unknown`)
	silo.getState(selected)
	expect(
		traceEcologyRoots(captureEcologySnapshot(silo.store), selected.key).rootKeys,
	).toEqual([a.key])
	silo.disposeState(itemsAtoms, `b`)
	silo.disposeState(selectedSelectors, `a`)
	const after = captureEcologySnapshot(silo.store)
	expect(after.nodes.some((node) => node.key === b.key)).toBe(false)
	expect(
		after.families.find((family) => family.key === `items`)!.memberCount,
	).toBe(1)
	expect(
		after.families.find((family) => family.key === `selected`)!.memberCount,
	).toBe(0)
	expect(untouched.families[0].memberKeys).toEqual([a.key, b.key])
})

it(`terminates on observed cycles, self edges, shared roots and missing or excluded endpoints`, () => {
	const silo = fixture()
	silo.atom<number>({ key: `root`, default: 1 })
	silo.atom<number>({ key: `🔍 hidden`, default: 0 })
	for (const key of [`a`, `b`, `c`, `self`])
		silo.selector<number>({ key, get: () => 1 })
	const link = (dependency: string, selector: string) =>
		silo.store.selectorGraph.set(
			{ upstreamSelectorKey: dependency, downstreamSelectorKey: selector },
			{ source: dependency },
		)
	link(`b`, `a`)
	link(`c`, `b`)
	link(`a`, `c`)
	link(`root`, `a`)
	link(`root`, `c`)
	link(`missing`, `b`)
	link(`🔍 hidden`, `b`)
	link(`self`, `self`)
	silo.selector<number>({ key: `orphan`, get: () => 0 })
	// A neighbor without retained content must not turn an unknown selector into a known constant.
	silo.store.selectorGraph.relations.set(`orphan`, new Set([`no-content`]))
	const snapshot = captureEcologySnapshot(silo.store)
	expect(snapshot.nodes.some((node) => node.key === `🔍 hidden`)).toBe(false)
	expect(traceEcologyRoots(snapshot, `a`)).toMatchObject({
		rootKeys: [`root`],
		cycleKeys: [`a`],
		unresolvedKeys: [`missing`, `🔍 hidden`],
		status: `incomplete`,
	})
	expect(traceEcologyRoots(snapshot, `self`)).toMatchObject({
		rootKeys: [],
		cycleKeys: [`self`],
		status: `observed`,
	})
	expect(traceEcologyRoots(snapshot, `absent`)).toMatchObject({
		unresolvedKeys: [`absent`],
		status: `incomplete`,
	})
	expect(traceEcologyRoots(snapshot, `root`)).toMatchObject({
		rootKeys: [`root`],
		status: `observed`,
	})
	expect(byKey(snapshot, `orphan`).dependencies).toBe(`unknown`)
})

it(`captures partial async and failed evaluations without awaiting or retrying them`, async () => {
	const silo = fixture()
	const beforeAtom = silo.atom<number>({ key: `before`, default: 1 })
	const afterAtom = silo.atom<number>({ key: `after`, default: 2 })
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const get = vi.fn(async ({ get: read }: { get: typeof silo.getState }) => {
		const before = read(beforeAtom)
		await gate
		return before + read(afterAtom)
	})
	const asyncSelector = silo.selector<Promise<number>>({ key: `async`, get })
	const failed = vi.fn(({ get: read }: { get: typeof silo.getState }) => {
		read(beforeAtom)
		throw new Error(`failed`)
	})
	const failedSelector = silo.selector<number>({ key: `failed`, get: failed })
	const pending = silo.getState(asyncSelector)
	expect(() => silo.getState(failedSelector)).toThrow(`failed`)
	const snapshot = captureEcologySnapshot(silo.store)
	expect(byKey(snapshot, `async`).value).toEqual({
		status: `cached`,
		type: `object`,
	})
	expect(byKey(snapshot, `failed`)).toMatchObject({
		value: { status: `unknown` },
		dependencies: `observed`,
	})
	expect(snapshot.edges).toEqual([
		{ dependency: `before`, selector: `async` },
		{ dependency: `before`, selector: `failed` },
	])
	expect(get).toHaveBeenCalledTimes(1)
	expect(failed).toHaveBeenCalledTimes(1)
	release()
	await pending
	for (let tick = 0; tick < 5; tick++) await Promise.resolve()
	const resolved = captureEcologySnapshot(silo.store)
	expect(byKey(resolved, `async`).value).toEqual({
		status: `cached`,
		type: `number`,
	})
	expect(resolved.edges).toContainEqual({
		dependency: `after`,
		selector: `async`,
	})
	expect(snapshot.edges).toHaveLength(2)
	expect(failed).toHaveBeenCalledTimes(1)
})

it(`does not mutate transactions, editable state, logging or subscriptions and keeps stores isolated`, () => {
	const silo = fixture(),
		other = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const otherAtom = other.atom<string>({ key: `other`, default: `other` })
	const doubleSelector = silo.selector<number>({
		key: `double`,
		get: ({ get }) => get(countAtom) * 2,
		set: ({ set }, value) => {
			set(countAtom, value / 2)
		},
	})
	const calls = vi.fn()
	silo.subscribe(countAtom, calls)
	silo.getState(doubleSelector)
	const states = attachIntrospectionStates(silo.store)
	const incrementTransaction = silo.transaction<() => void>({
		key: `increment`,
		do: ({ get, set }) => {
			set(countAtom, get(countAtom) + 1)
			const rootValue = silo.store.valueMap.get(`count`)
			expect(byKey(captureEcologySnapshot(silo.store), `count`).value).toEqual({
				status: `cached`,
				type: `number`,
			})
			expect(silo.store.valueMap.get(`count`)).toBe(rootValue)
		},
	})
	silo.getState(states.transactionLogSelectors, `increment`)
	const graph = silo.store.selectorGraph.toJSON()
	const cache = [...silo.store.valueMap]
	for (let index = 0; index < 10; index++) captureEcologySnapshot(silo.store)
	expect(calls).not.toHaveBeenCalled()
	expect(silo.store.selectorGraph.toJSON()).toEqual(graph)
	expect([...silo.store.valueMap]).toEqual(cache)
	silo.runTransaction(incrementTransaction)()
	silo.setState(doubleSelector, 10)
	expect(silo.getState(countAtom)).toBe(5)
	expect(silo.getState(doubleSelector)).toBe(10)
	expect(
		silo.getState(states.transactionLogSelectors, `increment`),
	).toHaveLength(1)
	expect(calls).toHaveBeenCalledTimes(2)
	expect(other.getState(otherAtom)).toBe(`other`)
	expect(captureEcologySnapshot(other.store).nodes).toHaveLength(1)
})

it(`bounds actual inspections including excluded records, high fanout, family counts and zero budgets`, () => {
	const silo = fixture()
	silo.atom<number>({ key: `🔍 reserved`, default: 0 })
	const membersAtoms = silo.atomFamily<number, number>({
		key: `members`,
		default: 0,
	})
	silo.atomFamily<number, number>({ key: `🔍 internal family`, default: 0 })
	silo.selector<number>({ key: `wide`, get: () => 0 })
	for (let index = 0; index < 2_000; index++) {
		const token = silo.findState(membersAtoms, index)
		silo.getState(token)
		silo.store.selectorGraph.set(
			{ upstreamSelectorKey: token.key, downstreamSelectorKey: `wide` },
			{ source: token.key },
		)
	}
	const first = captureEcologySnapshot(silo.store, {
		maxNodes: 3,
		maxFamilies: 1,
		maxRelations: 0,
	})
	expect(first.work).toEqual({ nodes: 5, families: 1, relations: 0 })
	expect(first.nodes).toHaveLength(3)
	expect(first.families[0]).toMatchObject({
		memberCount: 3,
		countComplete: false,
	})
	expect(first.truncated).toEqual({
		nodes: true,
		families: true,
		relations: false,
	})
	const graph = silo.store.selectorGraph
	const content = vi.spyOn(graph, `getContent`)
	const related = graph.getRelatedKeys(`wide`)!
	const iterator = related.values.bind(related)
	let reads = 0
	vi.spyOn(related, `values`).mockImplementation(function* (): Generator<
		string,
		undefined,
		unknown
	> {
		for (const value of iterator()) {
			reads++
			yield value
		}
		return undefined
	})
	const limited = captureEcologySnapshot(silo.store, {
		maxNodes: 10_000,
		maxFamilies: 10_000,
		maxRelations: 7,
	})
	expect(reads).toBe(7)
	expect(content).toHaveBeenCalledTimes(7)
	expect(limited.edges).toHaveLength(7)
	expect(limited.work.relations).toBe(7)
	expect(limited.truncated.relations).toBe(true)
	expect(byKey(limited, `wide`).dependenciesTruncated).toBe(true)
	expect(traceEcologyRoots(limited, `wide`).status).toBe(`incomplete`)
	const zero = captureEcologySnapshot(silo.store, {
		maxNodes: 0,
		maxFamilies: 0,
		maxRelations: 0,
	})
	expect(zero.work).toEqual({ nodes: 0, families: 0, relations: 0 })
	expect(zero.nodes).toEqual([])
	expect(traceEcologyRoots(limited, `wide`, { maxWork: 0 })).toMatchObject({
		status: `truncated`,
		work: 0,
	})
	expect(
		traceEcologyRoots(limited, `wide`, { maxWork: limited.nodes.length + 2 })
			.status,
	).toBe(`truncated`)
	expect(
		traceEcologyRoots(limited, `wide`, {
			maxWork: limited.nodes.length + limited.edges.length + 1,
		}).status,
	).toBe(`truncated`)
	vi.restoreAllMocks()
})

it(`traces a deep graph iteratively, deduplicates diamonds and enforces trace work independently`, () => {
	const silo = fixture()
	silo.atom<number>({ key: `root`, default: 1 })
	for (let index = 0; index < 3_000; index++) {
		const key = `s${index}`,
			dependency = index === 0 ? `root` : `s${index - 1}`
		silo.selector<number>({ key, get: () => 0 })
		silo.store.selectorGraph.set(
			{ upstreamSelectorKey: dependency, downstreamSelectorKey: key },
			{ source: dependency },
		)
	}
	const snapshot = captureEcologySnapshot(silo.store, {
		maxNodes: 10_000,
		maxRelations: 50_000,
	})
	const trace = traceEcologyRoots(snapshot, `s2999`)
	expect(trace.rootKeys).toEqual([`root`])
	expect(trace.visitedKeys).toHaveLength(3_001)
	expect(trace.status).toBe(`observed`)
	expect(trace.work).toBeLessThan(20_000)
	expect(traceEcologyRoots(snapshot, `s2999`, { maxWork: 7_000 })).toMatchObject(
		{ status: `truncated`, work: 7_000 },
	)
})

it(`rejects invalid limits instead of silently starting unbounded work`, () => {
	const silo = fixture()
	for (const value of [-1, 0.5, NaN, Infinity, 1e9]) {
		for (const key of [`maxNodes`, `maxFamilies`, `maxRelations`] as const)
			expect(() => captureEcologySnapshot(silo.store, { [key]: value })).toThrow(
				RangeError,
			)
		expect(() =>
			traceEcologyRoots(captureEcologySnapshot(silo.store), `x`, {
				maxWork: value,
			}),
		).toThrow(RangeError)
	}
})

it(`captures the named10,000 application instances and30,000 observed edges completely with mounted debugger records`, async () => {
	const silo = fixture()
	let reads = 0
	for (let family = 0; family < 10; family++) {
		const options = {
			key: `batch${family}`,
			default: () => {
				reads++
				return 0
			},
		}
		const batchAtoms = silo.atomFamily<number, number>(options)
		for (let member = 0; member < 500; member++)
			silo.store.families.get(batchAtoms.key)!.create(member)
	}
	const atoms = [...silo.store.atoms.keys()],
		expectedEdges = new Set<string>()
	for (let index = 0; index < 5_000; index++) {
		const key = `derived${index}`
		silo.selector<number>({
			key,
			get: () => {
				reads++
				return 0
			},
		})
		for (let dependency = 0; dependency < 6; dependency++) {
			const source = atoms[(index + dependency * 731) % atoms.length]
			silo.store.selectorGraph.set(
				{ upstreamSelectorKey: source, downstreamSelectorKey: key },
				{ source },
			)
			expectedEdges.add(JSON.stringify([source, key]))
		}
	}
	const graphBefore = silo.store.selectorGraph.toJSON()
	const appDefinitions = [
		...silo.store.atoms.keys(),
		...silo.store.readonlySelectors.keys(),
	]
	const appFamilies = [...silo.store.families.keys()]
	const savedView = localStorage.getItem(`🔍 Devtools View`)
	localStorage.setItem(`🔍 Devtools View`, JSON.stringify(`timelines`))
	const panel = mountAtomIODevtools(document.createElement(`section`), {
		store: silo.store,
	})
	try {
		for (let tick = 0; tick < 8; tick++) await Promise.resolve()
		const rawRecords =
			silo.store.atoms.size +
			silo.store.readonlySelectors.size +
			silo.store.writableSelectors.size
		expect(rawRecords).toBeGreaterThan(10_000)
		const result = captureEcologySnapshot(silo.store, {
			maxNodes: 10_000,
			maxFamilies: 10_000,
			maxRelations: 50_000,
		})
		expect(result.nodes).toHaveLength(10_000)
		expect(new Set(result.nodes.map((node) => node.key))).toEqual(
			new Set(appDefinitions),
		)
		expect(result.nodes.filter((node) => node.kind === `atom`)).toHaveLength(
			5_000,
		)
		expect(result.nodes.filter((node) => node.kind === `selector`)).toHaveLength(
			5_000,
		)
		expect(result.edges).toHaveLength(30_000)
		expect(
			new Set(
				result.edges.map(({ dependency, selector }) =>
					JSON.stringify([dependency, selector]),
				),
			),
		).toEqual(expectedEdges)
		expect(result.families).toHaveLength(10)
		expect(new Set(result.families.map((family) => family.key))).toEqual(
			new Set(appFamilies),
		)
		for (const family of result.families)
			expect(family).toMatchObject({ memberCount: 500, countComplete: true })
		expect(
			result.families.reduce((sum, family) => sum + family.memberKeys.length, 0),
		).toBe(5_000)
		expect(result.truncated).toEqual({
			nodes: false,
			families: false,
			relations: false,
		})
		expect(result.work.nodes).toBe(rawRecords)
		expect(result.work.nodes).toBeLessThanOrEqual(11_000)
		expect(result.work.relations).toBe(30_000)
		expect(
			result.nodes.every(
				(node) => node.value.status === `unknown` && !node.dependenciesTruncated,
			),
		).toBe(true)
		expect(
			result.nodes
				.filter((node) => node.kind === `selector`)
				.every((node) => node.dependencies === `observed`),
		).toBe(true)
		expect(reads).toBe(0)
		expect(
			[...silo.store.valueMap.keys()].filter((key) => !key.startsWith(`🔍 `)),
		).toEqual([])
		expect(
			[
				...silo.store.atoms.keys(),
				...silo.store.readonlySelectors.keys(),
			].filter((key) => !key.startsWith(`🔍 `)),
		).toEqual(appDefinitions)
		expect(silo.store.selectorGraph.toJSON()).toEqual(graphBefore)
		expect(
			[...silo.store.families.keys()].filter((key) => !key.startsWith(`🔍 `)),
		).toEqual(appFamilies)
	} finally {
		panel.dispose()
		if (savedView === null) localStorage.removeItem(`🔍 Devtools View`)
		else localStorage.setItem(`🔍 Devtools View`, savedView)
	}
})

it(`does not charge filtered prefixes or tails to application allowance and detects a final excess application record`, () => {
	const silo = fixture(),
		lazy = vi.fn(() => 0)
	silo.atom<number>({ key: `🔍 prefix`, default: lazy })
	silo.atom<number>({ key: `first`, default: lazy })
	silo.atom<number>({ key: `🔍 tail`, default: lazy })
	silo.selector<number>({ key: `🔍 selector`, get: lazy })
	const complete = captureEcologySnapshot(silo.store, { maxNodes: 1 })
	expect(complete.nodes.map((node) => node.key)).toEqual([`first`])
	expect(complete.work.nodes).toBe(4)
	expect(complete.truncated.nodes).toBe(false)
	silo.selector<number>({ key: `last`, get: lazy })
	const omitted = captureEcologySnapshot(silo.store, { maxNodes: 1 })
	expect(omitted.nodes).toHaveLength(1)
	expect(omitted.work.nodes).toBe(5) // The omitted last record is actually inspected, not silently lost.
	expect(omitted.truncated.nodes).toBe(true)
	expect(lazy).not.toHaveBeenCalled()
})

it(`bounds actual node inspections even if excluded records hide the application nodes`, () => {
	const silo = fixture(),
		lazy = vi.fn(() => 0)
	for (let index = 0; index < 1_100; index++)
		silo.atom<number>({ key: `🔍 excluded${index}`, default: lazy })
	silo.atom<number>({ key: `later`, default: lazy })
	const iterator = silo.store.atoms.values.bind(silo.store.atoms)
	let inspections = 0
	const spy = vi
		.spyOn(silo.store.atoms, `values`)
		.mockImplementation(function* (): Generator<
			NonNullable<ReturnType<typeof silo.store.atoms.get>>,
			undefined,
			unknown
		> {
			for (const state of iterator()) {
				inspections++
				yield state
			}
			return undefined
		})
	const result = captureEcologySnapshot(silo.store, { maxNodes: 1 })
	expect(result.nodes).toEqual([])
	expect(result.work.nodes).toBe(1_001)
	expect(inspections).toBe(1_001)
	expect(result.truncated.nodes).toBe(true)
	const zero = captureEcologySnapshot(silo.store, { maxNodes: 0 })
	expect(zero.work.nodes).toBe(0)
	expect(inspections).toBe(1_001)
	expect(lazy).not.toHaveBeenCalled()
	spy.mockRestore()
})
