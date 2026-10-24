// Solid 2 contracts, typechecked and run only against the RC peer environments.
import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreProvider, useO } from "@atom.io/solid"
import { type ReadableToken, Silo, type ViewOf } from "atom.io"
import {
	createEffect,
	createMemo,
	createRenderEffect,
	createRoot,
	createSignal,
	enableExternalSource,
	flush,
	untrack,
} from "solid-js"

await test(`Solid 2 async memo can unwrap atom.io promises`, async () => {
	const silo = new Silo({
		name: `solid-async-memo`,
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
	const seen: number[] = []
	const dispose = createRoot((rootDispose) => {
		const provider: unknown = StoreProvider({
			store: silo.store,
			get children() {
				untrack(() => {
					const snapshot = useO(valueAtom)
					const ready = createMemo(() => snapshot())
					createEffect(ready, (answer) => {
						seen.push(answer)
					})
				})
				return undefined
			},
		})
		createRenderEffect(
			() => {
				let child = provider
				while (typeof child === `function`) child = child()
			},
			() => {},
		)
		return rootDispose
	})
	try {
		flush()
		assert.deepEqual(seen, [])
		resolve(42)
		await new Promise<void>((done) => setImmediate(done))
		flush()
		assert.deepEqual(seen, [42])
	} finally {
		dispose()
	}
})

await test(`Solid 2 external source tracking follows dynamic atom dependencies and untrack`, () => {
	// Proof of concept: real integration needs an atom.io read-tracking scope.
	// Nothing patches getState globally or installs this bridge in the adapter.
	let collect: ((silo: Silo, token: ReadableToken<unknown>) => void) | undefined
	let subscriptions = 0
	const trackedRead = <T>(silo: Silo, token: ReadableToken<T>): ViewOf<T> => {
		collect?.(silo, token)
		return silo.getState(token)
	}
	enableExternalSource({
		factory: (compute, trigger) => {
			let stops: (() => void)[] = []
			const dispose = () => {
				for (const stop of stops) {
					stop()
					subscriptions--
				}
				stops = []
			}
			return {
				track(prev) {
					dispose()
					const previous = collect
					const tokens = new Set<ReadableToken<unknown>>()
					collect = (silo, token) => {
						if (tokens.has(token)) return
						tokens.add(token)
						subscriptions++
						stops.push(silo.subscribe(token, trigger))
					}
					try {
						return compute(prev)
					} finally {
						collect = previous
					}
				},
				dispose,
			}
		},
		untrack(fn) {
			const previous = collect
			collect = undefined
			try {
				return fn()
			} finally {
				collect = previous
			}
		},
	})
	const silo = new Silo({
		name: `solid-external`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const aAtom = silo.atom<number>({ key: `a`, default: 1 })
	const bAtom = silo.atom<number>({ key: `b`, default: 10 })
	const ignoredAtom = silo.atom<number>({ key: `ignored`, default: 100 })
	const seen: number[] = []
	let choose!: (value: boolean) => void
	const dispose = createRoot((rootDispose) => {
		const [first, setFirst] = createSignal(true)
		choose = setFirst
		createEffect(
			() => {
				untrack(() => trackedRead(silo, ignoredAtom))
				return trackedRead(silo, first() ? aAtom : bAtom)
			},
			(value) => {
				seen.push(value)
			},
		)
		return rootDispose
	})
	try {
		flush()
		silo.setState(aAtom, 2)
		flush()
		choose(false)
		flush()
		assert.deepEqual(seen, [1, 2, 10])
		silo.setState(aAtom, 3)
		silo.setState(ignoredAtom, 200)
		flush()
		assert.deepEqual(seen, [1, 2, 10])
		silo.setState(bAtom, 11)
		flush()
		assert.deepEqual(seen, [1, 2, 10, 11])
		assert.equal(subscriptions, 1)
	} finally {
		dispose()
	}
	assert.equal(subscriptions, 0)
})
