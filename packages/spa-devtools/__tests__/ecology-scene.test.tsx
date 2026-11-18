/** @jsxImportSource @atom.io/spa */
import { render, useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import { ecologyColor } from "../src/ecology-color.ts"
import {
	createGraphContext,
	type FamilyConnection,
	type GraphItem,
} from "../src/ecology-graph.ts"
import type { EcologyLine } from "../src/ecology-lines.ts"
import {
	createEdgeBuffer,
	createFamilyBuffer,
	writeEdgeBuffer,
	writeFamilyBuffer,
} from "../src/ecology-lines.ts"
import { EcologyScene } from "../src/EcologyScene.tsx"
import { useTools } from "../src/store.ts"

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
const item = (id: string, x: number, y: number, z: number): GraphItem => {
	const source: GraphItem[`source`] = {
		key: id,
		kind: `atom`,
		type: `atom`,
		family: null,
		value: { status: `cached`, type: `number` },
		dependencies: `not-applicable`,
		dependenciesTruncated: false,
	}
	return {
		id: `state:${id}`,
		key: id,
		label: id,
		kind: `atom`,
		detail: `atom · cached number`,
		color: ecologyColor(source),
		x,
		y,
		z,
		source,
	}
}
interface SceneState {
	cylinderHeight: number
	selected?: string | undefined
	selectedIds?: ReadonlySet<string> | undefined
	traced: Set<string>
	items: GraphItem[]
	edges: EcologyLine[]
	familyConnections?: FamilyConnection[]
	command: { sequence: number; action: string; target: string }
}
function fixture(restored = false, empty = false) {
	const silo = new Silo({
		name: `scene-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const context = createGraphContext()
	if (restored) context.camera = { position: [20, 10, 30], target: [1, 2, 3] }
	const a = item(`a`, 8, 4, 0),
		b = item(`b`, -8, -4, 0)
	const sceneStateAtom = silo.atom<SceneState>({
		key: `sceneState`,
		default: {
			cylinderHeight: 8,
			traced: new Set(),
			items: empty ? [] : [a, b],
			edges: [{ from: a, to: b, color: a.color, traced: false }],
			command: { sequence: 0, action: `fit`, target: `` },
		},
	})
	let tick: (time: number) => void = () => {},
		resize!: ResizeObserverCallback
	const disconnect = vi.fn(),
		stop = vi.fn()
	vi.stubGlobal(
		`ResizeObserver`,
		class {
			public constructor(callback: ResizeObserverCallback) {
				resize = callback
			}
			public observe() {}
			public disconnect = disconnect
		},
	)
	const host = document.createElement(`main`)
	document.body.append(host)
	const root = render(
		() => {
			const get = useGetter(sceneStateAtom),
				tools = useTools(silo.store)
			return (
				<EcologyScene
					tools={tools}
					context={context}
					cylinderHeight={get().cylinderHeight}
					slots={get().items.length}
					generation={0}
					card={(index) => get().items[index] ?? (index === 0 ? a : b)}
					visible={() => true}
					items={get().items}
					edges={get().edges}
					familyConnections={get().familyConnections}
					traced={get().traced}
					selected={get().selected}
					selectedIds={get().selectedIds}
					command={get().command}
				/>
			)
		},
		host,
		{
			store: silo.store,
			capabilities: [
				{
					namespace: `clock`,
					scheduleFrame(run) {
						tick = run
						return stop
					},
					attach() {
						return { update() {}, dispose() {} }
					},
				},
			],
		},
	)
	cleanups.push(root.dispose)
	const viewport = host.querySelector<HTMLElement>(`ecology-scene`)!
	const bounds = vi
		.spyOn(viewport, `getBoundingClientRect`)
		.mockReturnValue(new DOMRect(0, 0, 800, 500))
	const patch = (value: Partial<SceneState>) => {
		silo.setState(sceneStateAtom, (previous) => ({ ...previous, ...value }))
		root.flush()
	}
	let sequence = 0
	return {
		root,
		context,
		viewport,
		disconnect,
		stop,
		a,
		b,
		tick: () => {
			tick(16)
		},
		resize: (width = 800, height = 500) => {
			bounds.mockReturnValue(new DOMRect(0, 0, width, height))
			resize([], {} as ResizeObserver)
			root.flush()
		},
		patch,
		point: (value: GraphItem) => {
			const [diameter, height] =
				viewport.dataset[`cylinder`]!.split(`,`).map(Number)
			return [
				(value.x * diameter) / 16,
				(value.y * height) / silo.getState(sceneStateAtom).cylinderHeight,
				(value.z * diameter) / 16,
			]
		},
		command: (action: string, target = ``) => {
			patch({ command: { sequence: ++sequence, action, target } })
		},
	}
}

it(`projects viewer-facing DOM cards and batched edges, keeps a camera through resize and releases scene work`, () => {
	const f = fixture()
	f.resize()
	f.tick()
	const card = f.viewport.querySelector<HTMLElement>(`ecology-node-card`)!
	expect(card.style.getPropertyValue(`--ecology-color`)).toBe(f.a.color)
	expect(card.style.transform).toContain(`translate`)
	expect(card.style.transform).not.toMatch(/rotate\((?!0rad)|matrix3d/)
	expect(f.viewport.dataset[`edges`]).toBe(`1`)
	f.patch({
		familyConnections: [
			{ family: `items`, from: f.a, to: f.b, color: f.a.color },
		],
	})
	f.tick()
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const spine = vi
		.mocked(gl.render)
		.mock.lastCall![0].getObjectByName(
			`family-connections`,
		) as THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>
	expect(spine.geometry.drawRange.count).toBe(2)
	expect(spine.material.opacity).toBeLessThan(0.14)
	expect(spine.renderOrder).toBeLessThan(0)
	expect(f.viewport.dataset[`familyConnections`]).toBe(`1`)
	const disposeGeometry = vi.spyOn(spine.geometry, `dispose`),
		disposeMaterial = vi.spyOn(spine.material, `dispose`)
	const first = f.context.camera!
	f.command(`right`)
	expect(f.context.camera).not.toEqual(first)
	for (const action of [
		`left`,
		`up`,
		`down`,
		`in`,
		`out`,
		`reset`,
		`fit`,
		`unknown`,
		`focus`,
	])
		f.command(action)
	f.command(`focus`, `state:b`)
	expect(f.context.camera!.target).toEqual(
		f.point(f.b).map((value) => expect.closeTo(value, 10)),
	)
	expect(f.context.camera!.position.every(Number.isFinite)).toBe(true)
	f.patch({ edges: [{ from: f.a, to: f.b, color: f.a.color, traced: true }] })
	f.tick()
	f.tick()
	f.resize()
	f.tick()
	const pointer = new PointerEvent(`pointerdown`, { bubbles: true })
	const event = vi.fn()
	f.viewport.addEventListener(`pointerdown`, event)
	card.querySelector(`button`)!.dispatchEvent(pointer)
	expect(event).not.toHaveBeenCalled()
	const starts = vi.mocked(THREE.WebGLRenderer).mock.calls.length
	f.patch({ items: [], edges: [], familyConnections: [] })
	f.command(`fit`)
	f.tick()
	expect(spine.geometry.drawRange.count).toBe(0)
	expect(f.viewport.querySelector(`canvas`)).not.toBeNull()
	expect(vi.mocked(THREE.WebGLRenderer).mock.calls).toHaveLength(starts)
	f.patch({ items: [f.a, f.b] })
	f.tick()
	f.root.dispose()
	expect(f.disconnect).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
	expect(disposeGeometry).toHaveBeenCalledOnce()
	expect(disposeMaterial).toHaveBeenCalledOnce()
})

it(`writes arrowless family spines with shared colors, world scaling and reusable bounded buffers`, () => {
	const geometry = createFamilyBuffer(),
		positions = geometry.getAttribute(`position`) as THREE.BufferAttribute,
		colors = geometry.getAttribute(`color`),
		from = item(`from`, -8, 2, 4),
		to = item(`to`, 8, 2, -4),
		scale = new THREE.Vector3(2, 3, 4)
	expect(positions.count).toBe(1_000)
	const connections = [{ family: `items`, from, to, color: from.color }]
	writeFamilyBuffer(geometry, connections, scale)
	expect(geometry.drawRange.count).toBe(2)
	const color = new THREE.Color(from.color)
	for (const [index, point] of [from, to].entries()) {
		expect([
			positions.getX(index),
			positions.getY(index),
			positions.getZ(index),
		]).toEqual([point.x * 2, point.y * 3, point.z * 4])
		expect([colors.getX(index), colors.getY(index), colors.getZ(index)]).toEqual(
			[
				expect.closeTo(color.r, 6),
				expect.closeTo(color.g, 6),
				expect.closeTo(color.b, 6),
			],
		)
	}
	writeFamilyBuffer(geometry, [], scale)
	expect(geometry.drawRange.count).toBe(0)
	expect(positions.updateRanges).toEqual([])
	writeFamilyBuffer(geometry, connections, scale)
	expect(geometry.getAttribute(`position`)).toBe(positions)
	expect(geometry.getAttribute(`color`)).toBe(colors)
	expect(positions.updateRanges).toEqual([{ start: 0, count: 6 }])
	geometry.dispose()
})

it(`retains source colors on every curve and arrowhead in both line batches and updates reused card slots`, () => {
	const f = fixture()
	f.resize()
	f.tick()
	const card = f.viewport.querySelector<HTMLElement>(`ecology-node-card`)!
	f.patch({ items: [f.b, f.a] })
	expect(f.viewport.querySelector(`ecology-node-card`)).toBe(card)
	expect(card.style.getPropertyValue(`--ecology-color`)).toBe(f.b.color)
	const geometry = createEdgeBuffer()
	const colors = geometry.getAttribute(`color`)
	const camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.1, 1000)
	camera.position.set(0, 0, 40)
	camera.updateMatrixWorld()
	const edges = [
		{ from: f.a, to: f.b, color: f.a.color, traced: false },
		{ from: f.b, to: f.a, color: f.b.color, traced: false },
		{ from: f.a, to: f.b, color: f.a.color, traced: true },
	]
	for (const traced of [false, true]) {
		writeEdgeBuffer(geometry, edges, traced, camera, 800, 500)
		expect(geometry.getAttribute(`color`)).toBe(colors)
		const painted = edges.filter((edge) => edge.traced === traced)
		expect(geometry.drawRange.count).toBe(painted.length * 36)
		for (const [index, edge] of painted.entries()) {
			const expected = new THREE.Color(edge.color)
			for (let vertex = 0; vertex < 36; vertex++) {
				const offset = index * 36 + vertex
				expect(colors.getX(offset)).toBeCloseTo(expected.r, 6)
				expect(colors.getY(offset)).toBeCloseTo(expected.g, 6)
				expect(colors.getZ(offset)).toBeCloseTo(expected.b, 6)
			}
		}
	}
	geometry.dispose()
})
it(`restores a borrowed camera and fits a large capture into viewport-shaped cylinder dimensions`, () => {
	const restored = fixture(true)
	expect(restored.context.camera!.target).toEqual([1, 2, 3])
	restored.tick()
	const empty = fixture(false, true)
	empty.tick()
	empty.patch({
		cylinderHeight: 20_000,
		items: [item(`top`, 8, 10_000, 0), item(`bottom`, -8, -10_000, 0)],
	})
	empty.tick()
	expect(empty.context.camera!.target).toEqual([0, 0, 0])
	const distance = (camera: NonNullable<typeof empty.context.camera>) =>
		Math.hypot(...camera.position.map((n, i) => n - camera.target[i]))
	expect(distance(empty.context.camera!)).toBeLessThanOrEqual(90.00001)
	empty.command(`fit`)
	expect(distance(empty.context.camera!)).toBeLessThan(90)
	empty.command(`focus`, `state:top`)
	expect(distance(empty.context.camera!)).toBeLessThanOrEqual(45.00001)
})
it(`applies a queued focus when the first populated capture starts the camera`, () => {
	const f = fixture(false, true)
	f.command(`focus`, `state:b`)
	f.patch({ items: [f.a, f.b] })
	f.tick()
	expect(f.context.camera!.target).toEqual(
		f.point(f.b).map((value) => expect.closeTo(value, 10)),
	)
})
it(`keeps a readable initial view for a very long family tangent and fits the full expansion on request`, () => {
	const f = fixture(false, true),
		a = item(`far`, 10_000, 0, 8),
		b = item(`other`, -10_000, 0, 8)
	f.patch({ items: [a, b] })
	f.tick()
	expect(f.context.camera!.target).toEqual(
		f.point(a).map((value) => expect.closeTo(value, 10)),
	)
	const distance = () =>
		new THREE.Vector3(...f.context.camera!.position).distanceTo(
			new THREE.Vector3(...f.context.camera!.target),
		)
	expect(distance()).toBeCloseTo(90)
	f.command(`fit`)
	expect(distance()).toBeGreaterThan(10_000)
})
it(`reshapes on canvas resize while preserving orbit direction and relative zoom`, () => {
	const f = fixture()
	f.resize(1200, 400)
	f.command(`focus`, `state:b`)
	f.command(`in`)
	const before = f.context.camera!,
		point = f.point(f.b)
	expect(before.target).toEqual(point.map((value) => expect.closeTo(value, 10)))
	const offset = new THREE.Vector3(...before.position).sub(
		new THREE.Vector3(...before.target),
	)
	f.resize(300, 900)
	f.tick()
	const [diameter, height] =
		f.viewport.dataset[`cylinder`]!.split(`,`).map(Number)
	expect(diameter / height).toBeCloseTo(300 / 900)
	expect(f.context.camera!.target).toEqual(
		f.point(f.b).map((value) => expect.closeTo(value, 10)),
	)
	const after = new THREE.Vector3(...f.context.camera!.position).sub(
		new THREE.Vector3(...f.context.camera!.target),
	)
	expect(
		after.clone().normalize().distanceTo(offset.clone().normalize()),
	).toBeCloseTo(0)
	expect(after.length() / offset.length()).toBeCloseTo(3)
})
it(`stacks selected and connected cards above nearer unrelated cards and restores distance ordering when cleared`, () => {
	const f = fixture()
	f.tick()
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const scene = vi.mocked(gl.render).mock.lastCall![0]
	const lines = scene.children as THREE.LineSegments<
		THREE.BufferGeometry,
		THREE.LineBasicMaterial
	>[]
	expect(lines[1].renderOrder).toBeGreaterThan(lines[0].renderOrder)
	expect(lines[1].material.depthTest).toBe(false)
	const cards = [
		...f.viewport.querySelectorAll<HTMLElement>(`ecology-node-card`),
	]
	const before = cards.map((card) => card.style.zIndex)
	f.patch({ selected: `state:b`, traced: new Set([`b`]) })
	f.tick()
	expect(Number(cards[1].style.zIndex)).toBeGreaterThan(
		Number(cards[0].style.zIndex),
	)
	f.patch({ selected: `state:a`, traced: new Set([`a`, `b`]) })
	f.tick()
	expect(Number(cards[0].style.zIndex)).toBeGreaterThan(
		Number(cards[1].style.zIndex),
	)
	f.patch({ selectedIds: new Set([`state:a`, `state:b`]) })
	f.tick()
	expect(
		cards.every(
			(card) =>
				card.querySelector(`button`)!.getAttribute(`aria-pressed`) === `true`,
		),
	).toBe(true)
	f.patch({ selected: undefined, selectedIds: new Set(), traced: new Set() })
	f.tick()
	expect(cards.map((card) => card.style.zIndex)).toEqual(before)
})
it(`keeps the list fallback local when WebGL creation fails`, () => {
	vi.mocked(THREE.WebGLRenderer).mockImplementationOnce(function () {
		throw new Error(`unavailable`)
	})
	const f = fixture()
	f.root.flush()
	expect(f.viewport.dataset[`unavailable`]).toBe(`true`)
	expect(f.viewport.textContent).toContain(`ecology editor`)
	expect(f.viewport.querySelector(`canvas`)).toBeNull()
})
it(`places arrowheads outside billboard bounds in 3D, retaining parallel edges and loops without reallocating buffers`, () => {
	const geometry = createEdgeBuffer(),
		attribute = geometry.getAttribute(`position`)
	const camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.1, 1000)
	camera.position.set(0, 0, 40)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	const from = { x: -8, y: 0, z: 0 },
		to = { x: 8, y: 0, z: 0 }
	const color = `hsl(30, 75%, 40%)`
	writeEdgeBuffer(
		geometry,
		[
			{ from, to, color, traced: false },
			{ from, to, color, traced: false },
			{ from, to: from, color, traced: false },
			{ from, to, color, traced: true },
		],
		false,
		camera,
		800,
		500,
	)
	expect(geometry.getAttribute(`position`)).toBe(attribute)
	expect(geometry.drawRange.count).toBe(108)
	expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
	const end = new THREE.Vector3()
		.fromBufferAttribute(attribute, 31)
		.project(camera)
	const target = new THREE.Vector3(to.x, to.y, to.z).project(camera)
	expect((target.x - end.x) * 400).toBeCloseTo(91, 3)
	writeEdgeBuffer(
		geometry,
		[{ from, to: { x: 5, y: 16, z: 3 }, color, traced: false }],
		false,
		camera,
		800,
		500,
	)
	expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
	writeEdgeBuffer(geometry, [], false, camera, 800, 500)
	expect(geometry.drawRange.count).toBe(0)
	writeEdgeBuffer(
		geometry,
		[{ from, to, color, traced: true }],
		true,
		camera,
		800,
		500,
	)
	expect(geometry.drawRange.count).toBe(36)
	const scale = new THREE.Vector3(2, 0.5, 2)
	writeEdgeBuffer(
		geometry,
		[{ from, to, color, traced: true }],
		true,
		camera,
		800,
		500,
		scale,
	)
	const scaledEnd = new THREE.Vector3()
		.fromBufferAttribute(attribute, 31)
		.project(camera)
	const scaledTarget = new THREE.Vector3(to.x, to.y, to.z)
		.multiply(scale)
		.project(camera)
	expect((scaledTarget.x - scaledEnd.x) * 400).toBeCloseTo(91, 3)
	geometry.dispose()
})

it(`fans clustered edges across the visible card ports and retains intra-cluster loops`, () => {
	const geometry = createEdgeBuffer()
	const camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.1, 1000)
	camera.position.set(0, 0, 40)
	camera.lookAt(0, 0, 0)
	camera.updateMatrixWorld()
	const fromCard = { x: -8, y: 0, z: 0 },
		toCard = { x: 8, y: 0, z: 0 }
	const edges: EcologyLine[] = Array.from({ length: 16 }, (_, index) => ({
		from: {
			x: -8 + (index % 3) * 0.1,
			y: (index - 7.5) * 0.025,
			z: index * 0.01,
		},
		to: { x: 8, y: (7.5 - index) * 0.02, z: 0 },
		fromCard,
		toCard,
		color: `hsl(30, 75%, 40%)`,
		traced: false,
	}))
	writeEdgeBuffer(geometry, edges, false, camera, 800, 500)
	const attribute = geometry.getAttribute(`position`)
	const startYs = new Set<string>(),
		endYs = new Set<string>()
	for (let edge = 0; edge < edges.length; edge++) {
		const start = new THREE.Vector3()
			.fromBufferAttribute(attribute, edge * 36)
			.project(camera)
		const end = new THREE.Vector3()
			.fromBufferAttribute(attribute, edge * 36 + 31)
			.project(camera)
		const a = new THREE.Vector3(fromCard.x, 0, 0).project(camera)
		const b = new THREE.Vector3(toCard.x, 0, 0).project(camera)
		expect((start.x - a.x) * 400).toBeCloseTo(91, 3)
		expect((b.x - end.x) * 400).toBeCloseTo(91, 3)
		expect(Math.abs(start.y * 250)).toBeLessThanOrEqual(23)
		expect(Math.abs(end.y * 250)).toBeLessThanOrEqual(23)
		startYs.add(start.y.toFixed(5))
		endYs.add(end.y.toFixed(5))
	}
	expect(startYs.size).toBe(16)
	expect(endYs.size).toBe(16)
	writeEdgeBuffer(
		geometry,
		[
			{
				from: { x: -8, y: 0.2, z: 0 },
				to: { x: -8, y: -0.2, z: 0 },
				fromCard,
				toCard: fromCard,
				color: `hsl(30, 75%, 40%)`,
				traced: false,
			},
		],
		false,
		camera,
		800,
		500,
	)
	expect(geometry.drawRange.count).toBe(36)
	expect(
		Array.from(
			{ length: 36 },
			(_, index) =>
				new THREE.Vector3().fromBufferAttribute(attribute, index).project(camera)
					.y * 250,
		).some((y) => y > 29),
	).toBe(true)
	geometry.dispose()
})

it(`clips filtered connections to their compact card bounds`, () => {
	const geometry = createEdgeBuffer(),
		camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.1, 1000)
	camera.position.set(0, 0, 40)
	camera.updateMatrixWorld()
	const from = { x: -8, y: 0, z: 0 },
		to = { x: 8, y: 0, z: 0 }
	writeEdgeBuffer(
		geometry,
		[
			{
				from,
				to,
				color: `red`,
				traced: false,
				fromCollapsed: true,
				toCollapsed: true,
			},
		],
		false,
		camera,
		800,
		500,
	)
	const attribute = geometry.getAttribute(`position`)
	const start = new THREE.Vector3()
		.fromBufferAttribute(attribute, 0)
		.project(camera)
	const end = new THREE.Vector3()
		.fromBufferAttribute(attribute, 31)
		.project(camera)
	expect(
		(start.x - new THREE.Vector3(-8, 0, 0).project(camera).x) * 400,
	).toBeCloseTo(43, 3)
	expect(
		(new THREE.Vector3(8, 0, 0).project(camera).x - end.x) * 400,
	).toBeCloseTo(43, 3)
	geometry.dispose()
})
