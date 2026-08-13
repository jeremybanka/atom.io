import { act, fireEvent, render, waitFor } from "@testing-library/react"
import { Silo } from "atom.io"
import { StoreProvider } from "atom.io/react"
import {
	defineMosaicResource,
	MOSAIC_EVENTS,
	MOSAIC_PROTOCOL_VERSION,
	type MosaicSnapshotEnvelope,
	mosaicText,
	type MosaicTextSelection,
	type MosaicTextSnapshot,
	type MosaicTextTimeline,
} from "atom.io/realtime"
import type { MosaicClientHistoryAdapter } from "atom.io/realtime-client"
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

const model = mosaicText({ initialText: `Seed` })
const resource = defineMosaicResource({ key: `shared-markdown`, model })
const history = {
	intent: (mode) => ({ type: mode }),
	read: (state, actor) => model.timeline(state, actor),
} satisfies MosaicClientHistoryAdapter<typeof model, MosaicTextTimeline>

type CursorPresence = MosaicTextSelection

function Workspace({ label }: { label: string }) {
	const mosaic = useMosaic<typeof model, CursorPresence, MosaicTextTimeline>({
		actor: `alice`,
		history,
		resource,
		session: `alice:test-session`,
	})
	return (
		<main>
			<output data-testid="label">{label}</output>
			<output data-testid="session">{mosaic.session}</output>
			<output data-testid="status">{mosaic.status}</output>
			<output data-testid="text">{model.text(mosaic.state)}</output>
			<output data-testid="undo-count">{mosaic.history.undo.length}</output>
			<button
				type="button"
				data-testid="change"
				onClick={() =>
					mosaic.change({
						text: `${model.text(mosaic.state)}!`,
						type: `replace-text`,
					})
				}
			/>
			<button
				type="button"
				data-testid="presence"
				onClick={() => {
					mosaic.publishPresence(model.selectionFromOffsets(mosaic.state, 0, 1))
				}}
			/>
			<button type="button" data-testid="undo" onClick={() => mosaic.undo()} />
		</main>
	)
}

function snapshot(): MosaicSnapshotEnvelope<MosaicTextSnapshot> {
	return {
		acceptedPendingOperationIds: [],
		model: { key: model.key, version: model.version },
		protocolVersion: MOSAIC_PROTOCOL_VERSION,
		resource: resource.key,
		revision: 0,
		session: `alice:test-session`,
		snapshot: model.snapshot(model.create()),
	}
}

describe(`useMosaic`, () => {
	test(`connects through RealtimeProvider and observes optimistic client state`, async () => {
		const socket = new TestSocket()
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `useMosaic test`,
		})
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

		fireEvent.click(app.getByTestId(`change`))
		expect(app.getByTestId(`text`).textContent).toBe(`Seed!`)
		expect(app.getByTestId(`undo-count`).textContent).toBe(`1`)
		const proposal = socket.emitted.find(
			({ event }) => event === MOSAIC_EVENTS.operation,
		)?.payload as Record<string, unknown>
		expect(proposal[`resource`]).toBe(resource.key)
		expect(proposal).not.toHaveProperty(`actor`)

		fireEvent.click(app.getByTestId(`presence`))
		expect(socket.emitted.at(-1)).toMatchObject({
			event: MOSAIC_EVENTS.presence,
			payload: { resource: resource.key, session: `alice:test-session` },
		})

		const joins = socket.emitted.filter(
			({ event }) => event === MOSAIC_EVENTS.join,
		).length
		app.rerender(view(`second`))
		expect(app.getByTestId(`label`).textContent).toBe(`second`)
		expect(app.getByTestId(`session`).textContent).toBe(`alice:test-session`)
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(joins)

		app.unmount()
		expect(socket.emitted.at(-1)).toMatchObject({
			event: MOSAIC_EVENTS.presence,
			payload: { presence: null },
		})
	})
})
