import { act, cleanup, fireEvent, render } from "@testing-library/react"
import { disposeState } from "atom.io"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { hydrateRoot } from "react-dom/client"
import { renderToString } from "react-dom/server"

import {
	draftAtoms,
	DraftEditor,
} from "../../../atom.io/docs/source/exhibits/react/effects/06-autosave-after-let-the-draft-own-its-saves.tsx"
import { DraftEditor as ComponentDraftEditor } from "../../../atom.io/docs/source/exhibits/react/effects/06-autosave-before-tie-autosaving-to-component-lifetime.tsx"
import { AccountName } from "../../../atom.io/docs/source/exhibits/react/effects/07-fetch-after-load-each-account-by-its-key.tsx"
import { JobProgress } from "../../../atom.io/docs/source/exhibits/react/effects/09-polling-after-give-each-job-an-explicit-polling-owner.tsx"
import { ChatRoom } from "../../../atom.io/docs/source/exhibits/react/effects/12-connection-after-let-connection-state-own-the-socket.tsx"
import { MapView } from "../../../atom.io/docs/source/exhibits/react/effects/14-widget-after-let-attachment-state-own-the-widget.tsx"
import { Card } from "../../../atom.io/docs/source/exhibits/react/effects/17-visibility-after-let-node-state-own-the-observer.tsx"
import { Greeting } from "../../../atom.io/docs/source/exhibits/react/effects/19-hydration-after-match-hydration-through-server-and-client-snapshots.tsx"
import * as services from "../../../atom.io/docs/source/exhibits/react/effects/services.ts"

vi.mock(`../../../atom.io/docs/source/exhibits/react/effects/services.ts`, {
	spy: true,
})

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

afterEach(() => {
	cleanup()
	vi.useRealTimers()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})

it(`the component autosaver skips initial data and cancels pending edits on unmount`, async () => {
	vi.useFakeTimers()
	const save = vi.spyOn(services, `saveDraft`).mockResolvedValue(undefined)
	const view = render(<ComponentDraftEditor draftId="component-draft" />)
	await vi.advanceTimersByTimeAsync(400)
	expect(save).not.toHaveBeenCalled()
	fireEvent.change(view.getByRole(`textbox`), { target: { value: `pending` } })
	view.unmount()
	await vi.advanceTimersByTimeAsync(400)
	expect(save).not.toHaveBeenCalled()
})

it(`autosaves in order, keeps pending work after unmount, and cancels it on discard`, async () => {
	vi.useFakeTimers()
	let finishFirst!: () => void
	const save = vi
		.spyOn(services, `saveDraft`)
		.mockImplementationOnce(
			() =>
				new Promise<void>((resolve) => {
					finishFirst = resolve
				}),
		)
		.mockResolvedValue(undefined)
	const view = render(<DraftEditor draftId="draft" />)
	fireEvent.change(view.getByRole(`textbox`), { target: { value: `first` } })
	await act(async () => {
		await vi.advanceTimersByTimeAsync(400)
	})
	expect(save).toHaveBeenCalledExactlyOnceWith(`draft`, `first`)
	fireEvent.change(view.getByRole(`textbox`), { target: { value: `second` } })
	await act(async () => {
		await vi.advanceTimersByTimeAsync(400)
	})
	expect(save).toHaveBeenCalledTimes(1)
	await act(async () => {
		finishFirst()
		await Promise.resolve()
	})
	expect(save).toHaveBeenLastCalledWith(`draft`, `second`)
	fireEvent.change(view.getByRole(`textbox`), { target: { value: `third` } })
	view.unmount()
	await vi.advanceTimersByTimeAsync(400)
	expect(save).toHaveBeenLastCalledWith(`draft`, `third`)
	const reopened = render(<DraftEditor draftId="draft" />)
	fireEvent.change(reopened.getByRole(`textbox`), {
		target: { value: `discarded` },
	})
	reopened.unmount()
	disposeState(draftAtoms, `draft`)
	await vi.advanceTimersByTimeAsync(400)
	expect(save).toHaveBeenCalledTimes(3)
})

it(`shares account loads without displaying an obsolete account after switching identity`, async () => {
	let finishFirst!: (account: services.Account) => void
	const load = vi
		.spyOn(services, `loadAccount`)
		.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					finishFirst = resolve
				}),
		)
		.mockResolvedValue({ name: `Second` })
	const view = render(
		<>
			<AccountName accountId="first" />
			<AccountName accountId="first" />
		</>,
	)
	expect(load).toHaveBeenCalledExactlyOnceWith(`first`)
	await act(async () => {
		view.rerender(<AccountName accountId="second" />)
		await Promise.resolve()
	})
	expect(view.getByText(`Second`)).toBeDefined()
	await act(async () => {
		finishFirst({ name: `First` })
		await Promise.resolve()
	})
	expect(view.queryByText(`First`)).toBeNull()
	expect(load).toHaveBeenCalledTimes(2)
})

