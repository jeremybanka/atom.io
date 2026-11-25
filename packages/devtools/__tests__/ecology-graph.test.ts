import type { TransactionSubEvent } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import type { EcologyNode, EcologySnapshot } from "../src/ecology.ts"
import {
	createGraphContext,
	type GraphHistory,
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
const update = (key: string) => ({
	type: `atom_update` as const,
	token: { type: `atom` as const, key },
	timestamp: 1,
	update: { oldValue: 0, newValue: 1 },
})
const outcome = (subEvents: TransactionSubEvent[], sequence?: number) => ({
	type: `transaction_outcome` as const,
	token: { type: `transaction` as const, key: `save` },
	id: `shared`,
	timestamp: 1,
	params: [],
	output: undefined,
	subEvents,
	...(sequence === undefined ? {} : { timelineOutcomeSequence: sequence }),
})

it(`projects operation links through collapsed families and highlights their direct endpoints`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[node(`entry`, `atom`, `items`), node(`derived`, `selector`)],
			[{ dependency: `entry`, selector: `derived` }],
		),
		families: [
			{
				key: `items`,
				type: `atom_family`,
				memberKeys: [`entry`],
				memberCount: 1,
				countComplete: true,
			},
		],
		operations: {
			truncated: false,
			work: 3,
			records: [
				{
					key: `save`,
					type: `transaction`,
					targets: [
						{ key: `entry`, kind: `state` },
						{ key: `missing`, kind: `state` },
					],
				},
				{
					key: `histories`,
					type: `timeline_family`,
					memberKeys: [`history`, `uncaptured`],
					memberCount: 2,
					countComplete: false,
					targets: [{ key: `items`, kind: `family` }],
				},
				{
					key: `history`,
					type: `timeline`,
					family: { key: `histories`, subKey: `"entry"` },
					at: 0,
					historyLength: 0,
					targets: [{ key: `entry`, kind: `state` }],
				},
			],
		},
	}
	const context = createGraphContext()
	const collapsed = drain(projectEcology(data, context))
	expect(collapsed.edges).toEqual([
		{ from: `state:entry`, to: `state:derived`, traced: false },
		{
			from: `timeline_family:histories`,
			to: `family:items`,
			relation: `timeline`,
			traced: false,
		},
		{
			from: `timeline:history`,
			to: `state:entry`,
			relation: `timeline`,
			traced: false,
		},
	])
	context.expanded.add(`family:items`)
	context.expanded.add(`timeline_family:histories`)
	context.selected = `timeline_family:histories`
	expect(drain(projectEcology(data, context)).selection?.selectedIds).toEqual(
		new Set([`timeline_family:histories`, `timeline:history`]),
	)
	context.selected = `timeline:history`
	const expanded = drain(projectEcology(data, context))
	expect(expanded.edges[0]).toEqual({
		from: `timeline:history`,
		to: `state:entry`,
		relation: `timeline`,
		traced: true,
	})
	expect(expanded.selection?.items).toEqual(
		new Set([
			`timeline:history`,
			`state:entry`,
			`timeline_family:histories`,
			`family:items`,
		]),
	)
	expect(expanded.selection?.edges.size).toBe(0)
	const crowded = {
		...data,
		nodes: [
			...Array.from({ length: 500 }, (_, index) => node(`other-${index}`)),
			...data.nodes,
		],
	}
	context.selected = `state:entry`
	const selected = drain(projectEcology(crowded, context))
	expect(selected.items).toHaveLength(500)
	expect(selected.edges).toContainEqual({
		from: `timeline:history`,
		to: `state:entry`,
		relation: `timeline`,
		traced: true,
	})
})

