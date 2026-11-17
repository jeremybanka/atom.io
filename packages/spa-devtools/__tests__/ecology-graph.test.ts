import { afterEach, expect, it, vi } from "vitest"

import type { EcologyNode, EcologySnapshot } from "../src/ecology.ts"
import {
	createGraphContext,
	projectEcology,
	scheduleGraph,
} from "../src/ecology-graph.ts"

afterEach(() => {
	vi.useRealTimers()
})
const node = (
	key: string,
	kind: `atom` | `selector` = `atom`,
	family?: string,
): EcologyNode => ({
	key,
	kind,
	type: kind === `atom` ? `atom` : `readonly_pure_selector`,
	family: family ? { key: family, subKey: JSON.stringify(key) } : null,
	value: { status: `unknown` },
	dependencies: kind === `atom` ? `not-applicable` : `unknown`,
	dependenciesTruncated: false,
})
const snapshot = (
	nodes: EcologyNode[] = [],
	edges: EcologySnapshot[`edges`] = [],
): EcologySnapshot => ({
	version: 1,
	nodes,
	edges,
	families: [],
	truncated: { nodes: false, families: false, relations: false },
	work: { nodes: nodes.length, families: 0, relations: edges.length },
})
function drain<T>(iterator: Generator<void, T>): T {
	let step = iterator.next()
	while (!step.done) step = iterator.next()
	return step.value
}

it(`groups families, keeps zero definitions and namespaces group/member identities with directed observed arrows`, () => {
	const state = snapshot(
		[
			node(`a`, `atom`, `items`),
			node(`b`, `atom`, `items`),
			node(`sum`, `selector`),
		],
		[
			{ dependency: `a`, selector: `sum` },
			{ dependency: `b`, selector: `sum` },
		],
	)
	const withFamilies: EcologySnapshot = {
		...state,
		families: [
			{
				key: `items`,
				type: `atom_family`,
				memberCount: 2,
				countComplete: true,
				memberKeys: [`a`, `b`],
			},
			{
				key: `zero`,
				type: `atom_family`,
				memberCount: 0,
				countComplete: true,
				memberKeys: [],
			},
		],
	}
	const context = createGraphContext()
	let model = drain(projectEcology(withFamilies, context))
	expect(model.items.map((item) => item.id)).toEqual([
		`family:items`,
		`family:zero`,
		`state:sum`,
	])
	expect(model.edges).toEqual([
		{ from: `family:items`, to: `state:sum`, traced: false },
		{ from: `family:items`, to: `state:sum`, traced: false },
	])
	expect(model).toMatchObject({ atoms: 2, selectors: 1, members: 2 })
	const point = (id: string) => {
		const { x, y, z } = model.all.get(id)!
		return [x, y, z]
	}
	expect(point(`state:a`)).toEqual(point(`family:items`))
	expect(point(`state:b`)).toEqual(point(`family:items`))
	context.trace = new Set([`b`, `sum`])
	model = drain(projectEcology(withFamilies, context))
	expect(model.edges[1].traced).toBe(true)
	context.expanded.add(`items`)
	model = drain(projectEcology(withFamilies, context))
	expect(model.items).toHaveLength(5)
	expect(point(`state:a`)).not.toEqual(point(`state:b`))
	const anchor = model.all.get(`family:items`)!,
		member = model.all.get(`state:a`)!
	expect(
		(member.x - anchor.x) * anchor.x + (member.z - anchor.z) * anchor.z,
	).toBeCloseTo(0)
	expect(model.edges).toEqual([
		{ from: `state:a`, to: `state:sum`, traced: false },
		{ from: `state:b`, to: `state:sum`, traced: true },
	])
	context.query = `unknown`
	expect(
		drain(
			projectEcology(
				withFamilies,
				context,
				new Set([`state:a`, `state:b`, `state:sum`]),
			),
		).items.map((item) => item.key),
	).toEqual([`a`, `b`, `sum`])
	context.query = `zero`
	expect(
		drain(projectEcology(withFamilies, context, new Set([`family:zero`])))
			.items[0].detail,
	).toContain(`0 members`)
})

