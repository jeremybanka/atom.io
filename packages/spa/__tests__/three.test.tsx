import { useGetter } from "@atom.io/spa"
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
		const getColor = useGetter(colorAtom)
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
					color={getColor()}
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
		const getSize = useGetter(sizeAtom)
		return (
			<Mesh>
				{[getSize()].map((width) => (
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
		const getSize = useGetter(sizeAtom)
		return (
			<Mesh>
				<BoxGeometry args={[getSize(), 1, 1]} />
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
		const getPhase = useGetter(phaseAtom)
		return (
			<Mesh
				ref={ref}
				motion:animate={{ scale: 1 }}
				motion:whileHover={{ scale: 1.2 }}
				motion:whileTap={{ scale: 0.8 }}
				{...(getPhase() === 2
					? {}
					: { onPointerDown: getPhase() === 0 ? first : second })}
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

it(`preserves borrowed Mesh resources across scene attachment, overrides, disposal, and reuse`, () => {
	const geometry = new THREE.BoxGeometry()
	const material = new THREE.MeshBasicMaterial()
	const parent = new THREE.Mesh<
		THREE.BufferGeometry,
		THREE.Material | THREE.Material[]
	>(geometry, [material])
	const geometryDispose = vi.spyOn(geometry, `dispose`)
	const materialDispose = vi.spyOn(material, `dispose`)
	const originalMaterials = parent.material
	const group = threeRenderer.render(() => <Mesh />, parent)
	expect(parent.geometry).toBe(geometry)
	expect(parent.material).toBe(originalMaterials)
	group.dispose()
	expect(parent.geometry).toBe(geometry)
	expect(parent.material).toBe(originalMaterials)
	const overridden = threeRenderer.render(
		() => (
			<>
				<BoxGeometry />
				<MeshStandardMaterial />
			</>
		),
		parent,
	)
	const ownedGeometry = parent.geometry
	const ownedMaterial = parent.material as THREE.Material
	const ownedGeometryDispose = vi.spyOn(ownedGeometry, `dispose`)
	const ownedMaterialDispose = vi.spyOn(ownedMaterial, `dispose`)
	expect(ownedGeometry).not.toBe(geometry)
	expect(ownedMaterial).not.toBe(originalMaterials)
	overridden.dispose()
	expect(parent.geometry).toBe(geometry)
	expect(parent.material).toBe(originalMaterials)
	expect(ownedGeometryDispose).toHaveBeenCalledOnce()
	expect(ownedMaterialDispose).toHaveBeenCalledOnce()
	expect(geometryDispose).not.toHaveBeenCalled()
	expect(materialDispose).not.toHaveBeenCalled()
	const nextGeometry = new THREE.BoxGeometry(2, 2, 2)
	const nextMaterial = new THREE.MeshBasicMaterial()
	parent.geometry = nextGeometry
	parent.material = nextMaterial
	const reused = threeRenderer.render(() => <BoxGeometry />, parent)
	expect(parent.material).toBe(nextMaterial)
	reused.dispose()
	expect(parent.geometry).toBe(nextGeometry)
	expect(parent.material).toBe(nextMaterial)
	const empty = threeRenderer.render(() => null, parent)
	empty.dispose()
	geometry.dispose()
	material.dispose()
	nextGeometry.dispose()
	nextMaterial.dispose()
})

it(`restores all three scale axes when a scalar motion binding is removed or disposed`, async () => {
	const { motionCapability } = await import(`../src/motion.ts`)
	const silo = new Silo({
		name: `scale-baseline`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const enabledAtom = silo.atom<boolean>({ key: `enabled`, default: false })
	const initialScale: readonly [number, number, number] = [2, 3, 4]
	const ref = vi.fn()
	function App() {
		const getEnabled = useGetter(enabledAtom)
		return (
			<Mesh
				ref={ref}
				scale={initialScale}
				{...(getEnabled() ? { "motion:animate": { scale: 1 } } : {})}
			/>
		)
	}
	const parent = new THREE.Scene()
	const root = threeRenderer.render(() => <App />, parent, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `always` })],
	})
	const mesh = ref.mock.calls[0][0] as THREE.Mesh
	expect(mesh.scale.toArray()).toEqual([2, 3, 4])
	silo.setState(enabledAtom, true)
	root.flush()
	expect(mesh.scale.toArray()).toEqual([1, 1, 1])
	silo.setState(enabledAtom, false)
	root.flush()
	expect(mesh.scale.toArray()).toEqual([2, 3, 4])
	silo.setState(enabledAtom, true)
	root.flush()
	root.dispose()
	expect(mesh.scale.toArray()).toEqual([2, 3, 4])
})

it.each([`direct`, `fragment`, `bundle`])(
	`retains outgoing Mesh resources without occupying active slots (%s)`,
	async (variant) => {
		const bundle = variant === `bundle`
		const { motionCapability } = await import(`../src/motion.ts`)
		const silo = new Silo({
			name: `resource-presence`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const keyAtom = silo.atom<number | null>({ key: `key`, default: 1 })
		const materials: THREE.MeshStandardMaterial[] = []
		const geometries: THREE.BoxGeometry[] = []
		const material = (key = 0) => (
			<MeshStandardMaterial
				key={key}
				transparent
				opacity={1}
				motion:exit={{ opacity: 0 }}
				motion:transition={{ duration: 0.12 }}
				ref={(node) => {
					if (node) materials.push(node)
				}}
			/>
		)
		function Resources() {
			return (
				<>
					{bundle && (
						<BoxGeometry
							ref={(node) => {
								if (node) geometries.push(node)
							}}
						/>
					)}
					{material()}
				</>
			)
		}
		function App() {
			const getKey = useGetter(keyAtom)
			return (
				<>
					{getKey() !== null &&
						(variant === `direct` ? (
							material(getKey()!)
						) : (
							<Resources key={getKey()} />
						))}
				</>
			)
		}
		const baselineGeometry = new THREE.BoxGeometry()
		const baselineMaterials = [new THREE.MeshBasicMaterial()]
		const mesh = new THREE.Mesh<
			THREE.BufferGeometry,
			THREE.Material | THREE.Material[]
		>(baselineGeometry, baselineMaterials)
		const root = threeRenderer.render(() => <App />, mesh, {
			store: silo.store,
			capabilities: [motionCapability({ reducedMotion: `never` })],
		})
		try {
			const first = materials[0]
			const disposeFirst = vi.spyOn(first, `dispose`)
			const disposeGeometry = bundle
				? vi.spyOn(geometries[0], `dispose`)
				: undefined
			silo.setState(keyAtom, 2)
			root.flush()
			expect(mesh.material).toBe(materials[1])
			expect(disposeFirst).not.toHaveBeenCalled()
			if (bundle) expect(mesh.geometry).toBe(geometries[1])
			// Reviving a retained key restores its attachment and cancels disposal.
			silo.setState(keyAtom, 1)
			root.flush()
			expect(mesh.material).toBe(first)
			expect(materials).toHaveLength(2)
			await new Promise((resolve) => setTimeout(resolve, 250))
			expect(disposeFirst).not.toHaveBeenCalled()
			if (bundle) expect(disposeGeometry).not.toHaveBeenCalled()
			// With no incoming resource, the current resource stays attached to fade.
			silo.setState(keyAtom, null)
			root.flush()
			expect(mesh.material).toBe(first)
			await new Promise((resolve) => setTimeout(resolve, 250))
			expect(disposeFirst).toHaveBeenCalledOnce()
			if (bundle) expect(disposeGeometry).toHaveBeenCalledOnce()
			expect(mesh.geometry).toBe(baselineGeometry)
			expect(mesh.material).toBe(baselineMaterials)
		} finally {
			root.dispose()
			baselineGeometry.dispose()
			baselineMaterials[0].dispose()
		}
	},
)

it(`borrows custom Mesh constructor resources and restores them after owned JSX attachments`, () => {
	const geometry = new THREE.ExtrudeGeometry(new THREE.Shape(), {
		depth: 0.3,
		bevelEnabled: false,
	})
	const material = new THREE.MeshStandardMaterial()
	const disposeGeometry = vi.spyOn(geometry, `dispose`)
	const disposeMaterial = vi.spyOn(material, `dispose`)
	for (const materials of [material, [material]]) {
		const scene = new THREE.Scene()
		const root = threeRenderer.render(
			() => <Mesh args={[geometry, materials]} />,
			scene,
		)
		const mesh = scene.children[0] as THREE.Mesh
		expect(mesh.geometry).toBe(geometry)
		expect(mesh.material).toBe(materials)
		root.dispose()
		expect(scene.children).toHaveLength(0)
		expect(disposeGeometry).not.toHaveBeenCalled()
		expect(disposeMaterial).not.toHaveBeenCalled()
	}
	const scene = new THREE.Scene()
	const root = threeRenderer.render(
		() => (
			<Mesh args={[geometry, [material]]}>
				<BoxGeometry />
				<MeshStandardMaterial />
			</Mesh>
		),
		scene,
	)
	const mesh = scene.children[0] as THREE.Mesh
	const ownedGeometry = vi.spyOn(mesh.geometry, `dispose`)
	const ownedMaterial = vi.spyOn(mesh.material as THREE.Material, `dispose`)
	root.dispose()
	expect(ownedGeometry).toHaveBeenCalledOnce()
	expect(ownedMaterial).toHaveBeenCalledOnce()
	expect(disposeGeometry).not.toHaveBeenCalled()
	expect(disposeMaterial).not.toHaveBeenCalled()
	geometry.dispose()
	material.dispose()
})