it(`keeps operation relationships within the card and edge budgets`, () => {
	const nodes = Array.from({ length: 501 }, (_, index) => node(`state-${index}`))
	const targets = nodes.map(({ key }) => ({ kind: `state` as const, key }))
	const records = Array.from({ length: 3 }, (_, index) => ({
		key: `history-${index}`,
		type: `timeline` as const,
		family: null,
		at: 0,
		historyLength: 0,
		targets,
	}))
	const data: EcologySnapshot = {
		...snapshot(nodes),
		operations: { records, truncated: true, work: records.length },
	}
	const context = createGraphContext()
	context.selected = `timeline:uncaptured`
	const matches = new Set(records.map(({ key }) => `timeline:${key}`))
	const overview = drain(projectEcology(data, context, matches))
	expect(context.selected).toBe(`timeline:uncaptured`)
	expect(overview.edges).toHaveLength(1000)
	context.selected = `timeline:history-0`
	const selected = drain(projectEcology(data, context))
	expect(selected.items).toHaveLength(500)
	expect(selected.edges.filter((edge) => edge.traced)).toHaveLength(499)
})

it(`emphasizes ancestors and descendants independently, excluding side branches and bypass edges`, () => {
	const data = snapshot(
		[`a`, `b`, `s`, `t`, `u`, `other`, `side`, `isolated`].map((key) =>
			node(key, key < `c` ? `atom` : `selector`),
		),
		[
			{ dependency: `a`, selector: `s` },
			{ dependency: `b`, selector: `s` },
			{ dependency: `s`, selector: `t` },
			{ dependency: `t`, selector: `u` },
			{ dependency: `other`, selector: `t` },
			{ dependency: `a`, selector: `side` },
			{ dependency: `a`, selector: `t` },
			{ dependency: `missing`, selector: `s` },
			{ dependency: `s`, selector: `t` },
		],
	)
	const context = createGraphContext()
	context.selected = `state:s`
	const model = drain(projectEcology(data, context))
	expect(model.selection!.nodes).toEqual(
		new Set([`s`, `a`, `b`, `missing`, `t`, `u`]),
	)
	expect(model.selection!.items).toEqual(
		new Set([`state:s`, `state:a`, `state:b`, `state:t`, `state:u`]),
	)
	expect(model.selection!.edges).toEqual(new Set([0, 1, 7, 2, 8, 3]))
	expect(model.edges.map((edge) => edge.traced)).toEqual([
		true,
		true,
		true,
		true,
		false,
		false,
		false,
		true,
	])
	const filtered = drain(
		projectEcology(data, context, new Set([`state:s`]), model),
	)
	expect(filtered.selection).toBe(model.selection)
	context.selected = `state:a`
	const atom = drain(projectEcology(data, context, undefined, filtered))
	expect(atom.selection!.nodes).toEqual(new Set([`a`, `s`, `t`, `side`, `u`]))
	expect(atom.selection!.nodes.has(`b`)).toBe(false)
	expect(atom.selection!.nodes.has(`other`)).toBe(false)
	context.selected = null
	const cleared = drain(projectEcology(data, context, undefined, atom))
	expect(cleared.selection).toBeUndefined()
	expect(cleared.edges.every((edge) => !edge.traced)).toBe(true)
})

it(`traces family members through cycles, retains parallel edges and recomputes on refresh`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[
				node(`a`, `atom`, `inputs`),
				node(`s`, `selector`),
				node(`t`, `selector`),
			],
			[
				{ dependency: `a`, selector: `s` },
				{ dependency: `s`, selector: `t` },
				{ dependency: `t`, selector: `s` },
				{ dependency: `a`, selector: `s` },
			],
		),
		families: [
			{
				key: `inputs`,
				type: `atom_family`,
				memberKeys: [`a`],
				memberCount: 1,
				countComplete: true,
			},
		],
	}
	const context = createGraphContext()
	context.selected = `family:inputs`
	const collapsed = drain(projectEcology(data, context))
	expect(collapsed.selection!.items).toEqual(
		new Set([`family:inputs`, `state:a`, `state:s`, `state:t`]),
	)
	expect(collapsed.selection!.selectedIds).toEqual(
		new Set([`family:inputs`, `state:a`]),
	)
	expect(collapsed.edges.every((edge) => edge.traced)).toBe(true)
	expect(collapsed.familyConnections).toEqual([])
	context.expanded.add(`family:inputs`)
	const expanded = drain(projectEcology(data, context, undefined, collapsed))
	expect(expanded.selection).toBe(collapsed.selection)
	expect(expanded.edges[0].from).toBe(`state:a`)
	expect(expanded.familyConnections).toEqual([
		{
			family: `family:inputs`,
			from: expanded.all.get(`family:inputs`),
			to: expanded.all.get(`state:a`),
			color: expanded.all.get(`family:inputs`)!.color,
		},
	])
	const changed = drain(
		projectEcology({ ...data, edges: [] }, context, undefined, expanded),
	)
	expect(changed.selection!.nodes).toEqual(new Set([`a`]))
	expect(changed.selection).not.toBe(expanded.selection)
})

