import type { EcologyFamily, EcologyNode, EcologySnapshot } from "./ecology.ts"
import { ecologyColor } from "./ecology-color.ts"
import { scheduleTask } from "./task.ts"

export interface GraphPosition {
	x: number
	y: number
	z: number
}
export interface GraphItem extends GraphPosition {
	id: string
	key: string
	kind: `atom` | `selector` | `family`
	label: string
	familyLabel?: string | undefined
	cluster?: GraphPosition | undefined
	detail: string
	color: string
	source: EcologyNode | EcologyFamily
}
export interface FamilyConnection {
	family: string
	from: GraphItem
	to: GraphItem
	color: string
}
interface GraphEdge {
	from: string
	to: string
	traced: boolean
}
export interface GraphContext {
	rowLimit?: number
	snapshot?: EcologySnapshot
	capturedAt: string
	query: string
	expanded: Set<string>
	selected: string | null
	trace: Set<string>
	traceStatus: string
	positions: Map<string, GraphPosition>
	camera?: {
		position: [number, number, number]
		target: [number, number, number]
		aspect?: number
	}
}
interface GraphRecord {
	id: string
	source: EcologyNode | EcologyFamily
	slot: number
	order: number
	group: GraphRecord | undefined
}
interface GraphLayout {
	families: Map<string, GraphRecord>
	nodes: Map<string, GraphRecord>
	ordered: GraphRecord[]
	groupSelectors: Map<GraphRecord, string[]>
	edgeIndex: Map<string, number[]>
	dependents: Map<string, number[]>
	collapsed: Map<GraphRecord, GraphItem>
	expanded: Map<GraphRecord, GraphItem>
	height: number
	atoms: number
	selectors: number
	members: number
}
interface GraphRegistry {
	layout: GraphLayout
	expanded: ReadonlySet<string>
	visible: GraphRecord[]
	get(id: string): GraphItem | undefined
	has(id: string): boolean
}
export interface GraphModel {
	snapshot: EcologySnapshot
	items: GraphItem[]
	rows: GraphItem[]
	rowCount: number
	matches: ReadonlySet<string> | undefined
	edges: GraphEdge[]
	familyConnections: FamilyConnection[]
	all: GraphRegistry
	matching: number
	atoms: number
	selectors: number
	members: number
	newPositions: number
	selection: GraphSelection | undefined
	cylinderHeight: number
}
interface GraphSelection {
	id: string
	selectedIds: Set<string>
	nodes: Set<string>
	items: Set<string>
	edges: Set<number>
}
export function createGraphContext(): GraphContext {
	return {
		capturedAt: ``,
		query: ``,
		expanded: new Set(),
		selected: null,
		trace: new Set(),
		traceStatus: `Not traced`,
		positions: new Map(),
	}
}

/** Equal arc-length steps on two opposed helices. The cylinder and paths are mathematical only. */
function helixPosition(
	slot: number,
	selector: boolean,
	height: number,
): GraphPosition {
	// Both paths have the same winding at a given height, although selectors are added bottom-up.
	const depth = selector ? height / 2 - slot : slot
	const angle = (depth * Math.PI) / 4 + (selector ? Math.PI : 0)
	return {
		x: 8 * Math.cos(angle),
		y: selector ? -height / 2 + slot * 2 : height / 2 - slot * 2,
		z: 8 * Math.sin(angle),
	}
}
/** Fan out on the horizontal tangent, leaving the family card at its anchor. */
function familyOffset(member: number): number {
	return (Math.floor(member / 2) + 1) * (member % 2 ? -1 : 1) * 12
}
function familyPosition(anchor: GraphPosition, member: number): GraphPosition {
	const offset = familyOffset(member)
	return {
		x: anchor.x - (anchor.z / 8) * offset,
		y: anchor.y,
		z: anchor.z + (anchor.x / 8) * offset,
	}
}

/** A bounded, deterministic cloud with more members near the center than the fringe. */
function clusterPosition(anchor: GraphPosition, member: number): GraphPosition {
	const step = member + 1
	const angle = step * Math.PI * (3 - Math.sqrt(5))
	const vertical = ((step * Math.SQRT2) % 1) * 2 - 1
	const radius = ((step * Math.sqrt(3)) % 1) * 0.45
	const horizontal = Math.sqrt(1 - vertical * vertical) * radius
	return {
		x: anchor.x + Math.cos(angle) * horizontal,
		y: anchor.y + vertical * radius,
		z: anchor.z + Math.sin(angle) * horizontal,
	}
}