it(`polls without overlap and aborts the active request when its host detaches`, async () => {
	vi.useFakeTimers()
	const read = vi
		.spyOn(services, `readJob`)
		.mockResolvedValueOnce({ complete: false, progress: 10 })
		.mockImplementationOnce(() => new Promise(() => {}))
	let view!: ReturnType<typeof render>
	await act(async () => {
		view = render(<JobProgress jobId="job" />)
		await Promise.resolve()
	})
	expect(read).toHaveBeenCalledTimes(1)
	await act(async () => {
		await vi.advanceTimersByTimeAsync(1000)
	})
	expect(read).toHaveBeenCalledTimes(2)
	await vi.advanceTimersByTimeAsync(5000)
	expect(read).toHaveBeenCalledTimes(2)
	const signal = read.mock.calls[1]?.[1]
	view.unmount()
	expect(signal?.aborted).toBe(true)
	await vi.advanceTimersByTimeAsync(5000)
	expect(read).toHaveBeenCalledTimes(2)
})

it(`updates an imperative widget without recreating it and destroys it on detach`, () => {
	const setZoom = vi.fn()
	const destroy = vi.fn()
	const create = vi
		.spyOn(services, `createMap`)
		.mockReturnValue({ setZoom, destroy })
	const view = render(<MapView viewId="map" />)
	expect(create).toHaveBeenCalledTimes(1)
	expect(setZoom).toHaveBeenLastCalledWith(1)
	fireEvent.click(view.getByRole(`button`))
	expect(create).toHaveBeenCalledTimes(1)
	expect(setZoom).toHaveBeenLastCalledWith(2)
	view.unmount()
	expect(destroy).toHaveBeenCalledTimes(1)
})

it(`receives room messages without reconnecting and closes its socket on detach`, () => {
	const socket = vi.fn(
		class {
			public onmessage: ((event: MessageEvent) => void) | null = null
			public close = vi.fn()
		},
	)
	vi.stubGlobal(`WebSocket`, socket)
	const view = render(<ChatRoom roomId="room" />)
	const connection = socket.mock.instances[0]
	expect(connection).toBeDefined()
	act(() => {
		connection.onmessage?.(new MessageEvent(`message`, { data: `Hello` }))
	})
	expect(view.getByText(`Hello`)).toBeDefined()
	expect(socket).toHaveBeenCalledTimes(1)
	view.unmount()
	expect(connection.close).toHaveBeenCalledTimes(1)
	expect(connection.onmessage).toBeNull()
})

it(`does not reconnect an observer when visibility changes and disconnects on detach`, () => {
	const observe = vi.fn()
	const disconnect = vi.fn()
	let report!: IntersectionObserverCallback
	const observer = vi.fn(
		class {
			public observe = observe
			public disconnect = disconnect
			public constructor(callback: IntersectionObserverCallback) {
				report = callback
			}
		},
	)
	vi.stubGlobal(`IntersectionObserver`, observer)
	const view = render(<Card cardId="card" />)
	act(() => {
		report(
			[{ isIntersecting: true } as IntersectionObserverEntry],
			{} as IntersectionObserver,
		)
	})
	expect(view.getByText(`In view`)).toBeDefined()
	expect(observer).toHaveBeenCalledTimes(1)
	expect(observe).toHaveBeenCalledTimes(1)
	view.unmount()
	expect(disconnect).toHaveBeenCalledTimes(1)
})

it(`preserves the server snapshot during hydration before reading client-only atom data`, async () => {
	localStorage.setItem(`displayName`, `Ada`)
	const container = document.createElement(`div`)
	container.innerHTML = renderToString(<Greeting />)
	expect(container.textContent).toBe(`Welcome`)
	document.body.append(container)
	const onRecoverableError = vi.fn()
	let root!: ReturnType<typeof hydrateRoot>
	await act(async () => {
		root = hydrateRoot(container, <Greeting />, { onRecoverableError })
		await Promise.resolve()
	})
	expect(container.textContent).toBe(`Welcome, Ada`)
	expect(onRecoverableError).not.toHaveBeenCalled()
	act(() => {
		root.unmount()
	})
	container.remove()
	localStorage.removeItem(`displayName`)
})