it(`admits all selected family members before related families within the editor row limit`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[
				node(`a`, `atom`, `inputs`),
				node(`b`, `atom`, `inputs`),
				node(`s`, `selector`, `outputs`),
			],
			[{ dependency: `a`, selector: `s` }],
		),
		families: [
			{
				key: `outputs`,
				type: `readonly_pure_selector_family`,
				memberKeys: [`s`],
				memberCount: 1,
				countComplete: true,
			},
			{
				key: `inputs`,
				type: `atom_family`,
				memberKeys: [`a`, `b`],
				memberCount: 2,
				countComplete: true,
			},
		],
	}
	const context = createGraphContext()
	context.selected = `family:inputs`
	context.expanded.add(`family:inputs`)
	context.rowLimit = 3
	const model = drain(projectEcology(data, context))
	expect(model.rows.map((row) => row.id)).toEqual([
		`family:inputs`,
		`state:a`,
		`state:b`,
	])
	expect(model.selection!.selectedIds).toEqual(
		new Set([`family:inputs`, `state:a`, `state:b`]),
	)
	expect(model.selection!.items.has(`family:outputs`)).toBe(true)
})

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
		{ from: `state:a`, to: `state:sum`, traced: false },
		{ from: `state:b`, to: `state:sum`, traced: false },
	])
	expect(model).toMatchObject({ atoms: 2, selectors: 1, members: 2 })
	const point = (id: string) => {
		const { x, y, z } = model.all.get(id)!
		return [x, y, z]
	}
	expect(point(`state:a`)).not.toEqual(point(`family:items`))
	expect(point(`state:b`)).not.toEqual(point(`state:a`))
	context.selected = `state:b`
	model = drain(projectEcology(withFamilies, context))
	expect(model.edges[1].traced).toBe(true)
	context.expanded.add(`family:items`)
	context.expanded.add(`family:zero`)
	model = drain(projectEcology(withFamilies, context))
	expect(model.items).toHaveLength(5)
	expect(point(`state:a`)).not.toEqual(point(`state:b`))
	const anchor = model.all.get(`family:items`)!,
		member = model.all.get(`state:a`)!
	expect(
		(member.x - anchor.x) * anchor.x + (member.z - anchor.z) * anchor.z,
	).toBeCloseTo(0)
	expect(model.familyConnections).toEqual([
		{
			family: `family:items`,
			from: model.all.get(`state:b`),
			to: member,
			color: anchor.color,
		},
	])
	expect(model.edges).toEqual([
		{ from: `state:a`, to: `state:sum`, traced: false },
		{ from: `state:b`, to: `state:sum`, traced: true },
	])
	context.selected = null
	context.query = `unknown`
	expect(
		drain(
			projectEcology(
				withFamilies,
				context,
				new Set([`state:a`, `state:b`, `state:sum`]),
			),
		).rows.map((item) => item.key),
	).toEqual([`items`, `a`, `b`, `sum`])
	context.query = `zero`
	expect(
		drain(projectEcology(withFamilies, context, new Set([`family:zero`])))
			.rows[0].detail,
	).toContain(`0 members`)
})

