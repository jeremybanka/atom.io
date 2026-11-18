import { mosaicDomain } from "@atom.io/realtime"
import { Silo } from "atom.io"
import { z } from "zod"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

vi.mock(`solid-js`, async () => {
	const client = new URL(
		`./dist/solid.js`,
		import.meta.resolve(`solid-js/package.json`),
	).href
	return import(/* @vite-ignore */ client)
})

test(`domain members remain ordinary Solid provider state`, async () => {
	const Solid = await import(`solid-js`)
	const AtomIOSolid = await import(`@atom.io/solid`)
	const silo = makeSilo(`solid-collaboration`)
	const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
	const domain = mosaicDomain({
		configSchema: z.object({}),
		key: `solid-document`,
		members: {
			body: { role: `durable`, schema: z.string(), token: bodyAtom },
		},
		version: 1,
	})
	const instance = await domain.activate({
		config: {},
		instance: `solid/one`,
		store: silo.store,
	})
	const observed: string[] = []
	let dispose = () => {}

	Solid.createRoot((disposeRoot) => {
		dispose = disposeRoot
		const provider = AtomIOSolid.StoreProvider({
			get children() {
				Solid.untrack(() => {
					const body = AtomIOSolid.useO(bodyAtom)
					Solid.createEffect(body, (value) => {
						observed.push(value)
					})
				})
				return undefined
			},
			store: silo.store,
		})
		Solid.createRenderEffect(
			() => {
				let child: unknown = provider
				while (typeof child === `function`) child = child()
			},
			() => {},
		)
	})
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(observed.length).toBeGreaterThan(0)
	expect(new Set(observed)).toEqual(new Set([`hello`]))
	const settled = observed.length
	silo.setState(bodyAtom, `edited`)
	await new Promise<void>((resolve) => setImmediate(resolve))

	expect(observed.slice(settled)).toEqual([`edited`])
	dispose()
	instance[Symbol.dispose]()
})
