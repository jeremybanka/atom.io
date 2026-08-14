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
import { useEffect } from "react"
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

	public listenerCount(event: string): number {
		return this.#listeners.get(event)?.size ?? 0
	}

	public receive(event: string, payload?: unknown): void {
		for (const listener of this.#listeners.get(event) ?? []) listener(payload)
	}
}

function setNodeEnv(value: `development` | `production`) {
	// @ts-expect-error – test override
	globalThis.env = { NODE_ENV: value }
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
			<output data-testid="address">{mosaic.address.key}</output>
			<output data-testid="atom">{mosaic.atom.key}</output>
			<output data-testid="label">{label}</output>
			<output data-testid="session">{mosaic.session}</output>
			<output data-testid="status">{mosaic.status}</output>
			<output data-testid="sync-state">{mosaic.syncState.key}</output>
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

function ConnectionProbe({
	label,
	onController,
}: {
	label: string
	onController: (controller: object) => void
}) {
	const mosaic = useMosaic<InstanceType<typeof Markdown>, MosaicTextSelection>(
		markdownAtom,
		{ actor: `alice`, session: `alice:test-session` },
	)
	useEffect(() => {
		onController(mosaic.controller)
	}, [mosaic.controller, onController])
	return <output data-testid={`${label}-status`}>{mosaic.status}</output>
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
		expect(app.getByTestId(`atom`).textContent).toBe(markdownAtom.key)
		expect(app.getByTestId(`address`).textContent).toBe(
			mosaicAtomAddress(markdownAtom).key,
		)
		expect(app.getByTestId(`sync-state`).textContent).toContain(
			`mosaic:sync-state`,
		)
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

	test(`keeps one render-stable service through StrictMode replay`, async () => {
		setNodeEnv(`development`)
		const socket = new TestSocket()
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `useMosaic StrictMode test`,
		})
		silo.install([markdownAtom, markdownLengthSelector])
		const services = new Map()
		const app = render(
			<StoreProvider store={silo.store}>
				<RealtimeContext.Provider
					value={{ services, socket: socket as unknown as Socket }}
				>
					<Workspace label="strict" />
				</RealtimeContext.Provider>
			</StoreProvider>,
			{ reactStrictMode: true },
		)

		await waitFor(() => {
			expect(services.size).toBe(1)
		})
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(1)
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(1)

		app.unmount()
		expect(services.size).toBe(0)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(0)
		setNodeEnv(`production`)
	})

	test(`refcounts hook instances that share a Store-owned controller`, async () => {
		const socket = new TestSocket()
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `shared useMosaic owner`,
		})
		silo.install([markdownAtom])
		const services = new Map()
		const controllers = new Set<object>()
		const recordController = (controller: object): void => {
			controllers.add(controller)
		}
		const view = (showFirst: boolean) => (
			<StoreProvider store={silo.store}>
				<RealtimeContext.Provider
					value={{ services, socket: socket as unknown as Socket }}
				>
					{showFirst ? (
						<ConnectionProbe label="first" onController={recordController} />
					) : null}
					<ConnectionProbe label="second" onController={recordController} />
				</RealtimeContext.Provider>
			</StoreProvider>
		)
		const app = render(view(true))

		await waitFor(() => {
			expect(services.size).toBe(1)
		})
		expect(controllers.size).toBe(1)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(1)
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(1)

		app.rerender(view(false))
		expect(services.size).toBe(1)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(1)

		app.unmount()
		expect(services.size).toBe(0)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(0)
	})

	test(`isolates equal atom and session services owned by different Stores`, async () => {
		const socket = new TestSocket()
		const first = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `first useMosaic owner`,
		})
		const second = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `second useMosaic owner`,
		})
		first.install([markdownAtom])
		second.install([markdownAtom])
		const services = new Map()
		const controllers = new Set<object>()
		const recordController = (controller: object): void => {
			controllers.add(controller)
		}
		const view = (showFirst: boolean) => (
			<RealtimeContext.Provider
				value={{ services, socket: socket as unknown as Socket }}
			>
				{showFirst ? (
					<StoreProvider store={first.store}>
						<ConnectionProbe label="first" onController={recordController} />
					</StoreProvider>
				) : null}
				<StoreProvider store={second.store}>
					<ConnectionProbe label="second" onController={recordController} />
				</StoreProvider>
			</RealtimeContext.Provider>
		)
		const app = render(view(true))

		await waitFor(() => {
			expect(services.size).toBe(2)
		})
		expect(controllers.size).toBe(2)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(2)
		expect(
			socket.emitted.filter(({ event }) => event === MOSAIC_EVENTS.join),
		).toHaveLength(2)

		act(() => {
			socket.receive(MOSAIC_EVENTS.snapshot, snapshot())
		})
		expect(app.getByTestId(`first-status`).textContent).toBe(`live`)
		expect(app.getByTestId(`second-status`).textContent).toBe(`live`)

		app.rerender(view(false))
		await waitFor(() => {
			expect(services.size).toBe(1)
		})
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(1)
		expect(app.getByTestId(`second-status`).textContent).toBe(`live`)

		app.unmount()
		expect(services.size).toBe(0)
		expect(socket.listenerCount(MOSAIC_EVENTS.snapshot)).toBe(0)
	})
})
