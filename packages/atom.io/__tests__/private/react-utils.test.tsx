import { cleanup, render } from "@testing-library/react"
import * as AtomIO from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import { StoreProvider, useSingleEffect } from "atom.io/react"
import { mySocketKeyAtom } from "atom.io/realtime-client"
import {
	RealtimeContext,
	RealtimeProvider,
	useRealtimeService,
} from "atom.io/realtime-react"
import { useId } from "react"
import type { Socket } from "socket.io-client"
import { vi } from "vitest"

function setNodeEnv(value: `development` | `production`) {
	// @ts-expect-error – test override
	globalThis.env = { NODE_ENV: value }
}

function TestComponent({
	effect,
	deps,
}: {
	effect: () => (() => void) | void
	deps: unknown[]
}) {
	useSingleEffect(effect, deps)
	return <div data-testid="mounted" />
}

describe(`useSingleEffect`, () => {
	beforeEach(() => {
		cleanup()
	})

	it(`runs effect only once in development mode and cleans up correctly`, () => {
		setNodeEnv(`development`)
		const effect = vi.fn(() => {})

		const { rerender } = render(<TestComponent effect={effect} deps={[`a`]} />, {
			reactStrictMode: true,
		})

		expect(effect).toHaveBeenCalledTimes(1)

		rerender(<TestComponent effect={effect} deps={[`a`]} />)
		expect(effect).toHaveBeenCalledTimes(1)

		rerender(<TestComponent effect={effect} deps={[`b`]} />)
		expect(effect).toHaveBeenCalledTimes(2)
	})

	it(`runs effect only once in development mode (with cleanup)`, () => {
		setNodeEnv(`development`)
		const cleanupFn = vi.fn()
		const effect = vi.fn(() => {
			return cleanupFn
		})

		const { rerender } = render(<TestComponent effect={effect} deps={[`a`]} />, {
			reactStrictMode: true,
		})

		expect(effect).toHaveBeenCalledTimes(1)
		expect(cleanupFn).not.toHaveBeenCalled()

		rerender(<TestComponent effect={effect} deps={[`a`]} />)
		expect(effect).toHaveBeenCalledTimes(1)
		expect(cleanupFn).not.toHaveBeenCalled()

		rerender(<TestComponent effect={effect} deps={[`b`]} />)
		expect(cleanupFn).toHaveBeenCalledTimes(1)
		expect(effect).toHaveBeenCalledTimes(2)
	})

	it(`behaves like normal useEffect in production mode`, () => {
		setNodeEnv(`production`)
		const cleanupFn = vi.fn()
		const effect = vi.fn(() => cleanupFn)

		const { rerender, unmount } = render(
			<TestComponent effect={effect} deps={[`x`]} />,
		)

		expect(effect).toHaveBeenCalledTimes(1)

		rerender(<TestComponent effect={effect} deps={[`y`]} />)
		expect(cleanupFn).toHaveBeenCalledTimes(1)
		expect(effect).toHaveBeenCalledTimes(2)

		unmount()
		expect(cleanupFn).toHaveBeenCalledTimes(2)
	})
})

describe(`useRealtimeService`, () => {
	beforeEach(() => {
		cleanup()
	})

	const fakeSocket = {} as unknown as Socket

	const services = new Map<
		string,
		{ consumerCount: number; dispose: () => void }
	>()

	const setupService = vi.fn((_id: string) => () => {})

	function ServiceConsumer() {
		const userId = useId()
		useRealtimeService(`a`, () => setupService(userId))

		return <div data-testid="mounted" />
	}

	test(`refcounting`, () => {
		setNodeEnv(`development`)

		render(
			<RealtimeContext.Provider value={{ socket: fakeSocket, services }}>
				<ServiceConsumer />
				<ServiceConsumer />
			</RealtimeContext.Provider>,
			{
				reactStrictMode: true,
			},
		)
		expect(setupService).toHaveBeenCalledTimes(1)
	})
})

describe(`RealtimeProvider`, () => {
	beforeEach(() => {
		cleanup()
	})

	function fakeRealtimeSocket(id: string) {
		const listeners = new Map<string, Set<(...args: never[]) => void>>()
		return {
			id,
			on: vi.fn((event: string, listener: (...args: never[]) => void) => {
				let eventListeners = listeners.get(event)
				if (!eventListeners) {
					eventListeners = new Set()
					listeners.set(event, eventListeners)
				}
				eventListeners.add(listener)
			}),
			off: vi.fn((event: string, listener: (...args: never[]) => void) => {
				listeners.get(event)?.delete(listener)
			}),
			listeners,
		} as unknown as Socket & {
			listeners: Map<string, Set<(...args: never[]) => void>>
		}
	}

	it(`cleans up listeners in Strict Mode and when replacing sockets`, () => {
		setNodeEnv(`development`)
		const silo = new AtomIO.Silo(
			{
				name: `realtime-provider-test`,
				lifespan: `ephemeral`,
				isProduction: false,
			},
			IMPLICIT.STORE,
		)
		const first = fakeRealtimeSocket(`first`)
		const second = fakeRealtimeSocket(`second`)
		silo.getState(mySocketKeyAtom)
		const { rerender, unmount } = render(
			<StoreProvider store={silo.store}>
				<RealtimeProvider socket={first}>child</RealtimeProvider>
			</StoreProvider>,
			{ reactStrictMode: true },
		)

		expect(first.listeners.get(`connect`)?.size).toBe(1)
		expect(first.listeners.get(`disconnect`)?.size).toBe(1)
		rerender(
			<StoreProvider store={silo.store}>
				<RealtimeProvider socket={second}>child</RealtimeProvider>
			</StoreProvider>,
		)
		expect(first.listeners.get(`connect`)?.size ?? 0).toBe(0)
		expect(first.listeners.get(`disconnect`)?.size ?? 0).toBe(0)
		expect(second.listeners.get(`connect`)?.size).toBe(1)
		expect(second.listeners.get(`disconnect`)?.size).toBe(1)

		unmount()
		expect(second.listeners.get(`connect`)?.size ?? 0).toBe(0)
		expect(second.listeners.get(`disconnect`)?.size ?? 0).toBe(0)
	})
})
