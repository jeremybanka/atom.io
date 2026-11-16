import { negotiateRealtimeProtocol } from "@atom.io/realtime"
import { createRealtimeProtocolSession } from "@atom.io/realtime/server"

const offer = {
	versions: [1, 2],
	capabilities: [`commands`, `rigid`],
	models: { text: [1, 2] },
}

describe(`protocol negotiation`, () => {
	test(`selects highest common protocol/model versions symmetrically`, () => {
		const older = {
			versions: [1],
			capabilities: [`commands`],
			models: { text: [1] },
		}
		expect(negotiateRealtimeProtocol(offer, older)).toEqual(
			negotiateRealtimeProtocol(older, offer),
		)
		expect(negotiateRealtimeProtocol(offer, older)).toMatchObject({
			status: `accepted`,
			version: 1,
			models: { text: 1 },
		})
	})
	test(`rejects incompatible versions, required capabilities, models, and malformed offers`, () => {
		expect(
			negotiateRealtimeProtocol(offer, { ...offer, versions: [3] }),
		).toMatchObject({ code: `incompatible-version` })
		expect(
			negotiateRealtimeProtocol(offer, {
				...offer,
				requiredCapabilities: [`missing`],
			}),
		).toMatchObject({ code: `missing-capability` })
		expect(
			negotiateRealtimeProtocol(offer, { ...offer, models: { text: [3] } }),
		).toMatchObject({ code: `incompatible-model` })
		expect(
			negotiateRealtimeProtocol(offer, { ...offer, versions: [Number.NaN] }),
		).toMatchObject({ code: `invalid-offer` })
		expect(
			negotiateRealtimeProtocol(
				{ ...offer, models: {} },
				{ ...offer, models: { constructor: [1] } },
			),
		).toMatchObject({ code: `incompatible-model` })
	})
	test(`never starts services for incompatible peers and seals one negotiation`, async () => {
		const start = vi.fn(() => () => {})
		const session = createRealtimeProtocolSession(offer, start)
		expect(await session.negotiate({ ...offer, versions: [3] })).toMatchObject({
			status: `rejected`,
		})
		await session.negotiate(offer)
		expect(start).not.toHaveBeenCalled()
		await session.dispose()
	})
	test(`disposal waits for asynchronous setup and cleans up exactly once`, async () => {
		let finish!: (value: () => void) => void
		const cleanup = vi.fn()
		const start = vi.fn(
			() =>
				new Promise<() => void>((resolve) => {
					finish = resolve
				}),
		)
		const session = createRealtimeProtocolSession(offer, start)
		const first = session.negotiate(offer)
		const second = session.negotiate(offer)
		const disposal = session.dispose()
		finish(cleanup)
		await Promise.all([first, second, disposal, session.dispose()])
		expect(start).toHaveBeenCalledTimes(1)
		expect(cleanup).toHaveBeenCalledTimes(1)
		await expect(session.negotiate(offer)).rejects.toThrow(`disposed`)
	})
})
