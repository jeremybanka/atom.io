import assert from "node:assert/strict"
import { test } from "node:test"

import {
	StoreProvider,
	useI,
	useJSON,
	useLoadable,
	useO,
	useTL,
} from "@atom.io/solid"
import { Silo } from "atom.io"
import { UList } from "atom.io/transceivers/u-list"
import * as Solid from "solid-js"

const settle = async () => {
	await new Promise<void>((resolve) => setImmediate(resolve))
}

function mount(silo: Silo, children: () => void): () => void {
	return Solid.createRoot((dispose) => {
		let entered = false
		const result: unknown = StoreProvider({
			store: silo.store,
			get children() {
				entered = true
				Solid.untrack(children)
				return undefined
			},
		})
		// Solid 2 defers resolving provider children until the renderer reads them.
		Solid.createRenderEffect(
			() => {
				let child = result
				while (typeof child === `function`) child = child()
			},
			() => {},
		)
		assert.equal(entered, true)
		return dispose
	})
}

function observe<T>(read: () => T, values: T[]): void {
	if (Reflect.has(Solid, `onSettled`)) {
		const effect = Solid.createEffect as unknown as (
			compute: () => T,
			apply: (value: T) => void,
		) => void
		effect(read, (value) => {
			values.push(value)
		})
	} else {
		const effect = Solid.createEffect as unknown as (compute: () => void) => void
		effect(() => {
			values.push(read())
		})
	}
}

await test(`bindings isolate provider stores, notify computations, and dispose subscriptions`, async () => {
	const silo = new Silo({
		name: `solid-consumer`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const other = new Silo({
		name: `other-consumer`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 7 })
	// The same key in a second store deliberately tests provider isolation.
	// eslint-disable-next-line atom.io/naming-convention
	const otherCountAtom = other.atom<number>({ key: `count`, default: 70 })
	let read!: () => number
	let write!: (next: number | ((old: number) => number)) => void
	const values: number[] = []
	const otherValues: number[] = []
	const dispose = mount(silo, () => {
		read = useO(countAtom)
		write = useI(countAtom)
		observe(read, values)
		assert.equal(read(), 7)
		// The subscription has not settled yet: don't lose this write.
		write(8)
		assert.equal(read(), 8)
	})
	const disposeOther = mount(other, () => {
		observe(useO(otherCountAtom), otherValues)
	})
	try {
		await settle()
		assert.equal(values.at(-1), 8)
		assert(otherValues.length > 0 && otherValues.every((value) => value === 70))
		const otherLength = otherValues.length
		write((old) => old + 1)
		assert.equal(read(), 9)
		await settle()
		assert.equal(values.at(-1), 9)
		assert.equal(otherValues.length, otherLength)
		assert.equal(silo.getState(countAtom), 9)
	} finally {
		dispose()
		disposeOther()
	}
	const length = values.length
	silo.setState(countAtom, 10)
	await settle()
	assert.equal(values.length, length)
	// A disposed computation alone cannot prove unsubscribe: inspect the store.
	const state = silo.store.atoms.get(countAtom.key)!
	assert.equal(
		[...state.subject.subscribers.keys()].some((key) =>
			key.startsWith(`use-o:`),
		),
		false,
	)
})

await test(`mutable snapshots and timeline controls remain reactive`, async () => {
	const silo = new Silo({
		name: `solid-mutable`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const listAtom = silo.mutableAtom<UList<number>>({
		key: `list`,
		class: UList,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const historyTimeline = silo.timeline({
		key: `history`,
		scope: [countAtom],
	})
	const json: string[] = []
	const sizes: number[] = []
	const positions: number[] = []
	let controls!: ReturnType<typeof useTL>
	const dispose = mount(silo, () => {
		const read = useO(listAtom)
		const readJSON = useJSON(listAtom)
		controls = useTL(historyTimeline)
		observe(() => read().size, sizes)
		observe(() => JSON.stringify(readJSON()), json)
		observe(() => controls().at, positions)
	})
	try {
		await settle()
		assert.equal(sizes.at(-1), 0)
		assert.equal(json.at(-1), `[]`)
		sizes.length = 0
		json.length = 0
		silo.setState(listAtom, (value) => value.add(1))
		silo.setState(countAtom, 1)
		await settle()
		assert.deepEqual(sizes, [1])
		assert.deepEqual(json, [`[1]`])
		assert.equal(positions.at(-1), 1)
		controls().undo()
		await settle()
		assert.equal(silo.getState(countAtom), 0)
		assert.equal(positions.at(-1), 0)
		controls().redo()
		await settle()
		assert.equal(silo.getState(countAtom), 1)
		assert.equal(positions.at(-1), 1)
	} finally {
		dispose()
	}
})

await test(`loadable promises retain the adapter's explicit loading contract`, async () => {
	const silo = new Silo({
		name: `solid-loadable`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	let resolve!: (value: number) => void
	const valueAtom = silo.atom<number | Promise<number>>({
		key: `value`,
		default: () =>
			new Promise<number>((done) => {
				resolve = done
			}),
	})
	const snapshots: string[] = []
	const dispose = mount(silo, () => {
		const read = useLoadable(valueAtom)
		observe(() => JSON.stringify(read()), snapshots)
	})
	try {
		await settle()
		assert.equal(snapshots.at(-1), JSON.stringify(`LOADING`))
		resolve(42)
		await settle()
		assert.equal(snapshots.at(-1), JSON.stringify({ loading: false, value: 42 }))
	} finally {
		dispose()
	}
})

await test(`function snapshots remain values and owned notifications stay reactive`, async () => {
	const silo = new Silo({
		name: `solid-functions`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	let calls = 0
	const initial = () => {
		calls++
		return 1
	}
	const replacement = () => {
		calls++
		return 2
	}
	const callbackAtom = silo.atom<() => number>({
		key: `callback`,
		default: () => initial,
	})
	let read!: () => () => number
	const seen: (() => number)[] = []
	const dispose = mount(silo, () => {
		read = useO(callbackAtom)
		observe(read, seen)
	})
	try {
		await settle()
		assert.equal(read(), initial)
		assert.equal(seen.at(-1), initial)
		Solid.createRoot((rootDispose) => {
			silo.setState(callbackAtom, () => replacement)
			rootDispose()
		})
		await settle()
		assert.equal(read(), replacement)
		assert.equal(seen.at(-1), replacement)
		assert.equal(calls, 0)
	} finally {
		dispose()
	}
})

if (`onSettled` in Solid) await import(`./solid2.mjs`)