it(`bounds family connections to painted members, including when the family card is outside the cap`, () => {
	const members = Array.from({ length: 500 }, (_, index) =>
		node(`member${index}`, `atom`, `members`),
	)
	const others = Array.from({ length: 499 }, (_, index) => node(`other${index}`))
	const data: EcologySnapshot = {
		...snapshot([...members, ...others]),
		families: [
			{
				key: `members`,
				type: `atom_family`,
				memberKeys: members.map((member) => member.key),
				memberCount: 500,
				countComplete: true,
			},
		],
	}
	const context = createGraphContext()
	context.expanded.add(`family:members`)
	const model = drain(
		projectEcology(
			data,
			context,
			new Set(members.map((member) => `state:${member.key}`)),
		),
	)
	expect(model.items).toHaveLength(500)
	expect(model.items.some((item) => item.id === `family:members`)).toBe(false)
	expect(model.familyConnections).toEqual([
		{
			family: `family:members`,
			from: model.all.get(`state:member499`),
			to: model.all.get(`state:member498`),
			color: model.all.get(`family:members`)!.color,
		},
	])
	const isolated = drain(
		projectEcology(
			data,
			context,
			new Set([`state:member0`, ...others.map((other) => `state:${other.key}`)]),
			model,
		),
	)
	expect(isolated.familyConnections).toEqual([])
	context.expanded.clear()
	expect(
		drain(projectEcology(data, context, undefined, model)).familyConnections,
	).toEqual([])
})

it(`preserves geometry and context on value-only refresh and safely handles disposal and truncated evidence`, () => {
	const context = createGraphContext(),
		first = snapshot([node(`a`), node(`s`, `selector`)])
	context.selected = `state:s`
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
	expect(context.positions.size).toBe(0)
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
	context.selected = `state:n0`
	const traced = drain(projectEcology(snapshot(nodes, edges), context))
	expect(traced.edges).toHaveLength(1000)
	expect(traced.edges[0].traced).toBe(true)
	context.query = `n699`
	expect(
		drain(
			projectEcology(snapshot(nodes, edges), context, new Set([`state:n699`])),
		).rows.map((item) => item.key),
	).toEqual([`n699`])
	context.query = `does not exist`
	expect(
		drain(projectEcology(snapshot(nodes, edges), context, new Set())).rows,
	).toEqual([])
})

it(`admits operation anchors and links on a saturated overview`, () => {
	const records = Array.from({ length: 30 }, (_, index) => ({
		type: `transaction` as const,
		key: `save-${index}`,
		targets: [{ kind: `state` as const, key: `late` }],
	}))
	const data: EcologySnapshot = {
		...snapshot(
			[
				node(`first`),
				node(`selected`, `selector`),
				...Array.from({ length: 600 }, (_, index) => node(`n${index}`)),
				node(`late`),
			],
			Array.from({ length: 1_100 }, () => ({
				dependency: `first`,
				selector: `selected`,
			})),
		),
		operations: { records, work: records.length, truncated: false },
	}
	const histories = new Map<string, GraphHistory>(
		records.map(({ key }) => [
			`transaction:${key}`,
			{ events: [outcome([update(`late`)])] },
		]),
	)
	const model = drain(
		projectEcology(data, createGraphContext(), undefined, undefined, histories),
	)
	expect(model.items).toHaveLength(500)
	expect(model.edges).toHaveLength(1_000)
	expect(model.items.filter((item) => item.kind === `transaction`)).toHaveLength(
		25,
	)
	expect(model.edges.filter((edge) => edge.relation)).toHaveLength(25)
	expect(model.edges).toContainEqual({
		from: expect.stringMatching(/^history:transaction:save-0:/),
		to: `state:late`,
		relation: `transaction`,
		traced: false,
	})
})