it(`preserves geometry and context on value-only refresh and safely handles disposal and truncated evidence`, () => {
	const context = createGraphContext(),
		first = snapshot([node(`a`), node(`s`, `selector`)])
	context.selected = `state:s`
	context.trace.add(`a`)
	context.camera = { position: [0, 0, 20], target: [0, 0, 0] }
	const model = drain(projectEcology(first, context))
	const positions = model.items.map(({ x, y }) => ({ x, y }))
	const changed = {
		...first,
		nodes: first.nodes.map((item) => ({
			...item,
			value: { status: `cached`, type: `string` } as const,
		})),
	}
	const refreshed = drain(projectEcology(changed, context))
	expect(refreshed.newPositions).toBe(0)
	expect(refreshed.items.map(({ x, y }) => ({ x, y }))).toEqual(positions)
	expect(refreshed.items[0].detail).toContain(`cached string`)
	expect(context.camera).toEqual({ position: [0, 0, 20], target: [0, 0, 0] })
	const partial = {
		...snapshot(),
		truncated: { nodes: true, families: true, relations: true },
	}
	drain(projectEcology(partial, context))
	expect(context.selected).toBe(`state:s`)
	drain(projectEcology(snapshot(), context))
	expect(context.selected).toBeNull()
	expect(context.trace.size).toBe(0)
	expect(context.positions.size).toBe(0)
	expect(context.traceStatus).toBe(`Selection disposed`)
})

it(`caps paint at500 nodes/1000 edges while reporting exact captured totals and matching counts`, () => {
	const nodes = Array.from({ length: 700 }, (_, index) =>
		node(`n${index}`, index < 250 ? `atom` : `selector`),
	)
	const edges = Array.from({ length: 2_000 }, (_, index) => ({
		dependency: `n${index % 200}`,
		selector: `n${250 + Math.floor(index / 200)}`,
	}))
	edges.push(
		{ dependency: `missing`, selector: `n250` },
		{ dependency: `n0`, selector: `n0` },
		{ dependency: `n0`, selector: `n699` },
	)
	const context = createGraphContext()
	const model = drain(projectEcology(snapshot(nodes, edges), context))
	expect(model.items).toHaveLength(500)
	expect(model.edges).toHaveLength(1_000)
	expect(model.matching).toBe(700)
	expect(model).toMatchObject({ atoms: 250, selectors: 450, members: 0 })
	context.trace = new Set([`n0`, `n250`])
	const traced = drain(projectEcology(snapshot(nodes, edges), context))
	expect(traced.edges).toHaveLength(1000)
	expect(traced.edges[0].traced).toBe(true)
	context.query = `n699`
	expect(
		drain(
			projectEcology(snapshot(nodes, edges), context, new Set([`state:n699`])),
		).items.map((item) => item.key),
	).toEqual([`n699`])
	context.query = `does not exist`
	expect(
		drain(projectEcology(snapshot(nodes, edges), context, new Set())).items,
	).toEqual([])
})

it(`never invents a missing family group, handles lower-bound counts and terminates on cycles`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[
				node(`a`, `selector`, `missing`),
				node(`b`, `selector`),
				node(`c`, `selector`),
			],
			[
				{ dependency: `a`, selector: `b` },
				{ dependency: `b`, selector: `c` },
				{ dependency: `c`, selector: `a` },
			],
		),
		families: [
			{
				key: `partial`,
				type: `atom_family`,
				memberCount: 4,
				countComplete: false,
				memberKeys: [],
			},
		],
	}
	const model = drain(projectEcology(data, createGraphContext()))
	expect(model.edges).toHaveLength(3)
	expect(model.items[0].detail).toContain(`4+ members`)
	expect(model.items.map((item) => item.key)).toEqual([`partial`, `a`, `b`, `c`])
})

it(`schedules bounded slices and cancels queued and already-started stale jobs without committing their positions`, () => {
	let clock = 0
	const queue: (() => void)[] = [],
		canceled = vi.fn()
	const schedule = (run: () => void) => {
		queue.push(run)
		return canceled
	}
	const context = createGraphContext(),
		data = snapshot(
			Array.from({ length: 60 }, (_, index) => node(String(index))),
		)
	const done = vi.fn()
	const cancel = scheduleGraph(
		projectEcology(data, context),
		done,
		schedule,
		() => clock++,
	)
	queue.shift()!()
	expect(context.positions.size).toBe(0)
	cancel()
	queue.shift()!()
	expect(canceled).toHaveBeenCalled()
	expect(done).not.toHaveBeenCalled()
	expect(context.positions.size).toBe(0)
	scheduleGraph(projectEcology(data, context), done, schedule, () => clock++)
	while (queue.length) queue.shift()!()
	expect(done).toHaveBeenCalledOnce()
	expect(done.mock.calls[0][1].every((duration: number) => duration <= 8)).toBe(
		true,
	)
	expect(context.positions.size).toBe(60)
})

