import { waitFor } from "@testing-library/react"
import { Silo } from "atom.io"
import type { MosaicTextIndexRange } from "atom.io/realtime"
import {
	createMosaicTextRangeController,
	type MosaicTextProjectionClient,
	type MosaicTextRangeObserver,
	type MosaicTextRangeProjection,
} from "atom.io/realtime-client"

const projection = (
	range: MosaicTextIndexRange,
	text: string,
	complete = true,
): MosaicTextRangeProjection => ({
	blocks: [],
	complete,
	range,
	segments: [],
	text,
})

const deferred = <Value>() => {
	let resolve!: (value: Value) => void
	const promise = new Promise<Value>((complete) => {
		resolve = complete
	})
	return { promise, resolve }
}

function fixture() {
	const silo = new Silo({
		isProduction: false,
		lifespan: `ephemeral`,
		name: `text-range-controller`,
	})
	let connectivity: `live` | `offline` = `live`
	const residencyListeners = new Set<(state: { connectivity: string }) => void>()
	const observations: Array<{
		listener: (value: MosaicTextRangeProjection) => void
		range: MosaicTextIndexRange
	}> = []
	const releases: ReturnType<typeof vi.fn>[] = []
	const observeRange = vi.fn(
		(
			range: MosaicTextIndexRange,
			listener: (value: MosaicTextRangeProjection) => void,
		): Promise<MosaicTextRangeObserver> => {
			observations.push({ listener, range })
			const release = vi.fn(() => Promise.resolve())
			releases.push(release)
			return Promise.resolve({
				active: true,
				range,
				release,
				[Symbol.dispose]: () => undefined,
			})
		},
	)
	const client = {
		observeRange,
		residency: {
			get state() {
				return { connectivity }
			},
			store: silo.store,
			subscribeState(listener: (state: { connectivity: string }) => void) {
				residencyListeners.add(listener)
				return () => residencyListeners.delete(listener)
			},
		},
	} as unknown as MosaicTextProjectionClient
	return {
		client,
		observations,
		releases,
		setConnectivity(next: typeof connectivity) {
			connectivity = next
			for (const listener of residencyListeners) listener({ connectivity })
		},
		silo,
	}
}

describe(`Mosaic text range controller`, () => {
	test(`retains the last complete cut while a replacement range is acquired`, async () => {
		const setup = fixture()
		const initial = { end: 5, kind: `utf16-range` as const, start: 0 }
		const next = { end: 8, kind: `utf16-range` as const, start: 0 }
		const controller = createMosaicTextRangeController({
			client: setup.client,
			initialRange: initial,
			key: `fixture`,
			silo: setup.silo,
		})
		await waitFor(() => {
			expect(setup.observations).toHaveLength(1)
		})
		setup.observations[0].listener(projection(initial, `alpha`))
		expect(setup.silo.getState(controller.view)).toMatchObject({
			projection: { text: `alpha` },
			status: `ready`,
		})

		setup.silo.setState(controller.range, next)
		await waitFor(() => {
			expect(setup.observations).toHaveLength(2)
		})
		expect(setup.releases[0]).toHaveBeenCalledOnce()
		expect(setup.silo.getState(controller.view)).toMatchObject({
			projection: { text: `alpha` },
			status: `ready`,
		})
		setup.observations[1].listener(projection(next, `short`, false))
		expect(setup.silo.getState(controller.view)).toMatchObject({
			projection: { text: `alpha` },
			status: `ready`,
		})
		setup.observations[1].listener(projection(next, `alphabet`))
		expect(setup.silo.getState(controller.view)).toMatchObject({
			projection: { text: `alphabet` },
			status: `ready`,
		})
		controller[Symbol.dispose]()
		expect(setup.releases[1]).toHaveBeenCalledOnce()
	})

	test(`retries after connectivity returns and releases a late observer`, async () => {
		const setup = fixture()
		const pending = deferred<MosaicTextRangeObserver>()
		const release = vi.fn(() => Promise.resolve())
		vi.mocked(setup.client.observeRange).mockReturnValueOnce(pending.promise)
		const controller = createMosaicTextRangeController({
			client: setup.client,
			initialRange: { end: 0, kind: `utf16-range`, start: 0 },
			key: `late-fixture`,
			silo: setup.silo,
		})
		setup.setConnectivity(`offline`)
		setup.setConnectivity(`live`)
		controller[Symbol.dispose]()
		pending.resolve({
			active: true,
			range: { end: 0, kind: `utf16-range`, start: 0 },
			release,
			[Symbol.dispose]: () => undefined,
		})
		await waitFor(() => {
			expect(release).toHaveBeenCalledOnce()
		})
	})
})
