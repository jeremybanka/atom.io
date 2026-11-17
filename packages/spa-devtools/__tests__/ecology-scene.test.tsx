/** @jsxImportSource @atom.io/spa */
import { render, useGetter } from "@atom.io/spa"
import { Silo } from "atom.io"
import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import { createGraphContext, type GraphItem } from "../src/ecology-graph.ts"
import type { EcologyLine } from "../src/ecology-lines.ts"
import { createEdgeBuffer, writeEdgeBuffer } from "../src/ecology-lines.ts"
import { EcologyScene } from "../src/EcologyScene.tsx"
import { useTools } from "../src/store.ts"

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	document.body.replaceChildren()
	vi.restoreAllMocks()
	vi.unstubAllGlobals()
})
const item = (id: string, x: number, y: number, z: number): GraphItem => ({
	id: `state:${id}`,
	key: id,
	label: id,
	kind: `atom`,
	detail: `atom · cached number`,
	x,
	y,
	z,
	source: {
		key: id,
		kind: `atom`,
		type: `atom`,
		family: null,
		value: { status: `cached`, type: `number` },
		dependencies: `not-applicable`,
		dependenciesTruncated: false,
	},
})
interface SceneState {
	items: GraphItem[]
	edges: EcologyLine[]
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
			items: empty ? [] : [a, b],
			edges: [{ from: a, to: b, traced: false }],
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
					slots={get().items.length}
					generation={0}
					card={(index) => get().items[index] ?? (index === 0 ? a : b)}
					visible={() => true}
					items={get().items}
					edges={get().edges}
					traced={new Set()}
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
	vi.spyOn(viewport, `getBoundingClientRect`).mockReturnValue(
		new DOMRect(0, 0, 800, 500),
	)
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
		resize: () => {
			resize([], {} as ResizeObserver)
			root.flush()
		},
		patch,
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
	expect(card.style.transform).toContain(`translate`)
	expect(card.style.transform).not.toMatch(/rotate\((?!0rad)|matrix3d/)
	expect(f.viewport.dataset[`edges`]).toBe(`1`)
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
	expect(f.context.camera!.target).toEqual([-8, -4, 0])
	expect(f.context.camera!.position.every(Number.isFinite)).toBe(true)
	f.patch({ edges: [{ from: f.a, to: f.b, traced: true }] })
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
	f.patch({ items: [], edges: [] })
	f.command(`fit`)
	f.tick()
	expect(f.viewport.querySelector(`canvas`)).not.toBeNull()
	expect(vi.mocked(THREE.WebGLRenderer).mock.calls).toHaveLength(starts)
	f.patch({ items: [f.a, f.b] })
	f.tick()
	f.root.dispose()
	expect(f.disconnect).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
})
it(`restores a borrowed camera and frames the first nonempty capture at a usable distance`, () => {
	const restored = fixture(true)
	expect(restored.context.camera!.target).toEqual([1, 2, 3])
	restored.tick()
	const empty = fixture(false, true)
	empty.tick()
	empty.patch({
		items: [item(`top`, 8, 10_000, 0), item(`bottom`, -8, -10_000, 0)],
	})
	empty.tick()
	expect(empty.context.camera!.target[0]).toBeCloseTo(8)
	expect(empty.context.camera!.target[1]).toBeCloseTo(10_000)
	const distance = (camera: NonNullable<typeof empty.context.camera>) =>
		Math.hypot(...camera.position.map((n, i) => n - camera.target[i]))
	expect(distance(empty.context.camera!)).toBeLessThanOrEqual(90.00001)
	empty.command(`fit`)
	expect(distance(empty.context.camera!)).toBeGreaterThan(10_000)
	empty.command(`focus`, `state:top`)
	expect(distance(empty.context.camera!)).toBeLessThanOrEqual(45.00001)
})
it(`applies a queued focus when the first populated capture starts the camera`, () => {
	const f = fixture(false, true)
	f.command(`focus`, `state:b`)
	f.patch({ items: [f.a, f.b] })
	f.tick()
	expect(f.context.camera!.target).toEqual([-8, -4, 0])
})
it(`keeps the list fallback local when WebGL creation fails`, () => {
	vi.mocked(THREE.WebGLRenderer).mockImplementationOnce(function () {
		throw new Error(`unavailable`)
	})
	const f = fixture()
	f.root.flush()
	expect(f.viewport.dataset[`unavailable`]).toBe(`true`)
	expect(f.viewport.textContent).toContain(`accessible node list`)
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
	writeEdgeBuffer(
		geometry,
		[
			{ from, to, traced: false },
			{ from, to, traced: false },
			{ from, to: from, traced: false },
			{ from, to, traced: true },
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
		[{ from, to: { x: 5, y: 16, z: 3 }, traced: false }],
		false,
		camera,
		800,
		500,
	)
	expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true)
	writeEdgeBuffer(geometry, [], false, camera, 800, 500)
	expect(geometry.drawRange.count).toBe(0)
	writeEdgeBuffer(geometry, [{ from, to, traced: true }], true, camera, 800, 500)
	expect(geometry.drawRange.count).toBe(36)
	geometry.dispose()
})