it(`routes exact history occurrences through collapsed anchors and leaves timeline scope on its owner`, () => {
	const data: EcologySnapshot = {
		...snapshot([
			node(`count`),
			node(`scope`),
			node(`other`),
			node(`derived`, `selector`),
			{ ...node(`mutable`), type: `mutable_atom` },
			node(`*mutable`),
			node(`items("member")`),
		]),
		operations: {
			records: [
				{
					type: `transaction`,
					key: `save`,
					targets: [{ kind: `state`, key: `other` }],
				},
				{
					type: `timeline`,
					key: `count`,
					at: 2,
					historyLength: 2,
					family: null,
					targets: [{ kind: `state`, key: `scope` }],
				},
			],
			truncated: false,
			work: 2,
		},
	}
	const nested = outcome([
		update(`*mutable`),
		update(`missing`),
		{
			type: `molecule_creation`,
			timestamp: 1,
			key: `member`,
			provenance: `root`,
		},
		{
			type: `molecule_disposal`,
			timestamp: 1,
			key: `member`,
			provenance: [],
			values: [[`items`, 0]],
		},
	])
	const earlier = outcome([update(`other`)], 6)
	const saved = outcome([update(`other`), update(`count`), nested], 7)
	const recorded = outcome([update(`count`), update(`count`)], 7)
	const selector = {
		type: `selector_update` as const,
		token: { type: `writable_pure_selector` as const, key: `derived` },
		timestamp: 2,
		subEvents: [update(`count`)],
	}
	const histories = new Map<string, GraphHistory>([
		[`transaction:save`, { events: [earlier, saved] }],
		[`timeline:count`, { events: [recorded, selector], at: 2 }],
	])
	const context = createGraphContext()
	context.selected = `state:count`
	const collapsed = drain(
		projectEcology(data, context, undefined, undefined, histories),
	)
	const endpoint = (event: object) =>
		[...collapsed.historyEndpoints.values()].find(
			(entry) => entry.event === event,
		)!
	const targets = (event: object) =>
		collapsed.edges
			.filter((edge) => edge.from === endpoint(event).item.id)
			.map((edge) => edge.to)
	expect(targets(saved)).toEqual([
		`state:count`,
		`state:other`,
		`state:mutable`,
		`state:items("member")`,
	])
	expect(targets(recorded)).toEqual([`state:count`, endpoint(saved).item.id])
	expect(targets(selector)).toEqual([`state:count`, `state:derived`])
	expect(collapsed.edges).toContainEqual({
		from: `timeline:count`,
		to: `state:scope`,
		relation: `timeline`,
		traced: false,
	})
	expect(collapsed.edges.some((edge) => edge.from === `transaction:save`)).toBe(
		false,
	)
	expect([...collapsed.historyFocus]).toEqual(
		expect.arrayContaining([`timeline:count`, `transaction:save`]),
	)
	expect(collapsed.items.some((item) => item.history)).toBe(false)
	expect(endpoint(saved).card.id).toBe(`transaction:save`)
	expect(endpoint(saved).item).toMatchObject(endpoint(saved).item.cluster!)
	expect(endpoint(saved).item.cluster).not.toEqual(
		endpoint(earlier).item.cluster,
	)
	context.expanded.add(`timeline:count`)
	context.expanded.add(`transaction:save`)
	const expanded = drain(
		projectEcology(data, context, undefined, collapsed, histories),
	)
	for (const event of [saved, recorded]) {
		const id = endpoint(event).item.id
		expect(expanded.historyEndpoints.get(id)?.card.id).toBe(id)
		expect(expanded.items.some((item) => item.id === id)).toBe(true)
	}
	expect(expanded.edges).toContainEqual(
		expect.objectContaining({
			from: endpoint(recorded).item.id,
			to: endpoint(saved).item.id,
		}),
	)
})

