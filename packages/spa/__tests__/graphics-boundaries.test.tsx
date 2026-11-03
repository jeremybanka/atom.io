import { Silo } from "atom.io"
import Konva from "konva"
import type * as Three from "three"
import * as THREE from "three"
import { expect, it, vi } from "vitest"

import { render, useValue } from "../src/index.ts"
import { jsx } from "../src/jsx-runtime.ts"
import { konvaRenderer, Layer, Rect, Stage } from "../src/konva.ts"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshNormalMaterial,
	threeRenderer,
} from "../src/three.ts"

const spies = vi.hoisted(() => ({
	render: vi.fn(),
	dispose: vi.fn(),
	size: vi.fn(),
	stage: vi.fn(),
}))
vi.mock(`three`, async (original) => {
	const actual = await original<typeof Three>()
	return {
		...actual,
		WebGLRenderer: class {
			public render = spies.render
			public dispose = spies.dispose
			public setSize = spies.size
		},
	}
})
vi.mock(`konva`, async (original) => {
	const actual = await original<{ default: typeof Konva }>()
	class NativeStage extends actual.default.Group {
		public constructor(props: Record<string, any>) {
			super(props)
			spies.stage(this)
		}
	}
	return {
		default: {
			...actual.default,
			Stage: NativeStage,
			Layer: actual.default.Group,
		},
	}
})
function clock() {
	let tick = (_time: number) => {}
	const stop = vi.fn()
	return {
		capability: {
			namespace: `clock`,
			attach: () => ({ update() {}, dispose() {} }),
			scheduleFrame(run: (time: number) => void) {
				tick = run
				return stop
			},
		},
		tick: (time: number) => {
			tick(time)
		},
		stop,
	}
}
it(`owns canvas resources, resizes the default camera, and routes frame and event failures`, () => {
	const silo = new Silo({
		name: `canvas`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const sizeAtom = silo.atom<number>({ key: `size`, default: 100 })
	const frame = clock()
	const onFrame = vi.fn()
	const host = document.createElement(`div`)
	function App() {
		const size = useValue(sizeAtom)
		return (
			<Canvas width={size()} height={50} onFrame={onFrame}>
				<Mesh>
					<BoxGeometry />
					<MeshNormalMaterial />
				</Mesh>
			</Canvas>
		)
	}
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [frame.capability],
	})
	frame.tick(100)
	frame.tick(150)
	expect(onFrame).toHaveBeenLastCalledWith(
		expect.objectContaining({ delta: 0.05, time: 0.15 }),
	)
	expect(
		(onFrame.mock.calls[0][0].camera as THREE.PerspectiveCamera).aspect,
	).toBe(2)
	silo.setState(sizeAtom, 200)
	root.flush()
	expect(spies.size).toHaveBeenLastCalledWith(200, 50)
	root.dispose()
	expect(frame.stop).toHaveBeenCalledOnce()
	expect(spies.dispose).toHaveBeenCalled()
	const other = clock()
	const camera = new THREE.PerspectiveCamera()
	camera.position.z = 5
	const errors = vi.fn()
	const second = render(
		() => (
			<Canvas camera={camera}>
				<Mesh
					onPointerDown={() => {
						throw new Error(`event failure`)
					}}
				>
					<BoxGeometry />
					<MeshNormalMaterial />
				</Mesh>
			</Canvas>
		),
		host,
		{ capabilities: [other.capability], onError: errors },
	)
	other.tick(0)
	expect(spies.render).toHaveBeenLastCalledWith(expect.any(THREE.Scene), camera)
	const canvas = host.querySelector(`canvas`)!
	vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue({
		left: 0,
		right: 100,
		top: 0,
		bottom: 100,
		width: 100,
		height: 100,
	} as DOMRect)
	canvas.dispatchEvent(
		new PointerEvent(`pointerdown`, { clientX: 50, clientY: 50, pointerId: 1 }),
	)
	expect(errors).toHaveBeenCalledWith(
		expect.objectContaining({ message: `event failure` }),
	)
	expect(host.children).toHaveLength(0)
	second.dispose()
})
it(`owns a Stage, applies reactive attributes/events, and publishes native refs`, () => {
	vi.spyOn(Konva.Util, `isCanvasFarblingActive`).mockReturnValue(false)
	const silo = new Silo({
		name: `stage`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const widthAtom = silo.atom<number>({ key: `width`, default: 100 })
	const click = vi.fn()
	const ref = vi.fn()
	const host = document.createElement(`div`)
	function App() {
		const width = useValue(widthAtom)
		return (
			<Stage width={width()} height={50} onClick={click} ref={ref}>
				<Layer>
					<Rect width={20} height={20} />
				</Layer>
			</Stage>
		)
	}
	const root = render(() => <App />, host, { store: silo.store })
	const stage = ref.mock.calls[0][0] as Konva.Stage
	expect(stage.width()).toBe(100)
	stage.fire(`click`)
	expect(click).toHaveBeenCalledOnce()
	silo.setState(widthAtom, 200)
	root.flush()
	expect(stage.width()).toBe(200)
	root.dispose()
	expect(ref).toHaveBeenLastCalledWith(null)
	const defaults = render(() => <Stage />, host)
	expect(spies.stage.mock.calls.at(-1)![0].width()).toBe(300)
	expect(spies.stage.mock.calls.at(-1)![0].height()).toBe(150)
	defaults.dispose()
})
it(`validates scene structure and native properties while restoring removed properties`, () => {
	const parent = new THREE.Scene()
	expect(() => threeRenderer.render(() => jsx(`Unknown`, {}), parent)).toThrow(
		`unknown node`,
	)
	expect(() =>
		threeRenderer.render(() => jsx(Mesh, { bad: true }), parent),
	).toThrow(`unknown property`)
	expect(() =>
		threeRenderer.render(() => jsx(Mesh, { onBad: () => {} }), parent),
	).toThrow(`unknown event`)
	expect(() =>
		threeRenderer.render(() => jsx(BoxGeometry, { onClick: () => {} }), parent),
	).toThrow(`unknown event`)
	expect(() =>
		threeRenderer.render(
			() => jsx(BoxGeometry, { children: jsx(Mesh, {}) }),
			parent,
		),
	).toThrow(`resources cannot contain children`)
	expect(() =>
		threeRenderer.render(
			() => jsx(`Group`, { children: jsx(BoxGeometry, {}) }),
			parent,
		),
	).toThrow(`require a Mesh parent`)
	for (const children of [
		[jsx(BoxGeometry, {}), jsx(BoxGeometry, {})],
		[jsx(MeshNormalMaterial, {}), jsx(MeshNormalMaterial, {})],
	])
		expect(() =>
			threeRenderer.render(() => jsx(Mesh, { children }), parent),
		).toThrow(`one geometry and one material`)
	const silo = new Silo({
		name: `three-props`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const activeAtom = silo.atom<boolean>({ key: `active`, default: true })
	let mesh!: THREE.Mesh
	function App() {
		const active = useValue(activeAtom)
		return jsx(Mesh, {
			get position() {
				return active() ? new THREE.Vector3(1, 2, 3) : undefined
			},
			get scale() {
				return active() ? 2 : undefined
			},
			get name() {
				return active() ? `box` : undefined
			},
			ref: (value: THREE.Mesh | null) => {
				if (value) mesh = value
			},
		})
	}
	const root = threeRenderer.render(() => <App />, parent, { store: silo.store })
	expect(mesh.position.toArray()).toEqual([1, 2, 3])
	expect(mesh.scale.x).toBe(2)
	expect(mesh.name).toBe(`box`)
	silo.setState(activeAtom, false)
	root.flush()
	expect(mesh.position.toArray()).toEqual([0, 0, 0])
	expect(mesh.scale.toArray()).toEqual([1, 1, 1])
	expect(mesh.name).toBe(``)
	root.dispose()
	const borrowed = new Konva.Group()
	const external = new Konva.Group()
	borrowed.add(external)
	const drawing = konvaRenderer.render(() => jsx(`Group`, {}), borrowed)
	expect(external.getParent()).toBeNull()
	drawing.dispose()
	expect(() => konvaRenderer.render(() => jsx(`Unknown`, {}), borrowed)).toThrow(
		`unknown node`,
	)
	expect(() =>
		konvaRenderer.render(
			() => jsx(Rect, { children: jsx(Layer, {}) }),
			borrowed,
		),
	).toThrow(`shapes cannot contain children`)
})

it(`supports motion and gestures on Konva nodes and stages and replaces native handlers`, async () => {
	const { motionCapability } = await import(`../src/motion.ts`)
	const capabilities = [motionCapability({ reducedMotion: `always` })]
	const host = document.createElement(`div`)
	const stageRef = vi.fn()
	const root = render(
		() => (
			<Stage
				motion:animate={{ x: 10 }}
				motion:whileHover={{ x: 20 }}
				ref={stageRef}
			/>
		),
		host,
		{ capabilities },
	)
	const stage = stageRef.mock.calls[0][0] as Konva.Stage
	expect(stage.x()).toBe(10)
	stage.fire(`pointerenter`)
	expect(stage.x()).toBe(20)
	stage.fire(`pointerleave`)
	expect(stage.x()).toBe(10)
	root.dispose()
	const parent = new Konva.Group()
	const ref = vi.fn()
	const native = konvaRenderer.render(
		() =>
			jsx(`Group`, {
				"motion:animate": { x: 10 },
				"motion:whileHover": { x: 20 },
				ref,
			}),
		parent,
		{ capabilities },
	)
	const node = ref.mock.calls[0][0] as Konva.Group
	expect(node.x()).toBe(10)
	node.fire(`pointerenter`)
	expect(node.x()).toBe(20)
	native.dispose()
	const silo = new Silo({
		name: `konva-events`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const phaseAtom = silo.atom<number>({ key: `phase`, default: 0 })
	const first = vi.fn()
	const second = vi.fn()
	function App() {
		const phase = useValue(phaseAtom)
		return (
			<>
				{[...(phase() === 1 ? [`b`, `a`] : [`a`, `b`])].map((id) =>
					jsx(`Group`, {
						key: id,
						...(phase() === 2
							? {}
							: { onClick: phase() === 0 ? first : second }),
					}),
				)}
			</>
		)
	}
	const drawing = konvaRenderer.render(() => <App />, parent, {
		store: silo.store,
	})
	const [a, b] = parent.children
	a.fire(`click`)
	expect(first).toHaveBeenCalledOnce()
	silo.setState(phaseAtom, 1)
	drawing.flush()
	expect(parent.children).toEqual([b, a])
	a.fire(`click`)
	expect(second).toHaveBeenCalledOnce()
	silo.setState(phaseAtom, 2)
	drawing.flush()
	a.fire(`click`)
	expect(second).toHaveBeenCalledOnce()
	drawing.dispose()
})
it(`animates native Three.js transforms, colors, scalar properties, and camera projection`, async () => {
	const { motionCapability } = await import(`../src/motion.ts`)
	const capabilities = [motionCapability({ reducedMotion: `always` })]
	const parent = new THREE.Scene()
	const root = threeRenderer.render(
		() =>
			jsx(`Mesh`, {
				"motion:animate": {
					position: [1, 2, 3],
					rotation: [0.1, 0.2, 0.3],
					scale: 2,
				},
				children: jsx(`MeshBasicMaterial`, {
					"motion:animate": { color: `red`, opacity: 0.5 },
				}),
			}),
		parent,
		{ capabilities },
	)
	const mesh = parent.children[0] as THREE.Mesh
	expect(mesh.position.toArray()).toEqual([1, 2, 3])
	expect(mesh.scale.x).toBe(2)
	expect((mesh.material as THREE.MeshBasicMaterial).opacity).toBe(0.5)
	root.dispose()
	expect(() =>
		threeRenderer.render(
			() => jsx(`Mesh`, { "motion:animate": { bad: 1 } }),
			parent,
			{ capabilities },
		),
	).toThrow(`unknown property`)
	const camera = threeRenderer.render(
		() => jsx(`PerspectiveCamera`, { fov: 30 }),
		parent,
	)
	expect((parent.children[0] as THREE.PerspectiveCamera).fov).toBe(30)
	camera.dispose()
	const external = new THREE.Group()
	parent.add(external)
	const silo = new Silo({
		name: `three-order`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const reverseAtom = silo.atom<boolean>({ key: `reverse`, default: false })
	function App() {
		const reverse = useValue(reverseAtom)
		return (
			<>
				{(reverse() ? [`b`, `a`] : [`a`, `b`]).map((id) =>
					jsx(`Group`, { key: id, name: id }),
				)}
			</>
		)
	}
	const ordered = threeRenderer.render(() => <App />, parent, {
		store: silo.store,
	})
	const [a, b] = parent.children
	expect(external.parent).toBeNull()
	silo.setState(reverseAtom, true)
	ordered.flush()
	expect(parent.children).toEqual([b, a])
	ordered.dispose()
	const frame = clock()
	const host = document.createElement(`div`)
	const canvasRoot = render(() => <Canvas />, host, {
		capabilities: [frame.capability],
	})
	const canvas = host.querySelector(`canvas`)!
	vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue({
		left: 0,
		right: 100,
		top: 0,
		bottom: 100,
		width: 100,
		height: 100,
	} as DOMRect)
	canvas.dispatchEvent(
		new PointerEvent(`pointermove`, { clientX: 50, clientY: 50 }),
	)
	canvasRoot.dispose()
})
