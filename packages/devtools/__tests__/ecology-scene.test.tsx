/** @jsxImportSource @atom.io/spa */
import { render, useGetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { Silo } from "atom.io"
import type * as Motion from "motion"
import { animate, type MotionValue } from "motion"
import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import { ecologyColor } from "../src/ecology-color.ts"
import {
	createGraphContext,
	type FamilyConnection,
	type GraphContext,
	type GraphItem,
} from "../src/ecology-graph.ts"
import type { EcologyLine } from "../src/ecology-lines.ts"
import {
	createEdgeProjector,
	createFamilySpine,
	writeFamilySpine,
} from "../src/ecology-lines.ts"
import {
	createEcologyMotion,
	createEdgeRoutingMotion,
	FAMILY_SPRING,
} from "../src/ecology-motion.ts"
import { type CameraCommand, EcologyScene } from "../src/EcologyScene.tsx"
import { useTools } from "../src/store.ts"

const projectEdges = createEdgeProjector()
vi.mock(`motion`, async (actual) => ({
	...(await actual<typeof Motion>()),
	animate: vi.fn(),
}))
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
	hovered?: string | undefined
	selected?: string | undefined
	selectedFamily?: string | undefined
	selectedIds?: ReadonlySet<string> | undefined
	focused?: ReadonlySet<string> | undefined
	traced: Set<string>
	items: GraphItem[]
	edges: EcologyLine[]
	familyConnections?: FamilyConnection[]
	historyConnections?: FamilyConnection[]
	command?: CameraCommand | undefined
}
function fixture(
	restored: boolean | GraphContext[`camera`] = false,
	empty = false,
) {
	const silo = new Silo({
		name: `scene-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const context = createGraphContext()
	if (restored)
		context.camera =
			restored === true
				? { position: [20, 10, 30], target: [1, 2, 3] }
				: restored
	const a = item(`a`, 8, 4, 0),
		b = item(`b`, -8, -4, 0)
	const sceneStateAtom = silo.atom<SceneState>({
		key: `sceneState`,
		default: {
			cylinderHeight: 8,
			traced: new Set(),
			items: empty ? [] : [a, b],
			edges: [
				{
					id: `a:b`,
					source: a.id,
					from: a,
					to: b,
					color: a.color,
					traced: false,
				},
			],
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
					generation={0}
					items={get().items}
					edges={get().edges}
					familyConnections={get().familyConnections}
					historyConnections={get().historyConnections}
					traced={get().traced}
					selected={get().selected}
					selectedFamily={get().selectedFamily}
					selectedIds={get().selectedIds}
					focused={get().focused}
					hovered={get().hovered}
					command={get().command}
				/>
			)
		},
		host,
		{
			store: silo.store,
			capabilities: [
				{
					...motionCapability({ reducedMotion: `always` }),
					scheduleFrame(run) {
						tick = run
						return stop
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
			root.flush()
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

it(`projects viewer-facing DOM cards and source-stacked edges, keeps a camera through resize and releases scene work`, () => {
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
			{ family: `family:items`, from: f.a, to: f.b, color: f.a.color },
		],
	})
	f.tick()
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const ground = vi
		.mocked(gl.render)
		.mock.lastCall![0].getObjectByName(`ecology-ground`) as THREE.Mesh<
		THREE.PlaneGeometry,
		THREE.ShaderMaterial
	>
	expect(ground.position.y).toBeLessThan(-f.point(f.a)[1])
	expect(ground.material.transparent).toBe(true)
	expect(ground.material.depthWrite).toBe(false)
	const disposeGroundGeometry = vi.spyOn(ground.geometry, `dispose`),
		disposeGroundMaterial = vi.spyOn(ground.material, `dispose`)
	const scene = vi.mocked(gl.render).mock.lastCall![0]
	const spine = scene.getObjectByName(`family-connections`) as ReturnType<
		typeof createFamilySpine
	>
	const selectedSpine = scene.getObjectByName(
		`selected-family-connections`,
	) as ReturnType<typeof createFamilySpine>
	expect(spine.geometry.instanceCount).toBe(1)
	expect(spine.material.linewidth).toBeGreaterThan(1)
	expect(selectedSpine.geometry.instanceCount).toBe(0)
	expect(selectedSpine.material.linewidth).toBeGreaterThan(
		spine.material.linewidth,
	)
	expect(selectedSpine.material.opacity).toBeGreaterThan(spine.material.opacity)
	expect(spine.renderOrder).toBeLessThan(0)
	expect(ground.renderOrder).toBeLessThan(spine.renderOrder)
	const member = { ...f.a, familyLabel: `items`, familyId: `family:items` },
		sibling = { ...f.b, familyLabel: `items`, familyId: `family:items` }
	f.patch({
		items: [member, sibling],
		selected: member.id,
		selectedFamily: member.familyId,
		focused: new Set([member.id]),
	})
	f.tick()
	expect(spine.geometry.instanceCount).toBe(0)
	expect(selectedSpine.geometry.instanceCount).toBe(1)
	expect(
		f.viewport
			.querySelector(`ecology-node-card:has([data-graph-id="${sibling.id}"])`)
			?.getAttribute(`data-dimmed`),
	).toBe(`false`)
	f.patch({ selected: undefined, selectedFamily: undefined, focused: undefined })
	f.tick()
	expect(spine.geometry.instanceCount).toBe(1)
	expect(selectedSpine.geometry.instanceCount).toBe(0)
	const groundHeight = ground.position.y
	f.resize(400, 800)
	f.tick()
	expect(ground.position.y).toBeLessThan(groundHeight)
	expect(f.viewport.dataset[`familyConnections`]).toBe(`1`)
	const disposeGeometry = vi.spyOn(spine.geometry, `dispose`),
		disposeMaterial = vi.spyOn(spine.material, `dispose`),
		disposeSelectedGeometry = vi.spyOn(selectedSpine.geometry, `dispose`),
		disposeSelectedMaterial = vi.spyOn(selectedSpine.material, `dispose`)
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
		`unknown`,
		`focus`,
	])
		f.command(action)
	f.command(`focus`, `state:b`)
	expect(f.context.camera!.target).toEqual(
		f.point(f.b).map((value) => expect.closeTo(value, 10)),
	)
	expect(f.context.camera!.position.every(Number.isFinite)).toBe(true)
	f.patch({
		edges: [
			{
				id: `a:b`,
				source: f.a.id,
				from: f.a,
				to: f.b,
				color: f.a.color,
				traced: true,
			},
		],
	})
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
	f.command(`reset`)
	f.tick()
	expect(spine.geometry.instanceCount).toBe(0)
	expect(f.viewport.querySelector(`canvas`)).not.toBeNull()
	expect(vi.mocked(THREE.WebGLRenderer).mock.calls).toHaveLength(starts)
	f.patch({ items: [f.a, f.b] })
	f.tick()
	f.root.dispose()
	expect(f.disconnect).toHaveBeenCalledOnce()
	expect(f.stop).toHaveBeenCalledOnce()
	expect(disposeGeometry).toHaveBeenCalledOnce()
	expect(disposeMaterial).toHaveBeenCalledOnce()
	expect(disposeSelectedGeometry).toHaveBeenCalledOnce()
	expect(disposeSelectedMaterial).toHaveBeenCalledOnce()
	expect(disposeGroundGeometry).toHaveBeenCalledOnce()
	expect(disposeGroundMaterial).toHaveBeenCalledOnce()
})

it(`raises a hovered card above the selected graph and restores its layer without changing selection`, () => {
	const f = fixture()
	f.patch({ selected: f.a.id, traced: new Set([f.a.key]) })
	f.tick()
	const a = f.viewport.querySelector(
			`button[data-graph-id="state:a"]`,
		)!.parentElement!,
		b = f.viewport.querySelector(
			`button[data-graph-id="state:b"]`,
		)!.parentElement!
	expect(Number(a.style.zIndex)).toBeGreaterThan(Number(b.style.zIndex))
	f.patch({ hovered: f.b.id })
	f.tick()
	expect(Number(b.style.zIndex)).toBeGreaterThan(Number(a.style.zIndex))
	expect(b.dataset[`hovered`]).toBe(`true`)
	expect(a.querySelector(`button`)!.getAttribute(`aria-pressed`)).toBe(`true`)
	f.patch({ hovered: undefined })
	f.tick()
	expect(Number(a.style.zIndex)).toBeGreaterThan(Number(b.style.zIndex))
	expect(b.dataset[`hovered`]).toBe(`false`)
})

it(`projects animated member cards, arrows and family spines from the same world positions`, () => {
	const media = new EventTarget() as MediaQueryList
	Object.defineProperty(media, `matches`, { value: false })
	vi.spyOn(window, `matchMedia`).mockReturnValue(media)
	const f = fixture(false, true)
	const family = { ...item(`items`, 8, 4, 0), id: `family:items` }
	const member = {
		...item(`items("a")`, 16, 4, -8),
		familyLabel: `items`,
		familyId: `family:items`,
		cluster: { x: 8.1, y: 4, z: 0 },
	}
	f.context.expanded.add(`family:items`)
	f.patch({
		items: [family, member, f.b],
		edges: [
			{
				id: `member:b`,
				source: member.id,
				from: member,
				to: f.b,
				color: member.color,
				traced: false,
			},
		],
		familyConnections: [
			{ family: `family:items`, from: family, to: member, color: family.color },
		],
	})
	f.tick()
	const card = f.viewport.querySelector<HTMLElement>(
		`ecology-node-card:has(>button[data-graph-id='${member.id}'])`,
	)!
	const start = card.style.transform,
		path = card.querySelector(`path`)!,
		curve = path.getAttribute(`d`)
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const spine = vi
		.mocked(gl.render)
		.mock.lastCall![0].getObjectByName(`family-connections`) as ReturnType<
		typeof createFamilySpine
	>
	const end = spine.geometry.getAttribute(
		`instanceEnd`,
	) as THREE.InterleavedBufferAttribute
	const startX = end.getX(0)
	const value = vi.mocked(animate).mock.calls.at(-1)![0] as MotionValue<number>
	const destroy = vi.spyOn(value, `destroy`)
	value.set(0.5)
	f.tick()
	expect(card.style.transform).not.toBe(start)
	expect(path.getAttribute(`d`)).not.toBe(curve)
	expect(end.getX(0)).not.toBe(startX)
	value.set(1)
	f.tick()
	expect(card.style.transform).toContain(`translate`)
	expect([end.getX(0), end.getY(0), end.getZ(0)]).toEqual(
		f.point(member).map((coordinate) => expect.closeTo(coordinate, 4)),
	)
	f.context.expanded.clear()
	f.patch({ items: [family, f.b] })
	f.tick()
	f.root.dispose()
	expect(destroy).toHaveBeenCalledOnce()
})

it(`springs late-arriving history and keeps the rendered line attached while an event crosses the cursor`, () => {
	const media = new EventTarget() as MediaQueryList
	Object.defineProperty(media, `matches`, { value: false })
	vi.spyOn(window, `matchMedia`).mockReturnValue(media)
	const f = fixture(false, true)
	const timeline: GraphItem = {
		...item(`count`, 5, 0, 2),
		id: `timeline:count`,
		kind: `timeline`,
		source: {
			type: `timeline`,
			key: `count`,
			at: 1,
			historyLength: 1,
			family: null,
		},
	}
	const past: GraphItem = {
		...timeline,
		id: `history:timeline:count:change`,
		history: { identity: `change`, direction: `past`, anchor: timeline },
		familyId: timeline.id,
		cluster: timeline,
		y: 4,
	}
	f.patch({ items: [timeline], edges: [] })
	f.context.expanded.add(timeline.id)
	f.patch({ items: [timeline] })
	f.patch({
		items: [timeline, past],
		historyConnections: [
			{ family: timeline.id, from: timeline, to: past, color: timeline.color },
		],
	})
	f.tick()
	const selector = `ecology-node-card:has(>button[data-graph-id="${past.id}"])`
	const card = f.viewport.querySelector<HTMLElement>(selector)!
	const anchor = f.viewport.querySelector<HTMLElement>(
		`ecology-node-card:has(>button[data-graph-id="${timeline.id}"])`,
	)!
	expect(card.style.transform).toBe(anchor.style.transform)
	const [spring, openingTarget, transition] = vi.mocked(animate).mock.lastCall!
	const offset = spring as MotionValue<number>
	expect(openingTarget).toBe(4)
	expect(transition).toEqual(FAMILY_SPRING)
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const spine = vi
		.mocked(gl.render)
		.mock.lastCall![0].getObjectByName(`family-connections`) as ReturnType<
		typeof createFamilySpine
	>
	const from = spine.geometry.getAttribute(`instanceStart`)
	const to = spine.geometry.getAttribute(`instanceEnd`)
	offset.set(2)
	f.tick()
	expect(card.style.transform).not.toBe(anchor.style.transform)
	expect(to.getY(0)).toBeCloseTo(f.point({ ...past, y: 2 })[1])
	const halfway = card.style.transform
	const future: GraphItem = {
		...past,
		y: -4,
		history: { identity: `change`, direction: `future`, anchor: timeline },
	}
	f.patch({
		items: [timeline, future],
		historyConnections: [
			{ family: timeline.id, from: future, to: timeline, color: timeline.color },
		],
	})
	f.tick()
	expect(f.viewport.querySelector(selector)).toBe(card)
	expect(card.style.transform).toBe(halfway)
	expect(vi.mocked(animate).mock.lastCall).toEqual([offset, -4, FAMILY_SPRING])
	expect(to.getY(0)).toBeCloseTo(f.point({ ...past, y: 2 })[1])
	offset.set(-2)
	f.tick()
	expect(from.getY(0)).toBeCloseTo(f.point({ ...future, y: -2 })[1])
	expect(to.getY(0)).toBeCloseTo(f.point(timeline)[1])
})

it(`follows a moving timeline family member and retracts an event when its drawer closes`, () => {
	const media = new EventTarget() as MediaQueryList
	let reduced = false
	Object.defineProperty(media, `matches`, { get: () => reduced })
	const motion = createEcologyMotion(vi.fn(), { matchMedia: () => media })
	cleanups.push(motion.dispose)
	const timeline = {
		...item(`count`, 12, 0, 2),
		familyId: `timeline_family:counts`,
		cluster: { x: 4, y: 2, z: 0 },
	}
	const event: GraphItem = {
		...item(`event`, 12, -4, 2),
		familyId: timeline.id,
		cluster: timeline,
		history: { identity: `event`, direction: `future`, anchor: timeline },
	}
	const expanded = new Set<string>()
	motion.sync([], expanded, 0)
	expanded.add(timeline.familyId)
	expanded.add(timeline.id)
	motion.sync([timeline, event], expanded, 0)
	const [familySpring] = vi.mocked(animate).mock.calls.at(-2)!
	const [eventSpring] = vi.mocked(animate).mock.lastCall!
	;(familySpring as MotionValue<number>).set(0.5)
	const offset = eventSpring as MotionValue<number>
	offset.set(-4)
	expect(motion.position(event.id)).toEqual({ x: 8, y: -3, z: 1 })
	const clustered: GraphItem = {
		...event,
		id: `history:clustered`,
		y: 0.25,
		cluster: { x: 12, y: 0.25, z: 2 },
	}
	expect(motion.point(clustered)).toEqual({ x: 8, y: 1.25, z: 1 })
	expanded.delete(timeline.id)
	motion.sync([timeline], expanded, 0)
	expect(motion.exiting(event.id)).toBe(true)
	expect(vi.mocked(animate).mock.lastCall).toEqual([offset, 0, FAMILY_SPRING])
	offset.set(-2)
	expect(motion.historySpines()).toEqual([
		{
			family: timeline.id,
			color: event.color,
			from: { x: 8, y: -1, z: 1 },
			to: { x: 8, y: 1, z: 1 },
		},
	])
	const past: GraphItem = {
		...event,
		id: `history:past`,
		y: 4,
		history: { identity: `past`, direction: `past`, anchor: timeline },
	}
	expanded.add(timeline.id)
	motion.sync([timeline, event, past], expanded, 0)
	const [pastSpring] = vi.mocked(animate).mock.lastCall!
	;(pastSpring as MotionValue<number>).set(2)
	expect(motion.historySpines()[0].to.y).toBe(3)
	motion.sync([timeline, event], expanded, 0)
	expect(motion.exiting(past.id)).toBe(true)
	expanded.delete(timeline.familyId)
	motion.sync([], expanded, 0)
	expect(motion.exiting(event.id)).toBe(true)
	reduced = true
	media.dispatchEvent(new Event(`change`))
	expect(motion.exiting(event.id)).toBe(false)
	expect(motion.historySpines()).toEqual([])
})

it(`writes arrowless family spines with shared colors, world scaling and reusable bounded buffers`, () => {
	const spine = createFamilySpine(3, 0.55)
	const { geometry } = spine
	const attribute = (name: string) =>
		geometry.getAttribute(name) as THREE.InterleavedBufferAttribute
	const positions = attribute(`instanceStart`),
		colors = attribute(`instanceColorStart`)
	const from = item(`from`, -8, 2, 4),
		to = item(`to`, 8, 2, -4),
		scale = new THREE.Vector3(2, 3, 4)
	expect(positions.count).toBe(500)
	expect(geometry.instanceCount).toBe(0)
	const connections = [{ family: `family:items`, from, to, color: from.color }]
	writeFamilySpine(spine, connections, scale)
	expect(geometry.instanceCount).toBe(1)
	expect(spine.visible).toBe(true)
	expect(new THREE.Raycaster().intersectObject(spine)).toEqual([])
	const color = new THREE.Color(from.color)
	for (const [point, coords, tint] of [
		[from, positions, colors],
		[to, attribute(`instanceEnd`), attribute(`instanceColorEnd`)],
	] as const) {
		expect([coords.getX(0), coords.getY(0), coords.getZ(0)]).toEqual([
			point.x * 2,
			point.y * 3,
			point.z * 4,
		])
		expect([tint.getX(0), tint.getY(0), tint.getZ(0)]).toEqual([
			expect.closeTo(color.r, 6),
			expect.closeTo(color.g, 6),
			expect.closeTo(color.b, 6),
		])
	}
	writeFamilySpine(spine, [], scale)
	expect(geometry.instanceCount).toBe(0)
	expect(spine.visible).toBe(false)
	expect(positions.data.updateRanges).toEqual([])
	writeFamilySpine(spine, connections, scale)
	expect(attribute(`instanceStart`)).toBe(positions)
	expect(attribute(`instanceColorStart`)).toBe(colors)
	expect(positions.data.updateRanges).toEqual([{ start: 0, count: 6 }])
	geometry.dispose()
	spine.material.dispose()
})

it(`keeps outgoing paths inside their source layer, with inherited colors, separate strokes and stable card identities`, () => {
	const f = fixture()
	f.resize()
	f.tick()
	const cards = [
		...f.viewport.querySelectorAll<HTMLElement>(`ecology-node-card`),
	]
	const path = cards[0].querySelector(`path`)!
	expect(path.namespaceURI).toBe(`http://www.w3.org/2000/svg`)
	expect(path.getAttribute(`d`)).toMatch(/^M/)
	expect(cards[1].querySelector(`path`)).toBeNull()
	expect(cards[0].querySelector(`svg`)!.getAttribute(`stroke`)).toBe(
		`var(--ecology-color)`,
	)
	expect(cards[0].querySelector(`svg`)!.getAttribute(`aria-hidden`)).toBe(`true`)
	f.command(`unknown`)
	f.tick()
	const geometry = path.getAttribute(`d`)
	const writes = vi.spyOn(path, `setAttribute`)
	f.patch({
		edges: [
			{
				id: `a:b`,
				source: f.a.id,
				from: f.a,
				to: f.b,
				color: f.a.color,
				traced: true,
			},
		],
	})
	f.tick()
	expect(path.getAttribute(`d`)).toBe(geometry)
	expect(path.getAttribute(`data-traced`)).toBe(`true`)
	expect(writes).not.toHaveBeenCalledWith(`d`, geometry)
	const edge: EcologyLine = {
		id: `a:b`,
		source: f.a.id,
		from: f.a,
		to: f.b,
		color: f.a.color,
		traced: true,
	}
	f.patch({ edges: [{ ...edge, relation: `transaction` }] })
	f.tick()
	expect(path.getAttribute(`data-relation`)).toBe(`transaction`)
	f.patch({ edges: [edge] })
	f.tick()
	expect(path.hasAttribute(`data-relation`)).toBe(false)
	f.patch({
		edges: [
			{
				id: `a:b`,
				source: f.a.id,
				from: f.a,
				to: f.b,
				color: f.a.color,
				traced: false,
			},
			{
				id: `a:b-2`,
				source: f.a.id,
				from: f.a,
				to: f.b,
				color: f.a.color,
				traced: true,
			},
			{
				id: `b:a`,
				source: f.b.id,
				from: f.b,
				to: f.a,
				color: f.b.color,
				traced: false,
			},
		],
	})
	f.tick()
	expect(cards[0].querySelectorAll(`path`)).toHaveLength(2)
	expect(cards[0].querySelectorAll(`path[data-traced="true"]`)).toHaveLength(1)
	expect(cards[1].querySelectorAll(`path`)).toHaveLength(1)
	const before = path.getAttribute(`d`)
	f.command(`right`)
	f.tick()
	expect(cards[0].querySelector(`path`)).toBe(path)
	expect(path.getAttribute(`d`)).not.toBe(before)
	f.patch({ items: [f.b, f.a] })
	f.tick()
	expect(f.viewport.querySelector(`ecology-node-card`)).toBe(cards[1])
	expect(cards[0].style.getPropertyValue(`--ecology-color`)).toBe(f.a.color)
	expect(cards[0].querySelectorAll(`path`)).toHaveLength(2)
	expect(cards[1].querySelectorAll(`path`)).toHaveLength(1)
	f.patch({ edges: [] })
	f.tick()
	expect(f.viewport.querySelector(`path`)).toBeNull()
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
	const initial = distance(empty.context.camera!)
	expect(initial).toBeLessThan(90)
	empty.command(`in`)
	expect(distance(empty.context.camera!)).not.toBeCloseTo(initial)
	empty.command(`reset`)
	expect(distance(empty.context.camera!)).toBeCloseTo(initial)
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
it(`restores a readable default view for a very long family tangent`, () => {
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
	f.command(`focus`, b.id)
	expect(distance()).toBeCloseTo(45)
	f.command(`reset`)
	expect(distance()).toBeCloseTo(90)
	expect(f.context.camera!.target).toEqual(
		f.point(a).map((value) => expect.closeTo(value, 10)),
	)
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
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	const paint = vi.mocked(gl.render).mockClear()
	f.resize(300, 900)
	const [diameter, height] =
		f.viewport.dataset[`cylinder`]!.split(`,`).map(Number)
	expect(paint).toHaveBeenCalledOnce()
	expect(vi.mocked(gl.setSize).mock.invocationCallOrder.at(-1)).toBeLessThan(
		paint.mock.invocationCallOrder[0],
	)
	const ground = paint.mock.calls[0][0].getObjectByName(`ecology-ground`)!
	expect(ground.position.y).toBeCloseTo(-height / 2 - 2)
	f.tick()
	expect(paint).toHaveBeenCalledOnce()
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
it(`stacks selected and connected cards with their outgoing paths above nearer unrelated cards and restores distance ordering when cleared`, () => {
	const f = fixture()
	f.tick()
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
const pathPoints = (d: string) =>
	d
		.slice(1)
		.split(/[ML]/)
		.map((xy) => xy.split(`,`).map(Number))
function projectionCamera() {
	const camera = new THREE.PerspectiveCamera(45, 800 / 500, 0.1, 1000)
	camera.position.set(0, 0, 40)
	camera.updateMatrixWorld()
	return camera
}
it(`projects 3D curves and arrowheads into source-local SVG coordinates, preserving loops, parallel edges and scaling`, () => {
	const camera = projectionCamera(),
		from = { x: -8, y: 0, z: 0 },
		to = { x: 8, y: 0, z: 0 }
	const edge: EcologyLine = {
		id: `a:b`,
		source: `a`,
		from,
		to,
		color: `red`,
		traced: false,
	}
	const paths = projectEdges(
		[edge, edge, { ...edge, to: from, traced: true }],
		camera,
		800,
		500,
	).get(`a`)!
	expect(paths).toHaveLength(3)
	expect(paths[0]).toEqual(paths[1])
	expect(paths[2].traced).toBe(true)
	const points = pathPoints(paths[0].d)
	expect(points).toHaveLength(20)
	expect(points[0]).toEqual([91, 0])
	const target = new THREE.Vector3(8, 0, 0).project(camera),
		origin = new THREE.Vector3(-8, 0, 0).project(camera)
	expect(points[16][0]).toBeCloseTo((target.x - origin.x) * 400 - 91, 2)
	expect(points[18]).toEqual(points[16])
	expect(Math.max(...pathPoints(paths[2].d).map(([, y]) => -y))).toBeGreaterThan(
		29,
	)
	expect(
		paths
			.flatMap((p) => pathPoints(p.d))
			.flat()
			.every(Number.isFinite),
	).toBe(true)
	expect(projectEdges([], camera, 800, 500).size).toBe(0)
	const scale = new THREE.Vector3(2, 0.5, 2)
	const scaled = pathPoints(
		projectEdges([edge], camera, 800, 500, scale).get(`a`)![0].d,
	)
	expect(scaled[0]).toEqual([91, 0])
	expect(scaled[16][0]).toBeCloseTo((target.x - origin.x) * 800 - 91, 2)
	const vertical = pathPoints(
		projectEdges(
			[{ ...edge, to: { x: -8, y: 16, z: 3 } }],
			camera,
			800,
			500,
		).get(`a`)![0].d,
	)
	expect(vertical[0][0]).toBeCloseTo(0)
	expect(vertical[0][1]).toBe(-29)
})
it(`fans clustered arrows across family ports and groups them under the visible source family`, () => {
	const camera = projectionCamera(),
		fromCard = { x: -8, y: 0, z: 0 },
		toCard = { x: 8, y: 0, z: 0 }
	const edges: EcologyLine[] = Array.from({ length: 16 }, (_, index) => ({
		id: String(index),
		source: `family:items`,
		from: {
			x: -8 + (index % 3) * 0.1,
			y: (index - 7.5) * 0.025,
			z: index * 0.01,
		},
		to: { x: 8, y: (7.5 - index) * 0.02, z: 0 },
		fromCard,
		toCard,
		color: `red`,
		traced: false,
	}))
	const paths = projectEdges(edges, camera, 800, 500).get(`family:items`)!
	const points = paths.map((path) => pathPoints(path.d))
	expect(points.every((path) => Math.abs(path[0][0] - 91) < 0.01)).toBe(true)
	expect(new Set(points.map((path) => path[0][1])).size).toBe(16)
	expect(new Set(points.map((path) => path[16][1])).size).toBe(16)
	expect(
		points.every(
			(path) => Math.abs(path[0][1]) <= 23 && Math.abs(path[16][1]) <= 23,
		),
	).toBe(true)
	const loop = projectEdges(
		[
			{
				...edges[0],
				from: { x: -8, y: 0.2, z: 0 },
				to: { x: -8, y: -0.2, z: 0 },
				toCard: fromCard,
			},
		],
		camera,
		800,
		500,
	).get(`family:items`)![0]
	expect(pathPoints(loop.d).some(([, y]) => -y > 29)).toBe(true)
})
it(`clips filtered arrows to compact card ports`, () => {
	const edge: EcologyLine = {
		id: `a:b`,
		source: `a`,
		from: { x: -8, y: 0, z: 0 },
		to: { x: 8, y: 0, z: 0 },
		color: `red`,
		traced: false,
		fromCollapsed: true,
		toCollapsed: true,
	}
	const points = pathPoints(
		projectEdges([edge], projectionCamera(), 800, 500).get(`a`)![0].d,
	)
	expect(points[0]).toEqual([43, 0])
	const full = pathPoints(
		projectEdges(
			[{ ...edge, fromCollapsed: false, toCollapsed: false }],
			projectionCamera(),
			800,
			500,
		).get(`a`)![0].d,
	)
	expect(points[16][0] - full[16][0]).toBeCloseTo(48)
})

it(`clips curves at camera depth planes and omits hidden or degenerate source layers`, () => {
	const camera = projectionCamera(),
		source = `a`,
		color = `red`,
		traced = false
	const from = { x: -8, y: 0, z: 0 }
	const edge = {
		id: `a:b`,
		source,
		color,
		traced,
		from,
		to: { x: 8, y: 0, z: 60 },
	}
	const paths = projectEdges([edge], camera, 800, 500).get(source)!
	expect(paths).toHaveLength(1)
	expect(pathPoints(paths[0].d).flat().every(Number.isFinite)).toBe(true)
	expect(
		projectEdges([{ ...edge, from: { x: 0, y: 0, z: 60 } }], camera, 800, 500)
			.size,
	).toBe(0)
	expect(
		projectEdges([{ ...edge, to: { x: 0, y: 0, z: 40 } }], camera, 800, 500)
			.size,
	).toBe(0)
	expect(
		projectEdges([{ ...edge, from: { x: 0, y: 0, z: -2000 } }], camera, 800, 500)
			.size,
	).toBe(0)
	// Clustered member endpoints can lie beyond the depth planes while their family card remains visible.
	expect(
		projectEdges(
			[{ ...edge, from: { x: 1, y: 1, z: 60 }, fromCard: from }],
			camera,
			800,
			500,
		).size,
	).toBe(0)
	expect(
		projectEdges(
			[
				{
					...edge,
					from: { x: 1, y: 1, z: 60 },
					to: { x: 8, y: 2, z: 60 },
					fromCard: from,
				},
			],
			camera,
			800,
			500,
		).size,
	).toBe(0)
})

it(`reuses projected paths through tracing changes, invalidates camera/port changes and forgets removed edges`, () => {
	const camera = projectionCamera(),
		project = createEdgeProjector()
	const from = { x: -8, y: 0, z: 0 },
		to = { x: 8, y: 0, z: 0 }
	const edge: EcologyLine = {
		id: `a:b`,
		source: `a`,
		from,
		to,
		color: `red`,
		traced: false,
	}
	const first = project([edge], camera, 800, 500).get(`a`)![0]
	expect(project([edge], camera, 800, 500).get(`a`)![0]).toBe(first)
	const traced = project([{ ...edge, traced: true }], camera, 800, 500).get(
		`a`,
	)![0]
	expect(traced.d).toBe(first.d)
	expect(traced.traced).toBe(true)
	const full = project([edge], camera, 800, 500).get(`a`)![0]
	project(
		[{ ...edge, fromCollapsed: true, toCollapsed: true }],
		camera,
		800,
		500,
	)
	expect(project([edge], camera, 800, 500).get(`a`)![0]).toBe(full)
	const loop = { ...edge, to: from }
	const ordered = project([edge, loop], camera, 800, 500).get(`a`)!
	expect(project([loop, edge], camera, 800, 500).get(`a`)).toEqual(ordered)
	for (const changed of [
		{ ...edge, fromCollapsed: true },
		{ ...edge, toCollapsed: true },
		{ ...edge, fromCard: { x: -7, y: 0, z: 0 } },
		{ ...edge, toCard: { x: 7, y: 0, z: 0 } },
		{ ...edge, origin: { x: 0, y: 0, z: 0 } },
	]) {
		project([edge], camera, 800, 500)
		expect(project([changed], camera, 800, 500).get(`a`)![0].d).not.toBe(first.d)
	}
	project([edge], camera, 800, 500)
	camera.position.z = 50
	camera.updateMatrixWorld()
	expect(project([edge], camera, 800, 500).get(`a`)![0].d).not.toBe(first.d)
	const moved = project([edge], camera, 800, 500).get(`a`)![0]
	project([], camera, 800, 500)
	expect(project([edge], camera, 800, 500).get(`a`)![0]).not.toBe(moved)
})

it(`slides both ports and the arrow tip along their cards using the current camera`, () => {
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false })
	const routes = createEdgeRoutingMotion(vi.fn(), media)
	cleanups.push(routes.dispose)
	const project = createEdgeProjector(routes)
	const camera = projectionCamera()
	const from = { x: -8, y: 0, z: 0 },
		to = { x: 8, y: 0, z: 0 }
	const edge: EcologyLine = {
		id: `a:b`,
		source: `a`,
		from,
		to,
		color: `red`,
		traced: false,
		toCollapsed: true,
	}
	const loop = { ...edge, id: `a:a`, to: from }
	const read = () => project([edge, loop], camera, 800, 500).get(`a`)!
	expect(pathPoints(read()[0].d)[0]).toEqual([91, 0])
	camera.rotateZ(-Math.PI / 2)
	camera.updateMatrixWorld()
	const [start, unchanged] = read()
	expect(pathPoints(start.d)[0]).toEqual([91, 0])
	const [heading, goal] = vi.mocked(animate).mock.lastCall!
	const angle = heading as MotionValue<number>
	expect(goal).toBe(1)
	angle.set(0.5)
	const [middle, stillUnchanged] = read()
	expect(stillUnchanged).toBe(unchanged)
	const coordinates = pathPoints(middle.d)
	expect(coordinates[0]).toEqual([29, -29])
	const center = new THREE.Vector3(to.x - from.x, 0, 0).project(camera).y * -250
	expect(coordinates[16][0]).toBe(-15)
	expect(coordinates[16][1]).toBeCloseTo(center + 15, 2)
	expect(coordinates[18]).toEqual(coordinates[16])
	angle.set(1)
	const [settled] = read()
	const [x, y] = pathPoints(settled.d)[0]
	expect(x).toBeCloseTo(0)
	expect(y).toBe(-29)
	expect(read()[0]).toBe(settled)
})

it(`repaints the SVG during a port spring without redrawing the 3D scene`, () => {
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false })
	vi.mocked(window.matchMedia).mockReturnValue(media)
	const f = fixture({ position: [0, 0, 40], target: [0, 0, 0] })
	f.resize()
	f.tick()
	const path = f.viewport.querySelector<SVGPathElement>(`svg path`)!
	const start = () => pathPoints(path.getAttribute(`d`) ?? ``)[0]
	expect(start()).toEqual([-91, 0])
	const to = item(`b`, f.a.x, f.a.y + 12, f.a.z)
	f.patch({
		items: [f.a, to],
		edges: [
			{
				id: `a:b`,
				source: f.a.id,
				from: f.a,
				to,
				color: f.a.color,
				traced: false,
			},
		],
	})
	f.tick()
	const [heading, goal] = vi.mocked(animate).mock.lastCall!
	expect(goal).toBe(1)
	expect(start()).toEqual([-91, 0])
	const gl = vi.mocked(THREE.WebGLRenderer).mock.results.at(-1)!
		.value as THREE.WebGLRenderer
	vi.mocked(gl.render).mockClear()
	const angle = heading as MotionValue<number>
	angle.set(1.5)
	f.tick()
	expect(start()).toEqual([-29, -29])
	expect(gl.render).not.toHaveBeenCalled()
})
