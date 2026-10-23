// Solid 2-only experiments. Loaded by runtime.ts only in the RC environment.
import assert from "node:assert/strict"
import { test } from "node:test"

import { StoreProvider, useO } from "@atom.io/solid"
import { Silo } from "atom.io"
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
	let resolve
	const value = silo.atom({
		key: `value`,
		default: () =>
			new Promise((done) => {
				resolve = done
			}),
	})
	const seen = []
	const dispose = createRoot((rootDispose) => {
		const provider = StoreProvider({
			store: silo.store,
			get children() {
				untrack(() => {
					const snapshot = useO(value)
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
		await new Promise((done) => setImmediate(done))
		flush()
		assert.deepEqual(seen, [42])
	} finally {
		dispose()
	}
})

await test(`Solid 2 external source tracking follows dynamic atom dependencies and untrack`, () => {
	// Proof of concept: real integration needs an atom.io read-tracking scope.
	// Nothing patches getState globally or installs this bridge in the adapter.
	let collect
	let subscriptions = 0
	const trackedRead = (silo, token) => {
		collect?.(silo, token)
		return silo.getState(token)
	}
	enableExternalSource({
		factory: (compute, trigger) => {
			let stops = []
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
					const tokens = new Set()
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
	const a = silo.atom({ key: `a`, default: 1 })
	const b = silo.atom({ key: `b`, default: 10 })
	const ignored = silo.atom({ key: `ignored`, default: 100 })
	const seen = []
	let choose
	const dispose = createRoot((rootDispose) => {
		const [first, setFirst] = createSignal(true)
		choose = setFirst
		createEffect(
			() => {
				untrack(() => trackedRead(silo, ignored))
				return trackedRead(silo, first() ? a : b)
			},
			(value) => {
				seen.push(value)
			},
		)
		return rootDispose
	})
	try {
		flush()
		silo.setState(a, 2)
		flush()
		choose(false)
		flush()
		assert.deepEqual(seen, [1, 2, 10])
		silo.setState(a, 3)
		silo.setState(ignored, 200)
		flush()
		assert.deepEqual(seen, [1, 2, 10])
		silo.setState(b, 11)
		flush()
		assert.deepEqual(seen, [1, 2, 10, 11])
		assert.equal(subscriptions, 1)
	} finally {
		dispose()
	}
	assert.equal(subscriptions, 0)
})