it(`shares the paint cap with live history and keeps both sides of the timeline cursor`, () => {
	const data: EcologySnapshot = {
		...snapshot([node(`a`)]),
		operations: {
			records: [
				{
					type: `timeline`,
					key: `a`,
					family: null,
					at: 300,
					historyLength: 600,
					targets: [{ kind: `state`, key: `a` }],
				},
				{ type: `transaction`, key: `save` },
			],
			work: 2,
			truncated: false,
		},
	}
	const events = Array.from({ length: 600 }, (_, index) => ({
		type: `molecule_creation` as const,
		key: index,
		provenance: `root`,
		timestamp: index,
	}))
	const histories = new Map<string, GraphHistory>([
		[`timeline:a`, { events, at: 300 }],
		[`transaction:save`, { events }],
	])
	const context = createGraphContext()
	context.selected = `timeline:a`
	context.expanded.add(`transaction:save`)
	context.expanded.add(`timeline:a`)
	const matches = new Set([`timeline:a`, `transaction:save`])
	const model = drain(
		projectEcology(data, context, matches, undefined, histories),
	)
	expect(model.items).toHaveLength(500)
	expect(model.edges).toMatchObject([{ from: `timeline:a`, to: `state:a` }])
	expect(
		model.items.filter((item) => item.history?.direction === `past`),
	).toHaveLength(249)
	expect(
		model.items.filter((item) => item.history?.direction === `future`),
	).toHaveLength(248)
	expect(model.historyConnections).toMatchObject([
		{
			family: `timeline:a`,
			from: { label: `molecule creation`, history: { direction: `future` } },
			to: { history: { direction: `past` } },
		},
	])
	context.expanded.delete(`timeline:a`)
	const outcomes = drain(
		projectEcology(data, context, matches, model, histories),
	)
	expect(outcomes.items).toHaveLength(500)
	expect(outcomes.items[3].label).toBe(`Outcome 104`)
	expect(outcomes.items.at(-1)?.label).toBe(`Outcome 600`)
	expect(outcomes.historyConnections).toMatchObject([
		{
			family: `transaction:save`,
			from: { label: `Outcome 600` },
			to: { id: `transaction:save` },
		},
	])
	context.expanded.add(`timeline:a`)
	const atStart = drain(
		projectEcology(
			data,
			context,
			matches,
			outcomes,
			new Map([
				[`timeline:a`, { events: events.slice(0, 2), at: 0 }],
				[`transaction:save`, { events: [] }],
			]),
		),
	)
	expect(atStart.items.filter((item) => item.history)).toHaveLength(2)
	expect(atStart.historyConnections).toMatchObject([
		{
			family: `timeline:a`,
			from: { history: { direction: `future` } },
			to: { id: `timeline:a` },
		},
	])
})

it(`bounds collapsed family histories and skips routes to states outside the painted graph`, () => {
	const memberKeys = Array.from(
		{ length: 501 },
		(_, index) => `history-${index}`,
	)
	const data: EcologySnapshot = {
		...snapshot([
			node(`visible`),
			...Array.from({ length: 500 }, (_, index) => node(`state-${index}`)),
			node(`offscreen`),
		]),
		operations: {
			records: [
				{
					type: `timeline_family`,
					key: `history`,
					memberKeys,
					memberCount: memberKeys.length,
					countComplete: true,
				},
				...memberKeys.map((key, index) => ({
					type: `timeline` as const,
					key,
					family: { key: `history`, subKey: String(index) },
					at: 0,
					historyLength: 0,
				})),
				{ type: `transaction`, key: `save` },
			],
			work: memberKeys.length + 2,
			truncated: false,
		},
	}
	const event = outcome([
		update(`offscreen`),
		update(`visible`),
		...Array.from({ length: 10_000 }, () => update(`visible`)),
	])
	const histories = new Map<string, GraphHistory>([
		[`timeline:history-0`, { events: [event], at: 1 }],
	])
	const context = createGraphContext()
	context.expanded.add(`timeline:history-0`)
	const model = drain(
		projectEcology(data, context, undefined, undefined, histories),
	)
	expect(model.historyOwners).toHaveLength(500)
	expect(model.historyOwners[0].id).toBe(`transaction:save`)
	const entry = [...model.historyEndpoints.values()][0]
	expect(entry.card.id).toBe(`timeline_family:history`)
	expect(model.edges).toEqual([
		{
			from: entry.item.id,
			to: `state:visible`,
			relation: `timeline`,
			traced: false,
		},
	])
})

