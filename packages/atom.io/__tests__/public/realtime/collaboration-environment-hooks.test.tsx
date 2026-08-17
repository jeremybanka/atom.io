import { act, fireEvent, render } from "@testing-library/react"
import { Silo } from "atom.io"
import { StoreProvider, useI, useO } from "atom.io/react"
import { collaborationEnvironment } from "atom.io/realtime"
import { z } from "zod"

vi.mock(`solid-js`, async () => import(`solid-js/dist/solid.js`))

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

test(`environment members remain ordinary React provider state`, async () => {
	const silo = makeSilo(`react-collaboration`)
	const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
	const environment = collaborationEnvironment({
		configSchema: z.object({}),
		key: `react-document`,
		members: {
			body: { role: `durable`, schema: z.string(), token: bodyAtom },
		},
		version: 1,
	})
	const scope = await environment.activate({
		config: {},
		instance: `react/one`,
		store: silo.store,
	})
	const Body = () => {
		const body = useO(bodyAtom)
		const setBody = useI(bodyAtom)
		return (
			<button
				type="button"
				onClick={() => {
					setBody(`edited`)
				}}
			>
				{body}
			</button>
		)
	}
	const view = render(
		<StoreProvider store={silo.store}>
			<Body />
		</StoreProvider>,
	)

	expect(view.getByRole(`button`).textContent).toBe(`hello`)
	await act(async () => {
		fireEvent.click(view.getByRole(`button`))
		await Promise.resolve()
	})
	expect(view.getByRole(`button`).textContent).toBe(`edited`)
	scope[Symbol.dispose]()
})

test(`environment members remain ordinary Solid provider state`, async () => {
	const Solid = await import(`solid-js`)
	const AtomIOSolid = await import(`atom.io/solid`)
	const silo = makeSilo(`solid-collaboration`)
	const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
	const environment = collaborationEnvironment({
		configSchema: z.object({}),
		key: `solid-document`,
		members: {
			body: { role: `durable`, schema: z.string(), token: bodyAtom },
		},
		version: 1,
	})
	const scope = await environment.activate({
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
	scope[Symbol.dispose]()
})
