import { Silo } from "atom.io"
import { clearStore, copyStoreFields, Store } from "atom.io/internal"
import { takeSnapshot } from "atom.io/testing"

it(`copies every current Store field while preserving the target identity and extensions`, () => {
	const config = {
		name: `copy-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	} as const
	const source = new Store(config)
	const target = new Store(config)
	const sentinel = Symbol(`old-field`)
	for (const key of Reflect.ownKeys(source)) {
		Object.defineProperty(target, key, {
			value: sentinel,
			writable: true,
			configurable: true,
			enumerable: true,
		})
	}
	const extension = Symbol(`extension`)
	Object.defineProperty(target, extension, { value: sentinel })
	copyStoreFields(target, source)
	for (const key of Reflect.ownKeys(source)) {
		expect(Reflect.get(target, key), String(key)).toBe(Reflect.get(source, key))
	}
	expect(Reflect.get(target, extension)).toBe(sentinel)
	expect(target).not.toBe(source)
})

it(`clears a store in place so existing Silo methods remain usable`, () => {
	const silo = new Silo({
		name: `clear-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const store = silo.store
	const config = store.config
	const { atom, getState, setState } = silo
	atom<number>({ key: `old`, default: 1 })
	let disposed = 0
	store.miscResources.set(`resource`, {
		[Symbol.dispose]: () => {
			disposed++
		},
	})

	clearStore(store)

	expect(silo.store).toBe(store)
	expect(store.config).toBe(config)
	expect(store.atoms.size).toBe(0)
	expect(store.miscResources.size).toBe(0)
	expect(disposed).toBe(1)
	const freshAtom = atom<number>({ key: `fresh`, default: 2 })
	setState(freshAtom, 3)
	expect(getState(freshAtom)).toBe(3)
})

it(`restores snapshots in place for captured methods and the implicit store`, () => {
	const silo = new Silo({
		name: `restore-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const store = silo.store
	const { atom, getState, setState } = silo
	const retainedAtom = atom<number>({ key: `retained`, default: 1 })
	const previousImplicitStore = globalThis.ATOM_IO_IMPLICIT_STORE
	globalThis.ATOM_IO_IMPLICIT_STORE = store
	try {
		const snapshot = takeSnapshot(store)
		setState(retainedAtom, 2)
		atom<number>({ key: `temporary`, default: 3 })
		let disposed = 0
		store.miscResources.set(`resource`, {
			[Symbol.dispose]: () => {
				disposed++
			},
		})

		snapshot.restore()

		expect(silo.store).toBe(store)
		expect(globalThis.ATOM_IO_IMPLICIT_STORE).toBe(store)
		expect(snapshot.store).not.toBe(store)
		expect(getState(retainedAtom)).toBe(1)
		expect(store.atoms.has(`temporary`)).toBe(false)
		expect(store.miscResources.size).toBe(0)
		expect(disposed).toBe(1)
		setState(retainedAtom, 4)
		expect(getState(retainedAtom)).toBe(4)
		snapshot.restore()
		expect(getState(retainedAtom)).toBe(1)
		expect(disposed).toBe(1)
	} finally {
		globalThis.ATOM_IO_IMPLICIT_STORE = previousImplicitStore
	}
})
