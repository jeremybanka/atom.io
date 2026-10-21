import { Silo } from "atom.io"
import { mosaicDomain } from "atom.io/realtime"
import { z } from "zod"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

vi.mock(`solid-js`, async () => import(`solid-js/dist/solid.js`))

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
		AtomIOSolid.StoreProvider({
			children: (() => {
				const body = AtomIOSolid.useO(bodyAtom)
				Solid.createEffect(() => observed.push(body()))
			}) as unknown as never,
			store: silo.store,
		})
	})
	await Promise.resolve()
	silo.setState(bodyAtom, `edited`)
	await Promise.resolve()

	expect(observed).toEqual([`hello`, `edited`])
	dispose()
	instance[Symbol.dispose]()
})
