import { useValue } from "@atom.io/spa"
import { Silo } from "atom.io"
import * as THREE from "three"
import { expect, it, vi } from "vitest"

import {
	BoxGeometry,
	Mesh,
	MeshStandardMaterial,
	threeRenderer,
} from "../src/three.ts"

it(`updates transforms and colors, attaches resources, and disposes owned resources`, () => {
	const silo = new Silo({
		name: `three-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const colorAtom = silo.atom<string>({ key: `color`, default: `red` })
	let mesh!: THREE.Mesh
	let geometry!: THREE.BoxGeometry
	let material!: THREE.MeshStandardMaterial
	function App() {
		const read = useValue(colorAtom)
		return (
			<Mesh
				position={[1, 2, 3]}
				ref={(node) => {
					if (node) mesh = node
				}}
			>
				<BoxGeometry
					args={[2, 2, 2]}
					ref={(node) => {
						if (node) geometry = node
					}}
				/>
				<MeshStandardMaterial
					color={read()}
					ref={(node) => {
						if (node) material = node
					}}
				/>
			</Mesh>
		)
	}
	const scene = new THREE.Scene()
	const root = threeRenderer.render(() => <App />, scene, { store: silo.store })
	expect(mesh.geometry).toBe(geometry)
	expect(mesh.material).toBe(material)
	expect(mesh.position.toArray()).toEqual([1, 2, 3])
	const disposeGeometry = vi.spyOn(geometry, `dispose`)
	const disposeMaterial = vi.spyOn(material, `dispose`)
	silo.setState(colorAtom, `blue`)
	root.flush()
	expect(material.color.getHexString()).toBe(`0000ff`)
	root.dispose()
	expect(scene.children).toHaveLength(0)
	expect(disposeGeometry).toHaveBeenCalledTimes(1)
	expect(disposeMaterial).toHaveBeenCalledTimes(1)
})

it(`replaces keyed resources and rejects constructor changes without a new key`, () => {
	const silo = new Silo({
		name: `three-args`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const sizeAtom = silo.atom<number>({ key: `size`, default: 1 })
	const scene = new THREE.Scene()
	const geometries: THREE.BoxGeometry[] = []
	function App() {
		const size = useValue(sizeAtom)
		return (
			<Mesh>
				{[size()].map((width) => (
					<BoxGeometry
						key={width}
						args={[width, 1, 1]}
						ref={(node) => {
							if (node) geometries.push(node)
						}}
					/>
				))}
			</Mesh>
		)
	}
	const root = threeRenderer.render(() => <App />, scene, { store: silo.store })
	const dispose = vi.spyOn(geometries[0], `dispose`)
	silo.setState(sizeAtom, 2)
	root.flush()
	expect(dispose).toHaveBeenCalledTimes(1)
	expect(geometries).toHaveLength(2)
	expect(geometries[1].parameters.width).toBe(2)
	root.dispose()
	function Fixed() {
		const size = useValue(sizeAtom)
		return (
			<Mesh>
				<BoxGeometry args={[size(), 1, 1]} />
			</Mesh>
		)
	}
	const fixed = threeRenderer.render(() => <Fixed />, scene, {
		store: silo.store,
	})
	silo.setState(sizeAtom, 3)
	expect(() => {
		fixed.flush()
	}).toThrow(`change the component key`)
	expect(scene.children).toHaveLength(0)
})

it(`routes raycast events through JSX handlers and motion gestures, including reactive replacement`, async () => {
	const { createThreeEvents } = await import(`../src/three.ts`)
	const { motionCapability } = await import(`../src/motion.ts`)
	const silo = new Silo({
		name: `three-input`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const phaseAtom = silo.atom<number>({ key: `phase`, default: 0 })
	const first = vi.fn()
	const second = vi.fn()
	const ref = vi.fn()
	function App() {
		const phase = useValue(phaseAtom)
		return (
			<Mesh
				ref={ref}
				motion:animate={{ scale: 1 }}
				motion:whileHover={{ scale: 1.2 }}
				motion:whileTap={{ scale: 0.8 }}
				{...(phase() === 2
					? {}
					: { onPointerDown: phase() === 0 ? first : second })}
			>
				<BoxGeometry />
				<MeshStandardMaterial />
			</Mesh>
		)
	}
	const scene = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
	camera.position.z = 5
	const canvas = document.createElement(`canvas`)
	vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue({
		left: 0,
		right: 100,
		top: 0,
		bottom: 100,
		width: 100,
		height: 100,
	} as DOMRect)
	const root = threeRenderer.render(() => <App />, scene, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `always` })],
	})
	const events = createThreeEvents(canvas, scene, () => camera)
	try {
		const mesh = ref.mock.calls[0][0] as THREE.Mesh
		const send = (type: string) =>
			canvas.dispatchEvent(
				new PointerEvent(type, { clientX: 50, clientY: 50, pointerId: 1 }),
			)
		send(`pointermove`)
		expect(mesh.scale.x).toBe(1.2)
		send(`pointerdown`)
		expect(mesh.scale.x).toBe(0.8)
		expect(first).toHaveBeenCalledOnce()
		send(`pointerup`)
		expect(mesh.scale.x).toBe(1.2)
		silo.setState(phaseAtom, 1)
		root.flush()
		send(`pointerdown`)
		expect(second).toHaveBeenCalledOnce()
		silo.setState(phaseAtom, 2)
		root.flush()
		send(`pointerdown`)
		expect(second).toHaveBeenCalledOnce()
		send(`pointercancel`)
		expect(mesh.scale.x).toBe(1)
	} finally {
		root.dispose()
		events.dispose()
	}
})
