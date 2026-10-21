import { StoreProvider, useI, useO } from "@atom.io/react"
import { act, fireEvent, render } from "@testing-library/react"
import { Silo } from "atom.io"
import { mosaicDomain } from "atom.io/realtime"
import { z } from "zod"

const makeSilo = (name: string) =>
	new Silo({ isProduction: false, lifespan: `ephemeral`, name })

test(`domain members remain ordinary React provider state`, async () => {
	const silo = makeSilo(`react-collaboration`)
	const bodyAtom = silo.atom<string>({ default: `hello`, key: `body` })
	const domain = mosaicDomain({
		configSchema: z.object({}),
		key: `react-document`,
		members: {
			body: { role: `durable`, schema: z.string(), token: bodyAtom },
		},
		version: 1,
	})
	const instance = await domain.activate({
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
	instance[Symbol.dispose]()
})
