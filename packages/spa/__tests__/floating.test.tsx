import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { floatingCapability } from "../src/floating.ts"
import { hydrate, render, useGetter, useRef } from "../src/index.ts"
import { motionCapability } from "../src/motion.ts"
import { renderToString } from "../src/server.ts"

const engine = vi.hoisted(() => ({
	compute: vi.fn(),
	observe: vi.fn(),
	stops: [] as ReturnType<typeof vi.fn>[],
	updates: [] as (() => void)[],
}))
vi.mock(`@floating-ui/dom`, () => ({
	computePosition: engine.compute,
	autoUpdate: engine.observe,
}))

const settle = async () => {
	await Promise.resolve()
	await Promise.resolve()
}
beforeEach(() => {
	engine.compute.mockReset().mockResolvedValue({ x: 120, y: 60 })
	engine.observe
		.mockReset()
		.mockImplementation((_reference, _element, update) => {
			engine.updates.push(update)
			const stop = vi.fn()
			engine.stops.push(stop)
			update()
			return stop
		})
	engine.stops.length = 0
	engine.updates.length = 0
})
afterEach(() => {
	document.body.innerHTML = ``
})

it.each([true, false])(
	`adds and removes floating attributes beside Motion, floating first: %s`,
	async (floatingFirst) => {
		const silo = new Silo({
			name: `floating-motion`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const installedAtom = silo.atom<boolean>({
			key: `installed`,
			default: false,
		})
		const anchor = document.createElement(`button`)
		const host = document.createElement(`div`)
		document.body.append(anchor, host)
		const motion = { "motion:animate": { y: -4, scale: 0.8 } }
		function App() {
			const getInstalled = useGetter(installedAtom)
			const floating = () =>
				getInstalled() ? { "floating:reference": anchor } : {}
			return (
				<div
					{...(floatingFirst
						? { ...floating(), ...motion }
						: { ...motion, ...floating() })}
				/>
			)
		}
		const root = render(() => <App />, host, {
			store: silo.store,
			capabilities: [
				floatingCapability(),
				motionCapability({ reducedMotion: `always` }),
			],
		})
		try {
			const panel = host.querySelector(`div`)!
			await vi.waitFor(() => {
				expect(panel.style.transform).toContain(`scale(0.8)`)
			})
			const transform = panel.style.transform
			silo.setState(installedAtom, true)
			root.flush()
			await settle()
			expect(engine.observe).toHaveBeenCalledOnce()
			expect(panel.style.translate).toBe(`120px 60px`)
			expect(panel.style.transform).toBe(transform)
			silo.setState(installedAtom, false)
			root.flush()
			expect(engine.stops[0]).toHaveBeenCalledOnce()
			expect(panel.style.translate).toBe(``)
			expect(panel.style.transform).toBe(transform)
			silo.setState(installedAtom, true)
			root.flush()
			await settle()
			expect(engine.observe).toHaveBeenCalledTimes(2)
			expect(panel.style.translate).toBe(`120px 60px`)
		} finally {
			root.dispose()
		}
	},
)

function fixture() {
	const silo = new Silo({
		name: `floating`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const anchorAtom = silo.atom<HTMLButtonElement | null>({
		key: `anchor`,
		default: null,
	})
	const enabledAtom = silo.atom<boolean>({ key: `enabled`, default: true })
	const placementAtom = silo.atom<`bottom` | `top`>({
		key: `placement`,
		default: `bottom`,
	})
	const host = document.createElement(`div`)
	document.body.append(host)
	function App() {
		const attachAnchor = useRef(anchorAtom)
		const getAnchor = useGetter(anchorAtom)
		const getEnabled = useGetter(enabledAtom)
		const getPlacement = useGetter(placementAtom)
		return (
			<>
				<button ref={attachAnchor}>Anchor</button>
				<div
					data-panel
					style="position: relative; left: 3px; top: 4px; translate: 1px 2px !important; transform: rotate(5deg); visibility: visible !important"
					floating:reference={getAnchor()}
					floating:enabled={getEnabled()}
					floating:placement={getPlacement()}
					floating:autoUpdate={{ ancestorScroll: true }}
				>
					Overlay
				</div>
			</>
		)
	}
	return { silo, anchorAtom, enabledAtom, placementAtom, host, App }
}

it(`waits for refs, positions with translate, and restores only its own inline properties`, async () => {
	const f = fixture()
	const root = render(() => <f.App />, f.host, {
		store: f.silo.store,
		capabilities: [floatingCapability()],
	})
	const panel = f.host.querySelector<HTMLElement>(`[data-panel]`)!
	expect(engine.observe).toHaveBeenCalledOnce()
	expect(engine.observe.mock.calls[0][0]).toBe(f.host.querySelector(`button`))
	expect(panel.style.visibility).toBe(`hidden`)
	await settle()
	expect(panel.style.translate).toBe(`120px 60px`)
	expect(panel.style.position).toBe(`absolute`)
	expect(panel.style.left).toBe(`0px`)
	expect(panel.style.transform).toBe(`rotate(5deg)`)
	expect(panel.style.visibility).toBe(`visible`)
	expect(panel.style.getPropertyPriority(`visibility`)).toBe(`important`)
	f.silo.setState(f.placementAtom, `top`)
	root.flush()
	await settle()
	expect(engine.observe).toHaveBeenCalledOnce()
	expect(engine.compute).toHaveBeenLastCalledWith(expect.anything(), panel, {
		placement: `top`,
		strategy: `absolute`,
		middleware: [],
	})
	f.silo.setState(f.enabledAtom, false)
	root.flush()
	expect(engine.stops[0]).toHaveBeenCalledOnce()
	const calls = engine.compute.mock.calls.length
	engine.updates[0]()
	expect(engine.compute).toHaveBeenCalledTimes(calls)
	expect(panel.style.translate).toBe(`1px 2px`)
	expect(panel.style.getPropertyPriority(`translate`)).toBe(`important`)
	expect(panel.style.position).toBe(`relative`)
	expect(panel.style.left).toBe(`3px`)
	f.silo.setState(f.enabledAtom, true)
	root.flush()
	await settle()
	expect(engine.observe).toHaveBeenCalledTimes(2)
	root.dispose()
	root.dispose()
	engine.updates[1]()
	expect(engine.stops[1]).toHaveBeenCalledOnce()
	expect(panel.style.translate).toBe(`1px 2px`)
	expect(panel.style.transform).toBe(`rotate(5deg)`)
})

it(`reconnects changed references and observer options, and supports virtual references without observers`, async () => {
	const element = document.createElement(`div`)
	const one = document.createElement(`button`)
	const two = document.createElement(`button`)
	document.body.append(one, two, element)
	const binding = floatingCapability().attach({ kind: `dom`, node: element })
	binding.update({ reference: one })
	await settle()
	binding.update({
		reference: two,
		autoUpdate: { animationFrame: true },
		strategy: `fixed`,
	})
	await settle()
	expect(engine.stops[0]).toHaveBeenCalledOnce()
	expect(engine.observe).toHaveBeenLastCalledWith(
		two,
		element,
		expect.any(Function),
		{ animationFrame: true },
	)
	expect(element.style.position).toBe(`fixed`)
	const virtual = { getBoundingClientRect: () => new DOMRect(20, 30, 0, 0) }
	const middleware = [{ name: `test`, fn: () => ({}) }]
	binding.update({ reference: virtual, autoUpdate: false, middleware })
	await settle()
	expect(engine.stops[1]).toHaveBeenCalledOnce()
	expect(engine.observe).toHaveBeenCalledTimes(2)
	expect(engine.compute).toHaveBeenLastCalledWith(virtual, element, {
		placement: `bottom`,
		strategy: `absolute`,
		middleware,
	})
	binding.update({ reference: null })
	expect(element.style.translate).toBe(``)
	expect(element.style.position).toBe(``)
	binding.dispose()
	binding.dispose()
})

it(`surfaces failures from a manually owned binding without an unhandled promise rejection`, async () => {
	const element = document.createElement(`div`)
	const binding = floatingCapability().attach({ kind: `dom`, node: element })
	binding.update({ reference: document.createElement(`button`) })
	await settle()
	const error = new Error(`manual middleware failed`)
	const queued: VoidFunction[] = []
	const schedule = vi
		.spyOn(globalThis, `queueMicrotask`)
		.mockImplementation((run) => {
			queued.push(run)
		})
	try {
		engine.compute.mockRejectedValue(error)
		engine.updates[0]()
		await settle()
		expect(queued).toHaveLength(1)
		expect(queued[0]).toThrow(error)
	} finally {
		binding.dispose()
		schedule.mockRestore()
	}
})

it(`ignores out-of-order results and settlements after reference replacement, disabling, and disposal`, async () => {
	const pending: {
		resolve(value: { x: number; y: number }): void
		reject(error: Error): void
	}[] = []
	engine.compute.mockImplementation(
		() => new Promise((resolve, reject) => pending.push({ resolve, reject })),
	)
	const f = fixture()
	const root = render(() => <f.App />, f.host, {
		store: f.silo.store,
		capabilities: [floatingCapability()],
	})
	const panel = f.host.querySelector<HTMLElement>(`[data-panel]`)!
	engine.updates[0]()
	pending[1].resolve({ x: 200, y: 100 })
	await settle()
	pending[0].resolve({ x: 1, y: 1 })
	await settle()
	expect(panel.style.translate).toBe(`200px 100px`)
	engine.updates[0]()
	f.silo.setState(f.anchorAtom, document.createElement(`button`))
	root.flush()
	pending[2].reject(new Error(`stale reference`))
	await settle()
	f.silo.setState(f.enabledAtom, false)
	root.flush()
	pending[3].resolve({ x: 999, y: 999 })
	await settle()
	expect(panel.style.translate).toBe(`1px 2px`)
	f.silo.setState(f.enabledAtom, true)
	root.flush()
	root.dispose()
	pending[4].reject(new Error(`disposed`))
	await settle()
	expect(panel.style.translate).toBe(`1px 2px`)
})

it(`reports asynchronous failures to the root and disposes all observers`, async () => {
	const error = new Error(`middleware failed`)
	engine.compute.mockRejectedValue(error)
	const onError = vi.fn()
	const f = fixture()
	const root = render(() => <f.App />, f.host, {
		store: f.silo.store,
		capabilities: [floatingCapability()],
		onError,
	})
	await settle()
	expect(onError).toHaveBeenCalledWith(error)
	expect(engine.stops[0]).toHaveBeenCalledOnce()
	expect(f.host.querySelector(`[data-panel]`)).toBeNull()
	root.dispose()
})

it(`omits browser work during SSR and reuses hydrated nodes`, async () => {
	const f = fixture()
	const options = { store: f.silo.store, capabilities: [floatingCapability()] }
	const html = renderToString(() => <f.App />, options)
	expect(html).not.toContain(`floating:`)
	expect(engine.compute).not.toHaveBeenCalled()
	expect(engine.observe).not.toHaveBeenCalled()
	f.host.innerHTML = html
	const panel = f.host.querySelector(`[data-panel]`)
	const root = hydrate(() => <f.App />, f.host, options)
	await settle()
	expect(f.host.querySelector(`[data-panel]`)).toBe(panel)
	expect(engine.observe).toHaveBeenCalledOnce()
	root.dispose()
})

it(`rejects unsupported renderers and unknown attributes, and cancels mounting after early disposal`, async () => {
	expect(() => floatingCapability().attach({ kind: `three`, node: {} })).toThrow(
		`HTML elements`,
	)
	expect(() =>
		floatingCapability().attach({
			kind: `dom`,
			node: document.createElementNS(`http://www.w3.org/2000/svg`, `svg`),
		}),
	).toThrow(`HTML elements`)
	const element = document.createElement(`div`)
	const binding = floatingCapability().attach({ kind: `dom`, node: element })
	expect(() => {
		binding.update({ nonsense: true })
	}).toThrow(`unknown property floating:nonsense`)
	binding.update({ reference: document.createElement(`button`) })
	binding.dispose()
	binding.update({ reference: document.createElement(`button`) })
	await settle()
	expect(engine.compute).not.toHaveBeenCalled()
	expect(element.style.translate).toBe(``)
})
