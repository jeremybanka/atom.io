import {
	Silo,
	type TransactionOutcomeEvent,
	type TransactionToken,
} from "atom.io"
import { getFromStore } from "atom.io/internal"
import { attachIntrospectionStates } from "atom.io/introspection"
import { expect, it, vi } from "vitest"

import {
	captureHistorySearch,
	historyIdentity,
	historyParams,
	historyTargetExists,
	historyValue,
	type RecordedEvent,
} from "../src/history-search.ts"
import { indexStateSearch, matchStateSearch } from "../src/search.ts"

const fixture = () =>
	new Silo({ name: `history-search`, lifespan: `ephemeral`, isProduction: true })
function finish<T>(iterator: Generator<void, T>): T {
	let next = iterator.next()
	while (!next.done) next = iterator.next()
	return next.value
}
function setup() {
	const app = fixture()
	const cartCountAtom = app.atom<number>({ key: `cartCount`, default: 0 })
	const changeCartTransaction = app.transaction<
		(amount: number, opaque?: unknown) => unknown
	>({
		key: `changeCart`,
		do: ({ set }, amount, opaque) => {
			set(cartCountAtom, amount)
			return opaque ?? amount
		},
	})
	const cartHistoryTimeline = app.timeline({
		key: `cartHistory`,
		scope: [cartCountAtom],
	})
	const tools = attachIntrospectionStates(app.store)
	const record = () =>
		getFromStore(
			app.store,
			tools.transactionLogSelectors,
			changeCartTransaction.key,
		)
	return {
		app,
		cartCountAtom,
		changeCartTransaction,
		cartHistoryTimeline,
		tools,
		record,
	}
}

it(`captures only existing logs, never starts recording, and preserves cursor and dormant state`, () => {
	const f = setup(),
		dormant = vi.fn(() => 0)
	f.app.selector<number>({ key: `dormant`, get: dormant })
	f.app.runTransaction(f.changeCartTransaction)(1)
	const before = [...f.app.store.valueMap],
		atoms = [...f.app.store.atoms.keys()]
	const empty = captureHistorySearch(f.app.store, `transactions`)!
	expect(empty.documents).toHaveLength(1)
	expect(empty.notice).toContain(`1 logs without captured history`)
	expect([...f.app.store.valueMap]).toEqual(before)
	expect([...f.app.store.atoms.keys()]).toEqual(atoms)
	f.record()
	f.app.runTransaction(f.changeCartTransaction)(2)
	const cursor = f.app.store.timelines.get(f.cartHistoryTimeline.key)!.at
	for (const view of [`transactions`, `timelines`] as const) {
		const copy = captureHistorySearch(f.app.store, view)!
		const indexed = finish(indexStateSearch(copy))
		const result = finish(matchStateSearch(indexed, `cartCount`))
		expect(result.hits.some((hit) => hit.document.kind === `event`)).toBe(true)
		expect(result.hits[0].document.key).toBe(`cartCount`)
		for (const hit of result.hits)
			expect(historyTargetExists(f.app.store, view, hit.document.target!)).toBe(
				true,
			)
		expect(
			copy.documents.filter((doc) =>
				doc.fields.some(
					(field) =>
						field.kind === `metadata` && field.text === `transaction_outcome`,
				),
			),
		).toHaveLength(view === `transactions` ? 1 : 2)
	}
	expect(f.app.store.timelines.get(f.cartHistoryTimeline.key)!.at).toBe(cursor)
	expect(dormant).not.toHaveBeenCalled()
})

it(`skips hostile payloads without enumeration, getters, JSON hooks, coercion or promise observation`, () => {
	const f = setup(),
		trap = vi.fn(() => {
			throw new Error(`payload touched`)
		})
	const proxy = new Proxy({}, { get: trap, ownKeys: trap, getPrototypeOf: trap })
	const revoked = Proxy.revocable({}, {})
	revoked.revoke()
	const payloads = [
		proxy,
		revoked.proxy,
		{
			get x() {
				return trap()
			},
			toJSON: trap,
			toString: trap,
		},
		Promise.resolve(1),
		Symbol(`x`),
		1n,
		trap,
	]
	f.record()
	for (const value of payloads)
		f.app.runTransaction(f.changeCartTransaction)(1, value)
	const copy = captureHistorySearch(f.app.store, `transactions`)!
	expect(copy.skippedValues).toBe(payloads.length * 2)
	finish(matchStateSearch(finish(indexStateSearch(copy)), `payload`))
	expect(trap).not.toHaveBeenCalled()
	expect(historyParams([null, undefined, true, `text`, ...payloads])).toContain(
		`[opaque]`,
	)
	expect(historyValue(false)).toBe(`false`)
	expect(historyValue(null)).toBe(`null`)
	expect(historyValue(undefined)).toBe(`undefined`)
})

