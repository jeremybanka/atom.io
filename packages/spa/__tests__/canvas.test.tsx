import { onMount, render, useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import { Canvas, Mesh } from "../src/three.ts"

const renderers = vi.hoisted(() => [] as any[])
vi.mock(`three`, async (actual) => ({
	...(await actual<typeof THREE>()),
	WebGLRenderer: vi.fn(function (options) {
		const native = {
			domElement: options.canvas,
			options,
			setSize: vi.fn(),
			setPixelRatio: vi.fn(),
			render: vi.fn(),
			dispose: vi.fn(),
		}
		renderers.push(native)
		return native
	}),
}))
const initialDpr = window.devicePixelRatio
const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
	renderers.length = 0
	Object.defineProperty(window, `devicePixelRatio`, {
		value: initialDpr,
		configurable: true,
	})
	vi.unstubAllGlobals()
	document.body.replaceChildren()
})
function fixture() {
	const silo = new Silo({
		name: `canvas-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const widthAtom = silo.atom<number>({ key: `width`, default: 200 })
	let tick!: (time: number) => void
	const stop = vi.fn()
	const onError = vi.fn()
	const clock = {
		namespace: `clock`,
		scheduleFrame: vi.fn((run) => {
			tick = run
			return stop
		}),
		attach: vi.fn(),
	}
	const mount = (setup: Parameters<typeof render>[0]) => {
		const root = render(setup, document.body, {
			store: silo.store,
			capabilities: [clock],
			onError,
		})
		cleanups.push(root.dispose)
		return root
	}
	return {
		silo,
		widthAtom,
		clock,
		stop,
		onError,
		mount,
		tick: (time = 16) => {
			tick(time)
		},
	}
}

it(`configures construction, DPR, scene, and camera before a single owned drawing loop`, () => {
	const f = fixture()
	const ready = vi.fn(({ renderer, scene, camera }) => {
		expect(scene.children).toHaveLength(1)
		expect(camera.aspect).toBe(2)
		expect(renderer.setPixelRatio).toHaveBeenLastCalledWith(2)
		expect(renderer.setSize).toHaveBeenLastCalledWith(200, 100)
		expect(renderer.render).not.toHaveBeenCalled()
		renderer.toneMapping = THREE.ACESFilmicToneMapping
		renderer.outputColorSpace = THREE.SRGBColorSpace
		return disposed
	})
	const disposed = vi.fn()
	Object.defineProperty(window, `devicePixelRatio`, {
		value: 3,
		configurable: true,
	})
	function App() {
		const getWidth = useGetter(f.widthAtom)
		return (
			<Canvas
				width={getWidth()}
				height={100}
				dpr={[1, 2]}
				rendererOptions={{ alpha: true, powerPreference: `high-performance` }}
				onCreated={ready}
			>
				<Mesh />
			</Canvas>
		)
	}
	const root = f.mount(() => <App />)
	const native = renderers[0]
	expect(native.options).toMatchObject({
		alpha: true,
		antialias: true,
		powerPreference: `high-performance`,
		canvas: document.querySelector(`canvas`),
	})
	expect(ready).toHaveBeenCalledOnce()
	expect(f.clock.scheduleFrame).toHaveBeenCalledOnce()
	f.tick()
	expect(native.render).toHaveBeenCalledOnce()
	f.silo.setState(f.widthAtom, 400)
	root.flush()
	expect(native.setSize).toHaveBeenLastCalledWith(400, 100)
	expect(ready.mock.calls[0][0].camera.aspect).toBe(4)
	Object.defineProperty(window, `devicePixelRatio`, {
		value: 1.5,
		configurable: true,
	})
	window.dispatchEvent(new Event(`resize`))
	expect(native.setPixelRatio).toHaveBeenLastCalledWith(1.5)
	root.dispose()
	expect(native.dispose).toHaveBeenCalledOnce()
	expect(disposed).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
	const sizes = native.setSize.mock.calls.length
	window.dispatchEvent(new Event(`resize`))
	expect(native.setSize).toHaveBeenCalledTimes(sizes)
})

it(`runs Canvas setup after scene refs and mount hooks, before scheduling the first draw`, () => {
	const f = fixture()
	const order: string[] = []
	let mesh: THREE.Mesh | null = null
	function Content() {
		onMount(() => {
			mesh!.position.y = 2
			order.push(`mount`)
		})
		return (
			<Mesh
				ref={(node) => {
					mesh = node
					if (node) order.push(`ref`)
				}}
			/>
		)
	}
	const ready = vi.fn(({ scene, renderer }) => {
		expect(mesh).toBe(scene.children[0])
		expect(mesh!.position.y).toBe(2)
		expect(renderer.render).not.toHaveBeenCalled()
		expect(f.clock.scheduleFrame).not.toHaveBeenCalled()
		mesh!.position.x = 1
		order.push(`created`)
	})
	const root = f.mount(() => (
		<Canvas onCreated={ready} onFrame={() => order.push(`frame`)}>
			<Content />
		</Canvas>
	))
	const native = renderers[0]
	native.render.mockImplementation((scene: THREE.Scene) => {
		expect(scene.children[0].position.toArray()).toEqual([1, 2, 0])
		order.push(`draw`)
	})
	expect(order).toEqual([`ref`, `mount`, `created`])
	f.tick()
	expect(order).toEqual([`ref`, `mount`, `created`, `frame`, `draw`])
	root.flush()
	expect(ready).toHaveBeenCalledOnce()
})

it(`supports an owned renderer factory and leaves a borrowed camera projection to the application`, () => {
	const f = fixture()
	const camera = new THREE.OrthographicCamera(-3, 3, 2, -2)
	const projection = camera.projectionMatrix.clone()
	const factory = vi.fn((options) => new THREE.WebGLRenderer(options))
	const resized = vi.fn()
	const root = f.mount(() => (
		<Canvas camera={camera} createRenderer={factory} onResize={resized} />
	))
	expect(factory).toHaveBeenCalledExactlyOnceWith({
		antialias: true,
		canvas: document.querySelector(`canvas`),
	})
	expect(camera.projectionMatrix.equals(projection)).toBe(true)
	expect(resized).toHaveBeenLastCalledWith(
		expect.objectContaining({ camera, width: 800, height: 600, dpr: 1 }),
	)
	f.tick()
	expect(renderers[0].render).toHaveBeenCalledWith(
		expect.any(THREE.Scene),
		camera,
	)
	root.dispose()
	expect(renderers[0].dispose).toHaveBeenCalledOnce()
})

it.each([`setup`, `element`, `dimensions`])(
	`cleans failed Canvas %s before scheduling drawing`,
	(failure) => {
		const f = fixture()
		expect(() =>
			f.mount(() => (
				<Canvas
					width={failure === `dimensions` ? -1 : 100}
					createRenderer={(options) =>
						new THREE.WebGLRenderer(
							failure === `element`
								? { canvas: document.createElement(`canvas`) }
								: options,
						)
					}
					onCreated={() => {
						if (failure === `setup`) throw new Error(`setup failed`)
					}}
				/>
			)),
		).toThrow()
		expect(renderers[0].dispose).toHaveBeenCalledOnce()
		expect(f.clock.scheduleFrame).not.toHaveBeenCalled()
	},
)

it(`reports native resize failures and releases all work, with a safe device ratio fallback`, () => {
	const f = fixture()
	let failing = false
	f.mount(() => (
		<Canvas
			onResize={() => {
				if (failing) throw new Error(`resize failed`)
			}}
		/>
	))
	Object.defineProperty(window, `devicePixelRatio`, {
		value: 0,
		configurable: true,
	})
	window.dispatchEvent(new Event(`resize`))
	expect(renderers[0].setPixelRatio).toHaveBeenLastCalledWith(1)
	failing = true
	window.dispatchEvent(new Event(`resize`))
	expect(f.onError).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ message: `resize failed` }),
	)
	expect(renderers[0].dispose).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
	window.dispatchEvent(new Event(`resize`))
	expect(f.onError).toHaveBeenCalledOnce()
})