it(`starts a new job without an explicit cancel callback and never overlaps positions after removals`, () => {
	const context = createGraphContext()
	const first = drain(
		projectEcology(snapshot([node(`a`), node(`b`), node(`c`)]), context),
	)
	const survivor = first.items[2]
	drain(projectEcology(snapshot([node(`b`), node(`c`)]), context))
	const later = drain(
		projectEcology(snapshot([node(`b`), node(`c`), node(`d`)]), context),
	)
	expect(later.items[1].x).not.toBe(survivor.x)
	expect(later.items[2].x).not.toBe(later.items[1].x)
	// A scheduler may deliver synchronously; cancellation before it returns remains safe.
	scheduleGraph(
		projectEcology(snapshot(), createGraphContext()),
		() => {},
		(run) => {
			run()
			return () => {}
		},
		() => 0,
	)()
})

it(`uses the browser timer scheduler and cancels it on disposal`, async () => {
	vi.useFakeTimers({
		toFake: [
			`setTimeout`,
			`clearTimeout`,
			`setInterval`,
			`clearInterval`,
			`Date`,
			`performance`,
		],
	})
	const done = vi.fn()
	scheduleGraph(projectEcology(snapshot(), createGraphContext()), done)
	await vi.runAllTimersAsync()
	expect(done).toHaveBeenCalledOnce()
	const cancel = scheduleGraph(
		projectEcology(snapshot(), createGraphContext()),
		done,
	)
	cancel()
	await vi.runAllTimersAsync()
	expect(done).toHaveBeenCalledOnce()
})

it(`uses equal helical steps with opposite starts and vertical directions, and expands on the tangent`, () => {
	const families = Array.from({ length: 31 }, (_, i) => ({
		key: `group${i}`,
		type: `atom_family`,
		memberCount: 1,
		countComplete: true,
		memberKeys: [`member${i}`],
	}))
	const data: EcologySnapshot = {
		...snapshot([
			...families.map((family, i) => node(`member${i}`, `atom`, family.key)),
			...Array.from({ length: 31 }, (_, i) => node(`s${i}`, `selector`)),
		]),
		families,
	}
	const context = createGraphContext()
	for (const family of families) context.expanded.add(family.key)
	const model = drain(projectEcology(data, context))
	const position = (slot: number, selector: boolean) =>
		model.all.get(selector ? `state:s${slot}` : `family:group${slot}`)!
	const atom = position(0, false),
		selector = position(0, true)
	expect([atom.x, atom.y, atom.z]).toEqual([8, 30, 0])
	expect(selector.x).toBeCloseTo(-8)
	expect(selector.y).toBe(-30)
	for (const lane of [false, true]) {
		let distance = 0
		for (let slot = 0; slot < 30; slot++) {
			const a = position(slot, lane),
				b = position(slot + 1, lane)
			expect(Math.hypot(a.x, a.z)).toBeCloseTo(8)
			expect(b.y - a.y).toBe(lane ? 2 : -2)
			expect(a.x * b.z - a.z * b.x).toBeGreaterThan(0)
			const next = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)
			if (slot) expect(next).toBeCloseTo(distance)
			distance = next
			const anchor = position(slot, false),
				member = model.all.get(`state:member${slot}`)!
			expect(
				(member.x - anchor.x) * anchor.x + (member.z - anchor.z) * anchor.z,
			).toBeCloseTo(0)
			expect(member.y).toBe(anchor.y)
		}
	}
})

it(`retains incoming arrows when a selector family is collapsed`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[node(`a`), node(`sum`, `selector`, `derived`)],
			[{ dependency: `a`, selector: `sum` }],
		),
		families: [
			{
				key: `derived`,
				type: `readonly_selector_family`,
				memberKeys: [`sum`],
				memberCount: 1,
				countComplete: true,
			},
		],
	}
	expect(drain(projectEcology(data, createGraphContext())).edges).toEqual([
		{ from: `state:a`, to: `family:derived`, traced: false },
	])
})
