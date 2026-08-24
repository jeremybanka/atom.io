import { act, render, waitFor } from "@testing-library/react"
import type {
	MosaicTextProjectionClient,
	MosaicTextRangeObserver,
	MosaicTextRangeProjection,
} from "atom.io/realtime-client"
import { useMosaicTextRange } from "atom.io/realtime-react"
import type { ReactElement } from "react"

const projection: MosaicTextRangeProjection = {
	blocks: [],
	complete: true,
	range: { end: 5, kind: `utf16-range`, start: 0 },
	revision: 1,
	segments: [
		{
			end: 5,
			fragments: [{ runId: `base`, start: 0, text: `alpha` }],
			id: `leaf:alpha`,
			start: 0,
			text: `alpha`,
		},
	],
	text: `alpha`,
}

test(`ignores late range updates and releases an observer acquired after unmount`, async () => {
	let listener: ((next: MosaicTextRangeProjection) => void) | null = null
	let resolveObserver: ((observer: MosaicTextRangeObserver) => void) | null =
		null
	const release = vi.fn(() => Promise.resolve())
	const stopResidency = vi.fn()
	const observeRange = vi.fn(
		(
			_range: unknown,
			nextListener: (next: MosaicTextRangeProjection) => void,
		) => {
			listener = nextListener
			return new Promise<MosaicTextRangeObserver>((resolve) => {
				resolveObserver = resolve
			})
		},
	)
	const client = {
		observeRange,
		residency: {
			state: { connectivity: `live` },
			store: { logger: { error: vi.fn() } },
			subscribeState: () => stopResidency,
		},
	} as unknown as MosaicTextProjectionClient
	let status = ``
	const Probe = (): ReactElement => {
		const view = useMosaicTextRange(client, {
			end: 5,
			kind: `utf16-range`,
			start: 0,
		})
		status = view.status
		return <output>{view.status}</output>
	}

	const rendered = render(<Probe />)
	await waitFor(() => {
		expect(observeRange).toHaveBeenCalledOnce()
	})
	expect(status).toBe(`loading`)
	rendered.unmount()
	expect(stopResidency).toHaveBeenCalledOnce()

	act(() => listener?.(projection))
	await act(async () => {
		resolveObserver?.({ release } as unknown as MosaicTextRangeObserver)
		await Promise.resolve()
	})
	expect(release).toHaveBeenCalledOnce()
})