/** Build capture-local ordering and adjacency once, without preparing offscreen cards or geometry. */
function* indexGraph(snapshot: EcologySnapshot): Generator<void, GraphLayout> {
	const layout: GraphLayout = {
		families: new Map(),
		nodes: new Map(),
		ordered: [],
		groupSelectors: new Map(),
		edgeIndex: new Map(),
		dependents: new Map(),
		collapsed: new Map(),
		expanded: new Map(),
		height: 8,
		atoms: 0,
		selectors: 0,
		members: 0,
	}
	const slots = { atom: 0, selector: 0 },
		members = new Map<GraphRecord, number>()
	for (const source of snapshot.families) {
		const lane = source.type.includes(`selector`) ? `selector` : `atom`
		const record: GraphRecord = {
			id: `family:${source.key}`,
			source,
			slot: slots[lane]++,
			order: layout.ordered.length,
			group: undefined,
		}
		layout.families.set(source.key, record)
		layout.ordered.push(record)
		yield
	}
	for (const source of snapshot.nodes) {
		if (source.kind === `atom`) layout.atoms++
		else layout.selectors++
		if (source.family) layout.members++
		const group = source.family
			? layout.families.get(source.family.key)
			: undefined
		const slot = group ? (members.get(group) ?? 0) : slots[source.kind]++
		if (group) members.set(group, slot + 1)
		const record: GraphRecord = {
			id: `state:${source.key}`,
			source,
			slot,
			order: layout.ordered.length,
			group,
		}
		layout.nodes.set(source.key, record)
		layout.ordered.push(record)
		if (group && source.kind === `selector`) {
			let keys = layout.groupSelectors.get(group)
			if (!keys) layout.groupSelectors.set(group, (keys = []))
			keys.push(source.key)
		}
		yield
	}
	layout.height = Math.max(8, (Math.max(slots.atom, slots.selector) - 1) * 2)
	for (let index = 0; index < snapshot.edges.length; index++) {
		const key = snapshot.edges[index].selector
		let indices = layout.edgeIndex.get(key)
		if (!indices) layout.edgeIndex.set(key, (indices = []))
		indices.push(index)
		const dependency = snapshot.edges[index].dependency
		let consumers = layout.dependents.get(dependency)
		if (!consumers) layout.dependents.set(dependency, (consumers = []))
		consumers.push(index)
		yield
	}
	return layout
}
function resolveRecord(
	layout: GraphLayout,
	id: string,
): GraphRecord | undefined {
	if (id.startsWith(`family:`)) return layout.families.get(id.slice(7))
	if (id.startsWith(`state:`)) return layout.nodes.get(id.slice(6))
	return undefined
}

/** Walk each direction independently: never turn onto an ancestor's offshoot or a consumer's other roots. */
function* traceSelection(
	snapshot: EcologySnapshot,
	layout: GraphLayout,
	selected: GraphRecord,
): Generator<void, GraphSelection> {
	const source = selected.source
	const seeds = `memberKeys` in source ? source.memberKeys : [source.key]
	const selection: GraphSelection = {
		id: selected.id,
		selectedIds: new Set([selected.id]),
		nodes: new Set(seeds),
		items: new Set([selected.id]),
		edges: new Set(),
	}
	for (const upstream of [true, false]) {
		const visited = new Set(seeds),
			queue = [...seeds]
		for (const key of queue) {
			for (const index of (upstream ? layout.edgeIndex : layout.dependents).get(
				key,
			) ?? []) {
				const edge = snapshot.edges[index]
				const next = upstream ? edge.dependency : edge.selector
				selection.edges.add(index)
				selection.nodes.add(next)
				if (!visited.has(next)) {
					visited.add(next)
					queue.push(next)
				}
				yield
			}
			yield
		}
	}
	for (const key of selection.nodes) {
		const record = layout.nodes.get(key)
		if (record) {
			selection.items.add(record.id)
			if (record.group === selected) selection.selectedIds.add(record.id)
			if (record.group) selection.items.add(record.group.id)
		}
		yield
	}
	return selection
}
/** Memoize immutable cards only as the UI admits or inspects them. Expansion gets its own cached coordinates. */
function createRegistry(
	layout: GraphLayout,
	expansion: ReadonlySet<string>,
): GraphRegistry {
	const expanded = new Set(expansion)
	const read = (record: GraphRecord): GraphItem => {
		const fan = Boolean(record.group && expanded.has(record.group.source.key))
		const cache = fan ? layout.expanded : layout.collapsed
		const prior = cache.get(record)
		if (prior) return prior
		const source = record.source
		const member = `family` in source ? source.family : undefined
		const kind = `kind` in source ? source.kind : `family`
		const cluster = record.group
			? clusterPosition(read(record.group), record.slot)
			: undefined
		const position = record.group
			? fan
				? familyPosition(read(record.group), record.slot)
				: cluster!
			: helixPosition(
					record.slot,
					kind === `selector` ||
						(kind === `family` && source.type.includes(`selector`)),
					layout.height,
				)
		const item: GraphItem = {
			id: record.id,
			key: source.key,
			kind,
			label: member?.subKey ?? source.key,
			familyLabel: member?.key,
			cluster,
			color: ecologyColor(source),
			detail:
				`memberKeys` in source
					? `${source.type} · ${source.memberCount}${source.countComplete ? `` : `+`} members`
					: `${source.kind} · ${source.value.status === `cached` ? `cached ${source.value.type}` : `not cached / unknown`}`,
			source,
			x: position.x,
			y: position.y,
			z: position.z,
		}
		cache.set(record, item)
		return item
	}
	return {
		layout,
		expanded,
		visible: layout.ordered.filter(
			(record) => !record.group || expanded.has(record.group.source.key),
		),
		get(id) {
			const record = resolveRecord(layout, id)
			return record ? read(record) : undefined
		},
		has(id) {
			return Boolean(resolveRecord(layout, id))
		},
	}
}

