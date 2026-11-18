import { Silo } from "atom.io"

// Resolve the browser build through the package location; Solid 2 does not
// export the old solid-js/dist/* subpaths.
vi.mock(`solid-js`, async () => {
	const client = new URL(
		`./dist/solid.js`,
		import.meta.resolve(`solid-js/package.json`),
	).href
	return import(/* @vite-ignore */ client)
})

it(`Solid 2 mounts a provider, updates external reads, and releases subscriptions`, async () => {
	const Solid = await import(`solid-js`)
	const { StoreProvider, useI, useO } = await import(`@atom.io/solid`)
	const silo = new Silo({
		name: `solid-2`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	const observed: number[] = []
	let read!: () => number
	let write!: (value: number) => void
	const dispose = Solid.createRoot((rootDispose) => {
		const provider = StoreProvider({
			store: silo.store,
			get children() {
				Solid.untrack(() => {
					read = useO(countAtom)
					write = useI(countAtom)
					Solid.createEffect(
						() => {
							observed.push(read())
						},
						() => {},
					)
				})
				return undefined
			},
		})
		Solid.createRenderEffect(
			() => {
				let child: unknown = provider
				while (typeof child === `function`) child = child()
			},
			() => {},
		)
		return rootDispose
	})
	try {
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(observed.at(-1)).toBe(1)
		write(2)
		expect(read()).toBe(2)
		await new Promise<void>((resolve) => setImmediate(resolve))
		expect(observed.at(-1)).toBe(2)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(1)
	} finally {
		dispose()
	}
	expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(0)
})