it(`bounds kTransaction keys, fields, parameters, owner counts, document counts and total copied text`, () => {
	const f = setup()
	f.record()
	f.app.runTransaction(f.changeCartTransaction)(1, `x`.repeat(5000))
	const logs = f.app.store.valueMap.get(
		`🔍 Transaction Update Log (Internal)("changeCart")`,
	) as TransactionOutcomeEvent<
		TransactionToken<(...args: unknown[]) => unknown>
	>[]
	logs[0].params = Array(20).fill(`a`)
	expect(captureHistorySearch(f.app.store, `transactions`)!.partial).toBe(true)
	expect(historyParams(logs[0].params)).toContain(`,…]`)
	const longOptions = { key: `k`.repeat(1100), do: () => {} }
	const kTransaction = f.app.transaction<() => void>(longOptions)
	expect(
		captureHistorySearch(f.app.store, `transactions`)!.documents.some(
			(doc) => doc.key.length === 1024,
		),
	).toBe(true)
	f.app.store.transactions.delete(kTransaction.key)
	const event = logs[0]
	logs.splice(
		0,
		logs.length,
		...Array.from({ length: 6000 }, (_, i) => ({
			...event,
			id: String(i),
			params: [],
			output: 1,
			subEvents: [],
		})),
	)
	const many = captureHistorySearch(f.app.store, `transactions`)!
	expect(many.documents).toHaveLength(5000)
	expect(many.partial).toBe(true)
	logs.splice(
		0,
		logs.length,
		...Array.from({ length: 1000 }, (_, i) => ({
			...event,
			id: String(i),
			params: [`x`.repeat(1024)],
			output: `y`.repeat(1024),
			subEvents: [],
		})),
	)
	const text = captureHistorySearch(f.app.store, `transactions`)!
	expect(text.characters).toBeLessThanOrEqual(503_000)
	expect(text.partial).toBe(true)
	logs.length = 0
	for (let i = 0; i < 205; i++)
		f.app.transaction<() => void>({ key: `empty${i}`, do: () => {} })
	expect(
		captureHistorySearch(f.app.store, `transactions`)!.snapshotWork.nodes,
	).toBe(200)
})

it(`bounds cyclic, shared and deeply nested event traversal without recursion`, () => {
	const f = setup()
	f.record()
	f.app.runTransaction(f.changeCartTransaction)(1)
	const logs = f.app.store.valueMap.get(
		`🔍 Transaction Update Log (Internal)("changeCart")`,
	) as RecordedEvent[]
	const first = logs[0] as TransactionOutcomeEvent<TransactionToken<() => void>>
	first.subEvents = [first]
	expect(captureHistorySearch(f.app.store, `transactions`)!.partial).toBe(true)
	first.subEvents = Array(10_001).fill(first)
	expect(
		captureHistorySearch(f.app.store, `transactions`)!.snapshotWork.relations,
	).toBe(10_000)
	let event = first
	first.subEvents = []
	for (let i = 0; i < 40; i++) {
		const next = { ...first, subEvents: [] }
		event.subEvents = [next]
		event = next
	}
	const deep = captureHistorySearch(f.app.store, `transactions`)!
	expect(deep.partial).toBe(true)
	expect(deep.documents.length).toBe(33)
})

it(`rejects replaced, removed and culled event paths while preserving identities across append`, () => {
	const f = setup()
	f.app.runTransaction(f.changeCartTransaction)(1)
	const copy = captureHistorySearch(f.app.store, `timelines`)!
	const target = copy.documents.find((doc) => doc.kind === `event`)!.target!
	f.app.runTransaction(f.changeCartTransaction)(2)
	expect(historyTargetExists(f.app.store, `timelines`, target)).toBe(true)
	f.app.store.timelines.get(f.cartHistoryTimeline.key)!.history.shift()
	expect(historyTargetExists(f.app.store, `timelines`, target)).toBe(false)
	f.app.store.timelines.get(f.cartHistoryTimeline.key)!.history = []
	expect(historyTargetExists(f.app.store, `timelines`, target)).toBe(false)
	f.app.store.timelines.delete(f.cartHistoryTimeline.key)
	expect(historyTargetExists(f.app.store, `timelines`, target)).toBe(false)
	const other = setup()
	expect(historyTargetExists(other.app.store, `timelines`, target)).toBe(false)
	for (let i = 0; i < 201; i++) f.app.timeline({ key: `extra${i}`, scope: [] })
	expect(historyTargetExists(f.app.store, `timelines`, target)).toBe(false)
	const id = historyIdentity(f.changeCartTransaction)
	expect(historyIdentity(f.changeCartTransaction)).toBe(id)
})

