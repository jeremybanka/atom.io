import assert from "node:assert/strict"
import { cp } from "node:fs/promises"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import type * as SolidAdapter from "@atom.io/solid"
import type * as Core from "atom.io"
import * as Solid from "solid-js"

import { withRuntimeCopies } from "../../../../scripts/runtime-copies.ts"

type FixtureModules = { main: typeof Core; solid: typeof SolidAdapter }
type CounterUpdate = number | ((value: number) => number)
await withRuntimeCopies<FixtureModules>(
	new URL(`../../`, import.meta.url),
	[`solid`],
	[`solid-js`],
	async ({ load, isolatedDependencies }) => {
		const coreA = await load(`a`, `main`)
		const makeSilo = (name: string, initial: number) => {
			const silo = new coreA.Silo({
				name,
				lifespan: `ephemeral`,
				isProduction: true,
			})
			const counterAtom = silo.atom<number>({
				key: `counter`,
				default: initial,
			})
			return { silo, token: counterAtom }
		}
		const untouched = makeSilo(`untouched`, 2)
		const solidA = await load(`a`, `solid`)
		const solidB = await load(`b`, `solid`)
		assert.equal(solidA.StoreContext, solidB.StoreContext)
		const testSolidStore = async (
			runtime: typeof Solid,
			provider: typeof SolidAdapter,
			consumer: typeof SolidAdapter,
			initial: number,
		): Promise<void> => {
			const { silo, token } = makeSilo(`solid-${initial}`, initial)
			let read: (() => number) | undefined
			let write: ((next: CounterUpdate) => void) | undefined
			let observed: number | undefined
			const dispose = runtime.createRoot((rootDispose) => {
				const provided = provider.StoreProvider({
					store: silo.store,
					get children() {
						runtime.untrack(() => {
							assert.equal(runtime.useContext(consumer.StoreContext), silo.store)
							const value = consumer.useO(token)
							read = value
							write = consumer.useI(token)
							runtime.createEffect(value, (next) => {
								observed = next
							})
						})
						return undefined
					},
				})
				runtime.createRenderEffect(
					() => {
						let child: unknown = provided
						while (typeof child === `function`) child = child()
					},
					() => {},
				)
				return rootDispose
			})
			try {
				await new Promise<void>((resolve) => setImmediate(resolve))
				assert.ok(read)
				assert.ok(write)
				assert.equal(read(), initial)
				assert.equal(observed, initial)
				write((value) => value + 1)
				assert.equal(read(), initial + 1)
				await new Promise<void>((resolve) => setImmediate(resolve))
				assert.equal(observed, initial + 1)
				assert.equal(silo.getState(token), initial + 1)
				assert.equal(untouched.silo.getState(untouched.token), 2)
			} finally {
				dispose()
			}
		}
		await testSolidStore(Solid, solidA, solidB, 2000)
		// Solid 2 delegates its reactive runtime to a separate package. Copy it
		// too so the isolated adapter has a genuinely independent owner graph.
		const require = createRequire(import.meta.resolve(`solid-js`))
		await cp(
			dirname(require.resolve(`@solidjs/signals/package.json`)),
			join(isolatedDependencies, `@solidjs/signals`),
			{ recursive: true },
		)
		const isolatedSolid = (await import(
			pathToFileURL(join(isolatedDependencies, `solid-js/dist/solid.js`)).href
		)) as typeof Solid
		assert.notEqual(isolatedSolid.createContext, Solid.createContext)
		const solidC = await load(`isolated/c`, `solid`)
		const solidD = await load(`isolated/d`, `solid`)
		assert.equal(solidC.StoreContext, solidD.StoreContext)
		assert.notEqual(solidC.StoreContext, solidA.StoreContext)
		await testSolidStore(isolatedSolid, solidC, solidD, 3000)
	},
)
