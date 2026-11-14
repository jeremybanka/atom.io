import { afterEach, expect, it, vi } from "vitest"

import type { EcologyNode, EcologySnapshot } from "../src/ecology.ts"
import {
	createGraphContext,
	graphEdgePath,
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
	])
	expect(model).toMatchObject({ atoms: 2, selectors: 1, members: 2 })
	context.trace = new Set([`b`, `sum`])
	model = drain(projectEcology(withFamilies, context))
	expect(model.edges[0].traced).toBe(true)
	context.expanded.add(`items`)
	model = drain(projectEcology(withFamilies, context))
	expect(model.items).toHaveLength(5)
	expect(model.edges).toEqual([
		{ from: `state:a`, to: `state:sum`, traced: false },
		{ from: `state:b`, to: `state:sum`, traced: true },
	])
	context.query = `unknown`
	expect(
		drain(projectEcology(withFamilies, context)).items.map((item) => item.key),
	).toEqual([`a`, `b`, `sum`])
	context.query = `zero`
	expect(drain(projectEcology(withFamilies, context)).items[0].detail).toContain(
		`0 members`,
	)
})

it(`preserves geometry and context on value-only refresh and safely handles disposal and truncated evidence`, () => {
	const context = createGraphContext(),
		first = snapshot([node(`a`), node(`s`, `selector`)])
	context.selected = `state:s`
	context.trace.add(`a`)
	context.pan = { x: 80, y: 10, zoom: 2 }
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
	expect(context.pan).toEqual({ x: 80, y: 10, zoom: 2 })
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
	context.query = `n699`
	expect(
		drain(projectEcology(snapshot(nodes, edges), context)).items.map(
			(item) => item.key,
		),
	).toEqual([`n699`])
	context.query = `does not exist`
	expect(drain(projectEcology(snapshot(nodes, edges), context)).items).toEqual(
		[],
	)
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
	expect(later.items[1].x).toBe(survivor.x)
	expect(later.items[2].x).not.toBe(survivor.x)
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
	vi.useFakeTimers()
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

it(`routes arrowheads onto facing card boundaries in every direction, including left and below destinations`, () => {
	const origin = { x: 300, y: 300 }
	for (const [to, start, end] of [
		[{ x: 600, y: 300 }, [476, 326], [600, 326]],
		[{ x: 0, y: 300 }, [300, 326], [176, 326]],
		[{ x: 300, y: 600 }, [388, 352], [388, 600]],
		[{ x: 300, y: 0 }, [388, 300], [388, 52]],
		[{ x: 100, y: 400 }, [300, 326], [276, 426]],
		[{ x: 300, y: 360 }, [388, 352], [388, 360]],
		[{ x: 300, y: 240 }, [388, 300], [388, 292]],
	] as const) {
		const numbers = graphEdgePath(origin, to)
			.match(/-?\d+(?:\.\d+)?/g)!
			.map(Number)
		expect(numbers.slice(0, 2)).toEqual(start)
		expect(numbers.slice(-2)).toEqual(end)
		// The final tangent approaches from outside the destination, never through its interior.
		const [cx, cy, ex, ey] = numbers.slice(-4)
		expect(cx <= to.x || cx >= to.x + 176 || cy <= to.y || cy >= to.y + 52).toBe(
			true,
		)
		expect(
			ex === to.x || ex === to.x + 176 || ey === to.y || ey === to.y + 52,
		).toBe(true)
	}
})