/** Project admitted records, retaining capture order and raw parallel edges. Nothing publishes before completion. */
export function* projectEcology(
	snapshot: EcologySnapshot,
	context: GraphContext,
	matchedIds?: ReadonlySet<string>,
	previous?: GraphModel,
): Generator<void, GraphModel> {
	if (previous?.snapshot !== snapshot) previous = undefined
	const layout = previous?.all.layout ?? (yield* indexGraph(snapshot))
	const all =
		previous &&
		previous.all.expanded.size === context.expanded.size &&
		[...context.expanded].every((key) => previous.all.expanded.has(key))
			? previous.all
			: createRegistry(layout, context.expanded)
	const matchingRecords = new Set<GraphRecord>()
	if (matchedIds)
		for (const id of matchedIds) {
			const record = resolveRecord(layout, id)
			if (record)
				matchingRecords.add(
					record.group && !all.expanded.has(record.group.source.key)
						? record.group
						: record,
				)
			yield
		}
	const ordered = matchedIds
		? [...matchingRecords].sort((a, b) => a.order - b.order)
		: all.visible
	const admitted = ordered.slice(0, 500)
	const admittedSet = new Set(admitted)
	for (const record of all.visible) {
		if (admitted.length === 500) break
		if (!admittedSet.has(record)) {
			admitted.push(record)
			admittedSet.add(record)
		}
		yield
	}
	const selected = context.selected
		? resolveRecord(layout, context.selected)
		: undefined
	const selection = selected
		? previous?.selection?.id === selected.id
			? previous.selection
			: yield* traceSelection(snapshot, layout, selected)
		: undefined
	const selectedCard =
		selected?.group && !all.expanded.has(selected.group.source.key)
			? selected.group
			: selected
	if (selectedCard && !admitted.includes(selectedCard)) {
		admitted.pop()
		admitted.push(selectedCard)
	}
	// Matching records get admission priority, while retained cards keep their DOM slots.
	admitted.sort((a, b) => a.order - b.order)
	const rowRecords = new Set<GraphRecord>()
	if (matchedIds) {
		for (const id of matchedIds) {
			const record = resolveRecord(layout, id)
			if (record) {
				rowRecords.add(record)
				if (record.group) rowRecords.add(record.group)
			}
			yield
		}
	} else
		for (const record of all.visible) {
			rowRecords.add(record)
			yield
		}
	if (selected && (!matchedIds || matchedIds.has(selected.id)))
		rowRecords.add(selected)
	const priority = (record: GraphRecord) =>
		selection?.selectedIds.has(record.id)
			? 0
			: selection?.items.has(record.id)
				? 1
				: 2
	const rowOrder = [...rowRecords].sort((a, b) => {
		return (
			priority(a) - priority(b) ||
			(a.group?.order ?? a.order) - (b.group?.order ?? b.order) ||
			a.order - b.order
		)
	})
	const rows: GraphItem[] = []
	for (const record of rowOrder.slice(0, context.rowLimit ?? 50)) {
		rows.push(all.get(record.id)!)
		yield
	}
	const items: GraphItem[] = [],
		edges: GraphEdge[] = [],
		painted = new Set<string>(),
		selectorKeys: string[] = []
	const pending = new Map<string, GraphPosition>()
	const familySpans = new Map<
		GraphRecord,
		{
			from: GraphItem
			to: GraphItem
			low: number
			high: number
		}
	>()
	let newPositions = 0
	for (const record of admitted) {
		const item = all.get(record.id)!
		items.push(item)
		painted.add(item.id)
		const family =
			record.group ??
			(`memberKeys` in record.source && all.expanded.has(record.source.key)
				? record
				: undefined)
		if (family) {
			const offset = record.group ? familyOffset(record.slot) : 0
			const span = familySpans.get(family)
			if (!span)
				familySpans.set(family, {
					from: item,
					to: item,
					low: offset,
					high: offset,
				})
			else {
				if (offset < span.low) {
					span.low = offset
					span.from = item
				}
				if (offset > span.high) {
					span.high = offset
					span.to = item
				}
			}
		}
		const prior = context.positions.get(item.id)
		if (!prior) newPositions++
		pending.set(
			item.id,
			prior && prior.x === item.x && prior.y === item.y && prior.z === item.z
				? prior
				: { x: item.x, y: item.y, z: item.z },
		)
		if (`kind` in record.source) {
			if (record.source.kind === `selector`) selectorKeys.push(record.source.key)
		} else if (!all.expanded.has(record.source.key))
			selectorKeys.push(...(layout.groupSelectors.get(record) ?? []))
		yield
	}
	const familyConnections: FamilyConnection[] = []
	for (const [family, span] of familySpans) {
		if (span.from !== span.to)
			familyConnections.push({
				family: family.source.key,
				from: span.from,
				to: span.to,
				color: all.get(family.id)!.color,
			})
		yield
	}
	const candidates: number[] = []
	for (const key of selectorKeys) {
		for (const index of layout.edgeIndex.get(key) ?? []) {
			candidates.push(index)
			yield
		}
		yield
	}
	candidates.sort((a, b) => a - b)
	const endpoint = (key: string) => {
		const record = layout.nodes.get(key)
		return record?.group && !all.expanded.has(record.group.source.key)
			? record.group.id
			: record?.id
	}
	for (const index of candidates) {
		const edge = snapshot.edges[index],
			from = endpoint(edge.dependency),
			to = endpoint(edge.selector)
		if (from && to && painted.has(from) && painted.has(to))
			edges.push({
				from: `state:${edge.dependency}`,
				to: `state:${edge.selector}`,
				traced:
					selection?.edges.has(index) ??
					(context.trace.has(edge.dependency) &&
						context.trace.has(edge.selector)),
			})
		if (edges.length === 1_000) break
		yield
	}
	const removed: string[] = []
	if (!previous)
		for (const id of context.positions.keys()) {
			if (!all.has(id)) removed.push(id)
			yield
		}
	for (const id of removed) context.positions.delete(id)
	for (const [id, position] of pending) context.positions.set(id, position)
	if (
		context.selected &&
		!all.has(context.selected) &&
		!snapshot.truncated.nodes &&
		!snapshot.truncated.families
	) {
		context.selected = null
		context.trace.clear()
		context.traceStatus = `Selection disposed`
	}
	return {
		snapshot,
		items,
		rows,
		rowCount: rowOrder.length,
		matches: matchedIds
			? new Set([...matchingRecords].map((record) => record.id))
			: undefined,
		edges,
		familyConnections,
		all,
		matching: ordered.length,
		atoms: layout.atoms,
		selectors: layout.selectors,
		members: layout.members,
		newPositions,
		selection,
		cylinderHeight: layout.height,
	}
}

/** Layout/projection work is scheduled in 4ms slices, leaving margin below the 8ms target. */
export function scheduleGraph<T>(
	iterator: Generator<void, T>,
	done: (value: T, chunks: number[]) => void,
	schedule: (run: () => void) => () => void = scheduleTask,
	now: () => number = () => performance.now(),
	budgetMs = 4,
): () => void {
	let active = true
	let cancel: () => void
	const chunks: number[] = []
	let stepCost = 0
	const run = () => {
		if (!active) return
		const start = now()
		let step: IteratorResult<void, T>
		let observed = start
		do {
			const before = observed
			step = iterator.next()
			observed = now()
			stepCost = Math.max(stepCost * 0.8, observed - before)
			if (step.done) {
				chunks.push(now() - start)
				active = false
				done(step.value, chunks)
				return
			}
		} while (observed - start + stepCost < budgetMs)
		chunks.push(now() - start)
		cancel = schedule(run)
	}
	cancel = schedule(run)
	return () => {
		active = false
		cancel()
		iterator.return(undefined as T)
	}
}