it(`captures cartHistoryTimeline families, internal exclusions, creation values and selector-update children`, () => {
	const f = setup()
	f.app.timeline({ key: `👁‍🗨 private`, scope: [] })
	f.app.timeline({ key: `🔍 private`, scope: [] })
	const historiesTimelines = f.app.timelineFamily<string>({
		key: `histories`,
		scope: [],
	})
	f.app.findTimeline(historiesTimelines, `member`)
	const source = f.app.store.timelines.get(f.cartHistoryTimeline.key)!
	source.history = [
		{
			type: `atom_creation`,
			token: f.cartCountAtom,
			value: `created`,
			timestamp: 1,
		},
		{
			type: `selector_update`,
			token: f.app.selector<number>({ key: `selected`, get: () => 0 }),
			timestamp: 2,
			subEvents: [
				{
					type: `atom_update`,
					token: f.cartCountAtom,
					update: { oldValue: 1, newValue: 2 },
					timestamp: 2,
				},
			],
		},
	]
	const capture = captureHistorySearch(f.app.store, `timelines`)!
	expect(
		capture.documents.some((doc) =>
			doc.fields.some((field) => field.text === `histories`),
		),
	).toBe(true)
	expect(capture.documents.some((doc) => doc.key.startsWith(`🔍`))).toBe(false)
	expect(
		capture.documents.some((doc) =>
			doc.fields.some((field) => field.text.includes(`created`)),
		),
	).toBe(true)
	const nested = capture.documents.find((doc) => doc.target?.path.length === 2)!
	expect(historyTargetExists(f.app.store, `timelines`, nested.target!)).toBe(
		true,
	)
	expect(
		historyTargetExists(f.app.store, `timelines`, capture.documents[0].target!),
	).toBe(true)
	const privateOptions = { key: `🔍 private`, do: () => {} }
	const privateTransaction = f.app.transaction<() => void>(privateOptions)
	expect(
		captureHistorySearch(f.app.store, `transactions`)!.documents.some(
			(doc) => doc.key === privateTransaction.key,
		),
	).toBe(false)
	const stop = f.app.store.on.transactionApplying.subscribe(
		`capture-guard`,
		(applying) => {
			if (applying !== null)
				expect(captureHistorySearch(f.app.store, `transactions`)).toBeNull()
		},
	)
	f.app.runTransaction(f.changeCartTransaction)(3)
	stop()
})

it(`searches historiesTimelines members and safe molecule metadata while leaving complex canonical keys opaque`, () => {
	const f = setup()
	const quantitiesAtoms = f.app.atomFamily<number, string>({
		key: `quantities`,
		default: 0,
	})
	const member = f.app.findState(quantitiesAtoms, `green-tea`)
	f.app.setState(quantitiesAtoms, `green-tea`, 1)
	f.app.store.timelines.get(f.cartHistoryTimeline.key)!.history = [
		{
			type: `transaction_outcome`,
			token: f.changeCartTransaction,
			id: `molecules`,
			params: [0],
			output: undefined,
			timestamp: 0,
			subEvents: [
				{
					type: `atom_update`,
					token: member,
					update: { oldValue: { x: 1 }, newValue: { x: 2 } },
					timestamp: 1,
				},
				{
					type: `molecule_creation`,
					key: `basket`,
					provenance: `order`,
					timestamp: 2,
				},
				{
					type: `molecule_creation`,
					key: [`opaque-key`],
					provenance: `order`,
					timestamp: 3,
				},
			],
		},
	]
	const copy = captureHistorySearch(f.app.store, `timelines`)!
	expect(
		copy.documents.some((doc) =>
			doc.fields.some((field) => field.text.includes(`green-tea`)),
		),
	).toBe(true)
	expect(copy.documents.some((doc) => doc.key === `basket`)).toBe(true)
	expect(copy.documents.some((doc) => doc.key === `molecule_creation`)).toBe(
		true,
	)
	expect(copy.skippedValues).toBe(2)
})
