import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { mutableAtom, selector, Silo } from "atom.io"
import { StoreProvider, useO } from "atom.io/react"
import {
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	mosaicAtomAddress,
	type MosaicSnapshotEnvelope,
	mosaicText,
	type MosaicTextSelection,
	type MosaicTextSnapshot,
} from "atom.io/realtime"
import { RealtimeContext, useMosaic } from "atom.io/realtime-react"
import type { Socket } from "socket.io-client"

type Listener = (...args: any[]) => void

class TestSocket {
	public connected = true
	public readonly emitted: { event: string; payload: unknown }[] = []
	public readonly id = `test-socket`
	readonly #listeners = new Map<string, Set<Listener>>()

	public emit(event: string, payload?: unknown): this {
		this.emitted.push({ event, payload })
		return this
	}

	public off(event: string, listener?: Listener): this {
		if (listener === undefined) this.#listeners.delete(event)
		else this.#listeners.get(event)?.delete(listener)
		return this
	}

	public on(event: string, listener: Listener): this {
		const listeners = this.#listeners.get(event) ?? new Set()
		listeners.add(listener)
		this.#listeners.set(event, listeners)
		return this
	}

	public receive(event: string, payload?: unknown): void {
		for (const listener of this.#listeners.get(event) ?? []) listener(payload)
	}
}

const Markdown = mosaicText({ initialText: `Seed` })
const markdownAtom = mutableAtom<InstanceType<typeof Markdown>>({
	key: `markdown`,
	class: Markdown,
})
const markdownLengthSelector = selector<number>({
	key: `markdownLength`,
	get: ({ get }) => get(markdownAtom).length,
})

function Workspace({ label }: { label: string }) {
	const document = useO(markdownAtom)
	const length = useO(markdownLengthSelector)
	const mosaic = useMosaic<InstanceType<typeof Markdown>, MosaicTextSelection>(
		markdownAtom,
		{ actor: `alice`, session: `alice:test-session` },
	)
	return (
		<main>
			<output data-testid="label">{label}</output>
			<output data-testid="session">{mosaic.session}</output>
			<output data-testid="status">{mosaic.status}</output>
			<output data-testid="text">{document.text}</output>
			<output data-testid="length">{length}</output>
			<output data-testid="undo-count">
				{document.historyFor(`alice`).undo.length}
			</output>
			<button
				type="button"
				data-testid="change"
				onClick={() => {
					mosaic.change({ text: `${document.text}!`, type: `replace-text` })
				}}
			/>
			<button
				type="button"
				data-testid="presence"
				onClick={() => {
					mosaic.publishPresence(document.selectionFromOffsets(0, 1))
				}}
			/>
			<button
				type="button"
				data-testid="controls"
				onClick={() => {
					mosaic.clearProblem()
					mosaic.createGroupId()
					mosaic.retryPending()
					mosaic.synchronize()
				}}
			/>
		</main>
	)
}

function snapshot(): MosaicSnapshotEnvelope<MosaicTextSnapshot> {
	return {
		acceptedPendingOperationIds: [],
		atom: mosaicAtomAddress(markdownAtom),
		headOperationIds: [],
		model: Markdown.mosaic,
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		revision: 0,
		session: `alice:test-session`,
		snapshot: new Markdown().toJSON(),
	}
}

describe(`useMosaic`, () => {
	test(`connects a Store-native atom and leaves graph observation to useO`, async () => {
		const socket = new TestSocket()
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `useMosaic test`,
		})
		silo.install([markdownAtom, markdownLengthSelector])
		const services = new Map()
		const view = (label: string) => (
			<StoreProvider store={silo.store}>
				<RealtimeContext.Provider
					value={{ services, socket: socket as unknown as Socket }}
				>
					<Workspace label={label} />
				</RealtimeContext.Provider>
			</StoreProvider>
		)
		const app = render(view(`first`))

		await waitFor(() => {
			expect(
				socket.emitted.some(({ event }) => event === MOSAIC_EVENTS.join),
			).toBe(true)
		})
		expect(app.getByTestId(`status`).textContent).toBe(`syncing`)
		act(() => {
			socket.receive(MOSAIC_EVENTS.snapshot, snapshot())
		})
		expect(app.getByTestId(`status`).textContent).toBe(`live`)
		expect(app.getByTestId(`text`).textContent).toBe(`Seed`)
		expect(app.getByTestId(`length`).textContent).toBe(`4`)

		fireEvent.click(app.getByTestId(`change`))
		expect(app.getByTestId(`text`).textContent).toBe(`Seed!`)
		expect(app.getByTestId(`length`).textContent).toBe(`5`)
		expect(app.getByTestId(`undo-count`).textContent).toBe(`1`)
		const proposal = socket.emitted.find(
			({ event }) => event === MOSAIC_EVENTS.operation,
		)?.payload as Record<string, unknown>
		expect(proposal[`atom`]).toEqual(mosaicAtomAddress(markdownAtom))
		expect(proposal).not.toHaveProperty(`actor`)

		fireEvent.click(app.getByTestId(`presence`))
		expect(socket.emitted.at(-1)).toMatchObject({
			event: MOSAIC_EVENTS.presence,
			payload: {
				atom: mosaicAtomAddress(markdownAtom),
				session: `alice:test-session`,
			},
		})
		fireEvent.click(app.getByTestId(`controls`))
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(2)

		const joinCount = socket.emitted.filter(
			({ event }) => event === MOSAIC_EVENTS.join,
		).length
		app.rerender(view(`second`))
		expect(app.getByTestId(`label`).textContent).toBe(`second`)
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(joinCount)

		app.unmount()
		expect(services.size).toBe(0)
	})
})