it(`preserves the selected anchor when expanded operations fill the paint cap`, () => {
	const records = Array.from({ length: 501 }, (_, index) => ({
		type: `transaction` as const,
		key: String(index),
	}))
	const context = createGraphContext()
	context.selected = `transaction:500`
	for (const record of records) context.expanded.add(`transaction:${record.key}`)
	const model = drain(
		projectEcology(
			{
				...snapshot(),
				operations: { records, work: records.length, truncated: false },
			},
			context,
		),
	)
	expect(model.items).toHaveLength(500)
	expect(model.items.at(-1)?.id).toBe(context.selected)
	expect(model.historyConnections).toEqual([])
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

it(`keeps parallel helices opposite at every shared height, with equal steps and tangent expansion`, () => {
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
	for (const family of families) context.expanded.add(`family:${family.key}`)
	const model = drain(projectEcology(data, context))
	const position = (slot: number, selector: boolean) =>
		model.all.get(selector ? `state:s${slot}` : `family:group${slot}`)!
	const atom = position(0, false),
		selector = position(0, true)
	expect([atom.x, atom.y, atom.z]).toEqual([8, 30, 0])
	expect(selector.y).toBe(-30)
	for (let slot = 0; slot < 31; slot++) {
		const a = position(30 - slot, false),
			b = position(slot, true)
		expect(a.y).toBe(b.y)
		expect(a.x).toBeCloseTo(-b.x)
		expect(a.z).toBeCloseTo(-b.z)
	}
	for (const lane of [false, true]) {
		let distance = 0
		for (let slot = 0; slot < 30; slot++) {
			const a = position(slot, lane),
				b = position(slot + 1, lane)
			expect(Math.hypot(a.x, a.z)).toBeCloseTo(8)
			expect(b.y - a.y).toBe(lane ? 2 : -2)
			// Bottom-up insertion reverses the angular step, keeping the spatial winding parallel.
			expect((a.x * b.z - a.z * b.x) * (lane ? -1 : 1)).toBeGreaterThan(0)
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

it.each([
	[3, 3],
	[5, 7],
	[12, 9],
	[17, 6],
])(
	`keeps opposing paths separate with %i atom and %i selector anchors`,
	(atoms, selectors) => {
		const data = snapshot([
			...Array.from({ length: atoms }, (_, index) => node(`a${index}`)),
			...Array.from({ length: selectors }, (_, index) =>
				node(`s${index}`, `selector`),
			),
		])
		const model = drain(projectEcology(data, createGraphContext()))
		let compared = 0
		for (const selector of model.items.filter(
			(item) => item.kind === `selector`,
		)) {
			const atom = model.items.find(
				(item) => item.kind === `atom` && item.y === selector.y,
			)
			if (atom) {
				expect(atom.x).toBeCloseTo(-selector.x)
				expect(atom.z).toBeCloseTo(-selector.z)
				compared++
			}
		}
		expect(compared).toBeGreaterThan(0)
	},
)

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
		{ from: `state:a`, to: `state:sum`, traced: false },
	])
})

it(`keeps lazy metadata immutable across equal-sized expansion changes and ignores stale matching IDs`, () => {
	const data: EcologySnapshot = {
		...snapshot(
			[
				node(`a`, `atom`, `inputs`),
				node(`s1`, `selector`, `derived`),
				node(`s2`, `selector`, `derived`),
			],
			[
				{ dependency: `a`, selector: `s1` },
				{ dependency: `a`, selector: `s2` },
				{ dependency: `s1`, selector: `s2` },
			],
		),
		families: [
			{
				key: `inputs`,
				type: `atom_family`,
				memberKeys: [`a`],
				memberCount: 1,
				countComplete: true,
			},
			{
				key: `derived`,
				type: `readonly_selector_family`,
				memberKeys: [`s1`, `s2`],
				memberCount: 2,
				countComplete: true,
			},
		],
	}
	const context = createGraphContext()
	context.expanded.add(`family:derived`)
	const first = drain(projectEcology(data, context)),
		member = first.all.get(`state:s1`)!
	const before = [member.x, member.y, member.z]
	context.expanded = new Set([`inputs`])
	const next = drain(projectEcology(data, context, undefined, first))
	expect(next.all).not.toBe(first.all)
	expect(first.all.expanded.has(`family:derived`)).toBe(true)
	expect([member.x, member.y, member.z]).toEqual(before)
	const collapsed = next.all.get(`state:s1`)!,
		group = next.all.get(`family:derived`)!
	expect(
		Math.hypot(
			collapsed.x - group.x,
			collapsed.y - group.y,
			collapsed.z - group.z,
		),
	).toBeLessThan(0.45)
	expect([collapsed.x, collapsed.y, collapsed.z]).not.toEqual([
		group.x,
		group.y,
		group.z,
	])
	expect(next.all.get(`invalid`)).toBeUndefined()
	expect(next.all.has(`invalid`)).toBe(false)
	const stale = drain(
		projectEcology(
			data,
			context,
			new Set([`invalid`, `state:disposed`, `family:disposed`]),
			next,
		),
	)
	expect(stale.rows).toEqual([])
	expect(stale.items.length).toBeGreaterThan(0)
	expect(stale.matching).toBe(0)
})

it(`keeps clustered member endpoints distinct, bounded and stable without admitting their cards`, () => {
	const members = Array.from({ length: 100 }, (_, index) =>
		node(`input${index}`, `atom`, `inputs`),
	)
	const data: EcologySnapshot = {
		...snapshot(
			[...members, node(`sum`, `selector`)],
			members.map((member) => ({ dependency: member.key, selector: `sum` })),
		),
		families: [
			{
				key: `inputs`,
				type: `atom_family`,
				memberKeys: members.map((member) => member.key),
				memberCount: members.length,
				countComplete: true,
			},
		],
	}
	const context = createGraphContext()
	const first = drain(projectEcology(data, context))
	expect(first.items.map((item) => item.id)).toEqual([
		`family:inputs`,
		`state:sum`,
	])
	expect(first.edges).toHaveLength(100)
	const anchor = first.all.get(`family:inputs`)!
	const points = members.map((member) => first.all.get(`state:${member.key}`)!)
	const positions = points.map(({ x, y, z }) => [x, y, z])
	expect(new Set(positions.map((point) => point.join(`,`))).size).toBe(100)
	for (const point of points) {
		const distance = Math.hypot(
			point.x - anchor.x,
			point.y - anchor.y,
			point.z - anchor.z,
		)
		expect(distance).toBeGreaterThan(0)
		expect(distance).toBeLessThan(0.45)
	}
	expect(
		points.filter(
			(point) =>
				Math.hypot(point.x - anchor.x, point.y - anchor.y, point.z - anchor.z) <
				0.225,
		).length,
	).toBeGreaterThan(40)
	const filtered = drain(
		projectEcology(
			data,
			context,
			new Set([`state:input10`, `state:sum`]),
			first,
		),
	)
	expect(
		members.map((member) => filtered.all.get(`state:${member.key}`)),
	).toEqual(points)
	context.expanded.add(`family:inputs`)
	const expanded = drain(projectEcology(data, context, undefined, filtered))
	expect(expanded.items).toHaveLength(102)
	expect(expanded.all.get(`state:input0`)!.x).not.toBe(points[0].x)
	context.expanded.clear()
	const clustered = drain(projectEcology(data, context, undefined, expanded))
	expect(
		members.map((member) => clustered.all.get(`state:${member.key}`)),
	).toEqual(points)
	const refreshed = drain(
		projectEcology(
			{
				...data,
				nodes: [...data.nodes, node(`later`, `atom`, `inputs`)],
				families: [
					{
						...data.families[0],
						memberKeys: [...data.families[0].memberKeys, `later`],
						memberCount: 101,
					},
				],
			},
			context,
		),
	)
	expect(
		members.map((member) => {
			const { x, y, z } = refreshed.all.get(`state:${member.key}`)!
			return [x, y, z]
		}),
	).toEqual(positions)
})
