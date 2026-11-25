import { stringifyJson } from "atom.io/foundations/json"

import {
	type EcologyFamily,
	type EcologyNode,
	type EcologyOperation,
	ecologyOperationId,
	type EcologySnapshot,
	ecologyTimelinePosition,
} from "./ecology.ts"
import { ecologyColor } from "./ecology-color.ts"
import {
	historyGraphId,
	historyIdentity,
	historyOutcomeSequence,
	type RecordedEvent,
} from "./history-event.ts"
import { scheduleTask } from "./task.ts"

export interface GraphPosition {
	x: number
	y: number
	z: number
}
export type EcologySource = EcologyNode | EcologyFamily | EcologyOperation
type GraphLane = `atom` | `selector` | `operation`
export type OperationRelation = `transaction` | `timeline`
const edgeLimit = 1_000
const cardLimit = 500
const operationAnchorReserve = 25
const operationEdgeReserve = 100
const historyWorkLimit = 10_000

export interface GraphHistory {
	events: readonly RecordedEvent[]
	at?: number
}

export interface GraphItem extends GraphPosition {
	id: string
	key: string
	kind: `atom` | `selector` | `family` | `transaction` | `timeline`
	label: string
	familyLabel?: string | undefined
	familyId?: string | undefined
	cluster?: GraphPosition | undefined
	history?: {
		identity: string
		direction: `outcome` | `past` | `future`
		anchor: GraphPosition
	}
	detail: string
	color: string
	source: EcologySource
}
export interface FamilyConnection {
	family: string
	from: GraphPosition
	to: GraphPosition
	color: string
}
interface GraphEdge {
	from: string
	to: string
	traced: boolean
	relation?: OperationRelation
}
interface HistoryEndpoint {
	item: GraphItem
	card: GraphItem
	event: RecordedEvent
}
export interface GraphContext {
	rowLimit?: number
	snapshot?: EcologySnapshot
	capturedAt: string
	query: string
	expanded: Set<string>
	selected: string | null
	selectedHistory?: string | undefined
	positions: Map<string, GraphPosition>
	completedLoads: WeakSet<object>
	camera?: {
		position: [number, number, number]
		target: [number, number, number]
		aspect?: number
	}
}
interface GraphRecord {
	id: string
	source: EcologySource
	lane: GraphLane
	slot: number
	order: number
	group: GraphRecord | undefined
}
interface OperationLink {
	from: GraphRecord
	to: GraphRecord
	relation: OperationRelation
}
interface GraphLayout {
	records: Map<string, GraphRecord>
	nodes: Map<string, GraphRecord>
	ordered: GraphRecord[]
	operations: GraphRecord[]
	groupSelectors: Map<GraphRecord, string[]>
	edgeIndex: Map<string, number[]>
	dependents: Map<string, number[]>
	operationLinks: OperationLink[]
	linksByRecord: Map<GraphRecord, OperationLink[]>
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
	historyConnections: FamilyConnection[]
	historyOwners: GraphItem[]
	historyEndpoints: Map<string, HistoryEndpoint>
	historyFocus: Set<string>
	all: GraphRegistry
	matching: number
	atoms: number
	selectors: number
	members: number
	newPositions: number
	selection: GraphSelection | undefined
	cylinderHeight: number
}
export function isHistoryOwner(
	item: GraphItem | undefined,
): item is GraphItem & {
	kind: `transaction` | `timeline`
	history?: undefined
} {
	return Boolean(
		item &&
		!item.history &&
		(item.kind === `timeline` || item.kind === `transaction`),
	)
}
interface GraphSelection {
	id: string
	selectedIds: Set<string>
	nodes: Set<string>
	items: Set<string>
	edges: Set<number>
	links: Set<OperationLink>
}
export function createGraphContext(): GraphContext {
	return {
		capturedAt: ``,
		query: ``,
		expanded: new Set(),
		selected: null,
		positions: new Map(),
		completedLoads: new WeakSet(),
	}
}

/** Equal arc-length steps around the same cylinder. */
function helixPosition(
	slot: number,
	lane: GraphLane,
	height: number,
): GraphPosition {
	const selector = lane === `selector`
	const depth = selector ? height / 2 - slot : slot
	const phase = selector ? Math.PI : lane === `operation` ? Math.PI / 2 : 0
	const angle = (depth * Math.PI) / 4 + phase
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
		records: new Map(),
		nodes: new Map(),
		ordered: [],
		operations: [],
		groupSelectors: new Map(),
		edgeIndex: new Map(),
		dependents: new Map(),
		operationLinks: [],
		linksByRecord: new Map(),
		collapsed: new Map(),
		expanded: new Map(),
		height: 8,
		atoms: 0,
		selectors: 0,
		members: 0,
	}
	const slots = { atom: 0, selector: 0, operation: 0 },
		members = new Map<GraphRecord, number>()
	const add = (
		id: string,
		source: EcologySource,
		lane: GraphLane,
		group?: GraphRecord,
	): void => {
		const slot = group ? (members.get(group) ?? 0) : slots[lane]++
		if (group) members.set(group, slot + 1)
		const record: GraphRecord = {
			id,
			source,
			lane,
			slot,
			order: layout.ordered.length,
			group,
		}
		if (`kind` in source) layout.nodes.set(source.key, record)
		else layout.records.set(id, record)
		layout.ordered.push(record)
		if (lane === `operation`) layout.operations.push(record)
	}
	for (const source of snapshot.families) {
		const lane = source.type.includes(`selector`) ? `selector` : `atom`
		add(`family:${source.key}`, source, lane)
		yield
	}
	for (const source of snapshot.nodes) {
		if (source.kind === `atom`) layout.atoms++
		else layout.selectors++
		if (source.family) layout.members++
		const group = source.family
			? layout.records.get(`family:${source.family.key}`)
			: undefined
		add(`state:${source.key}`, source, source.kind, group)
		if (group && source.kind === `selector`) {
			let keys = layout.groupSelectors.get(group)
			if (!keys) layout.groupSelectors.set(group, (keys = []))
			keys.push(source.key)
		}
		yield
	}
	const operations = snapshot.operations?.records ?? []
	for (const source of operations) {
		if (source.type === `timeline_family`)
			add(ecologyOperationId(source), source, `operation`)
		yield
	}
	for (const source of operations) {
		if (source.type !== `timeline_family`) {
			const group =
				source.type === `timeline` && source.family
					? layout.records.get(`timeline_family:${source.family.key}`)
					: undefined
			add(ecologyOperationId(source), source, `operation`, group)
		}
		yield
	}
	for (const source of operations) {
		const from = layout.records.get(ecologyOperationId(source))!
		const relation = source.type === `transaction` ? `transaction` : `timeline`
		for (const target of source.targets ?? []) {
			const to = resolveRecord(layout, `${target.kind}:${target.key}`)
			if (to) {
				const link = { from, to, relation } as const
				layout.operationLinks.push(link)
				for (const record of [from, to, from.group, to.group]) {
					if (!record) continue
					let links = layout.linksByRecord.get(record)
					if (!links) layout.linksByRecord.set(record, (links = []))
					links.push(link)
				}
			}
			yield
		}
		yield
	}
	layout.height = Math.max(8, (Math.max(...Object.values(slots)) - 1) * 2)
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
	return id.startsWith(`state:`)
		? layout.nodes.get(id.slice(6))
		: layout.records.get(id)
}
/** Walk each direction independently: never turn onto an ancestor's offshoot or a consumer's other roots. */
function* traceSelection(
	snapshot: EcologySnapshot,
	layout: GraphLayout,
	selected: GraphRecord,
): Generator<void, GraphSelection> {
	const source = selected.source
	const seeds =
		selected.lane === `operation`
			? []
			: `memberKeys` in source
				? source.memberKeys
				: [source.key]
	const selection: GraphSelection = {
		id: selected.id,
		selectedIds: new Set([selected.id]),
		nodes: new Set(seeds),
		items: new Set([selected.id]),
		edges: new Set(),
		links: new Set(layout.linksByRecord.get(selected)),
	}
	for (const { from, to } of selection.links) {
		for (const record of [from, to, from.group, to.group])
			if (record) selection.items.add(record.id)
		yield
	}
	if (selected.lane === `operation`) {
		if (`memberKeys` in source) {
			for (const key of source.memberKeys) {
				const record = layout.records.get(`timeline:${key}`)
				if (record?.group === selected) {
					selection.items.add(record.id)
					selection.selectedIds.add(record.id)
				}
				yield
			}
		} else if (selected.group) selection.items.add(selected.group.id)
		return selection
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
		const fan = Boolean(record.group && expanded.has(record.group.id))
		const cache = fan ? layout.expanded : layout.collapsed
		const prior = cache.get(record)
		if (prior) return prior
		const source = record.source
		const member = `family` in source ? source.family : undefined
		const kind =
			`kind` in source
				? source.kind
				: `memberKeys` in source
					? `family`
					: source.type
		const cluster = record.group
			? clusterPosition(read(record.group), record.slot)
			: undefined
		const position = record.group
			? fan
				? familyPosition(read(record.group), record.slot)
				: cluster!
			: helixPosition(record.slot, record.lane, layout.height)
		const item: GraphItem = {
			id: record.id,
			key: source.key,
			kind,
			label: member?.subKey ?? source.key,
			familyLabel: member?.key,
			familyId: record.group?.id,
			cluster,
			color: ecologyColor(source),
			detail:
				`memberKeys` in source
					? `${source.type} · ${source.memberCount}${source.countComplete ? `` : `+`} members`
					: `kind` in source
						? `${source.kind} · ${source.value.status === `cached` ? `cached ${source.value.type}` : `not cached / unknown`}`
						: source.type === `timeline`
							? ecologyTimelinePosition(source)
							: `transaction`,
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
			(record) => !record.group || expanded.has(record.group.id),
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

/** Keep the latest transaction outcomes and timeline events closest to the cursor. */
function* projectHistory(
	owner: GraphItem,
	card: GraphItem,
	{ events, at }: GraphHistory,
	height: number,
	limit: number,
	endpoints: Map<string, HistoryEndpoint>,
	flyout?: { items: GraphItem[]; connections: FamilyConnection[] },
): Generator<void> {
	let low = owner,
		high = owner
	const append = (
		index: number,
		offset: number,
		direction: NonNullable<GraphItem[`history`]>[`direction`],
	) => {
		const event = events[index]
		const identity = historyIdentity(event)
		const cluster = clusterPosition(owner, index)
		const position = flyout
			? { x: owner.x, y: owner.y + (offset * height) / 2, z: owner.z }
			: cluster
		const item: GraphItem = {
			...owner,
			id: historyGraphId(owner.id, identity),
			familyId: owner.id,
			familyLabel: undefined,
			history: { identity, direction, anchor: owner },
			cluster,
			...position,
			label:
				direction === `outcome`
					? `Outcome ${index + 1}`
					: `token` in event
						? event.token.key
						: event.type.replaceAll(`_`, ` `),
			detail:
				direction === `outcome`
					? `Transaction outcome`
					: `${direction === `past` ? `Past` : `Future`} · ${event.type.replaceAll(`_`, ` `)}`,
		}
		endpoints.set(item.id, { item, card: flyout ? item : card, event })
		if (!flyout) return
		flyout.items.push(item)
		if (item.y < low.y) low = item
		if (item.y > high.y) high = item
	}
	if (at === undefined) {
		const start = Math.max(0, events.length - limit)
		for (let index = start; index < events.length; index++) {
			append(index, start - index - 1, `outcome`)
			yield
		}
	} else {
		for (
			let distance = 1;
			limit > 0 && distance <= Math.max(at, events.length - at);
			distance++
		) {
			if (distance <= at) {
				append(at - distance, distance, `past`)
				limit--
				yield
			}
			if (limit && at + distance <= events.length) {
				append(at + distance - 1, -distance, `future`)
				limit--
				yield
			}
		}
	}
	if (flyout && low !== high)
		flyout.connections.push({
			family: owner.id,
			from: low,
			to: high,
			color: owner.color,
		})
}

/** Walk only the captured event structure and resolve keys against the active snapshot. */
function* historyTargets(
	event: RecordedEvent,
	layout: GraphLayout,
): Generator<GraphRecord | undefined> {
	const stack = [[event].values()]
	while (stack.length) {
		const next = stack.at(-1)!.next()
		if (next.done) {
			stack.pop()
			continue
		}
		const child = next.value
		if (`subEvents` in child) stack.push(child.subEvents.values())
		if (child.type === `transaction_outcome`) yield
		else if (`token` in child) {
			const key = child.token.key
			const mutable = key.startsWith(`*`)
				? layout.nodes.get(key.slice(1))
				: undefined
			yield mutable?.source.type === `mutable_atom`
				? mutable
				: layout.nodes.get(key)
		} else if (child.type === `molecule_disposal`) {
			const subKey = stringifyJson(child.key)
			for (const [family] of child.values)
				yield layout.nodes.get(`${family}(${subKey})`)
		} else yield
	}
}

/** Project admitted records, retaining capture order and raw parallel edges. Nothing publishes before completion. */
export function* projectEcology(
	snapshot: EcologySnapshot,
	context: GraphContext,
	matchedIds?: ReadonlySet<string>,
	previous?: GraphModel,
	histories?: ReadonlyMap<string, GraphHistory>,
): Generator<void, GraphModel> {
	if (previous?.snapshot !== snapshot) previous = undefined
	const layout = previous?.all.layout ?? (yield* indexGraph(snapshot))
	const all =
		previous &&
		previous.all.expanded.size === context.expanded.size &&
		[...context.expanded].every((key) => previous.all.expanded.has(key))
			? previous.all
			: createRegistry(layout, context.expanded)
	const visibleRecord = (record: GraphRecord): GraphRecord =>
		record.group && !all.expanded.has(record.group.id) ? record.group : record
	const matchingRecords = new Set<GraphRecord>()
	if (matchedIds)
		for (const id of matchedIds) {
			const record = resolveRecord(layout, id)
			if (record) matchingRecords.add(visibleRecord(record))
			yield
		}
	const ordered = matchedIds
		? [...matchingRecords].sort((a, b) => a.order - b.order)
		: all.visible
	const selected = context.selected
		? resolveRecord(layout, context.selected)
		: undefined
	const selection = selected
		? previous?.selection?.id === selected.id
			? previous.selection
			: yield* traceSelection(snapshot, layout, selected)
		: undefined
	const admittedSet = new Set<GraphRecord>()
	const historyOwners: GraphRecord[] = []
	const historyItems: GraphItem[] = []
	const historyConnections: FamilyConnection[] = []
	const historyEndpoints = new Map<string, HistoryEndpoint>()
	const historyFocus = new Set<string>()
	function* admit(records: Iterable<GraphRecord>): Generator<void> {
		for (const record of records) {
			if (admittedSet.size + historyItems.length === cardLimit) break
			admittedSet.add(visibleRecord(record))
			yield
		}
	}
	if (selected) admittedSet.add(visibleRecord(selected))
	for (const id of all.expanded) {
		const record = resolveRecord(layout, id)
		if (
			record?.lane === `operation` &&
			!(`memberKeys` in record.source) &&
			visibleRecord(record) === record
		) {
			if (admittedSet.size === cardLimit) break
			admittedSet.add(record)
			historyOwners.push(record)
		}
		yield
	}
	// Keep the selected owner's graph relationships in view while admitting its history.
	if (matchedIds && !historyOwners.length) yield* admit(ordered)
	if (selection) {
		for (const { from, to } of selection.links) {
			if (admittedSet.size === cardLimit) break
			yield* admit([from, to])
		}
	}
	if (selected && historyOwners.includes(selected)) {
		historyOwners.splice(historyOwners.indexOf(selected), 1)
		historyOwners.unshift(selected)
	}
	for (const owner of historyOwners) {
		const history = histories?.get(owner.id)
		const room = cardLimit - admittedSet.size - historyItems.length
		if (history && room > 0)
			yield* projectHistory(
				all.get(owner.id)!,
				all.get(owner.id)!,
				history,
				layout.height,
				room,
				historyEndpoints,
				{ items: historyItems, connections: historyConnections },
			)
		yield
	}
	if (matchedIds && historyOwners.length) yield* admit(ordered)
	if (!matchedIds && all.visible.length > cardLimit) {
		const anchors = new Set<GraphRecord>()
		for (const record of layout.operations) {
			if (anchors.size === operationAnchorReserve) break
			anchors.add(visibleRecord(record))
			yield
		}
		yield* admit(anchors)
		for (const anchor of anchors) {
			const link = layout.linksByRecord.get(anchor)?.[0]
			if (link) yield* admit([link.to])
			yield
		}
	}
	yield* admit(all.visible)
	const watchedOwners = new Set<GraphRecord>()
	for (const record of admittedSet) {
		if (record.lane === `operation` && !(`memberKeys` in record.source))
			watchedOwners.add(record)
		yield
	}
	for (const record of layout.operations) {
		if (watchedOwners.size === cardLimit) break
		if (record.group && admittedSet.has(visibleRecord(record)))
			watchedOwners.add(record)
		yield
	}
	const watchedHistories: GraphItem[] = []
	for (const record of watchedOwners) {
		const owner = all.get(record.id)!
		watchedHistories.push(owner)
		const history = histories?.get(owner.id)
		const anchor = visibleRecord(record)
		if (
			history &&
			(anchor !== record || !all.expanded.has(owner.id)) &&
			historyEndpoints.size < edgeLimit
		)
			yield* projectHistory(
				owner,
				all.get(anchor.id)!,
				history,
				layout.height,
				edgeLimit - historyEndpoints.size,
				historyEndpoints,
			)
		yield
	}
	// Priority affects admission while retained cards keep their DOM slots.
	const admitted = [...admittedSet].sort((a, b) => a.order - b.order)
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
			(`memberKeys` in record.source && all.expanded.has(record.id)
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
		} else if (`memberKeys` in record.source && !all.expanded.has(record.id))
			selectorKeys.push(...(layout.groupSelectors.get(record) ?? []))
		yield
	}
	const familyConnections: FamilyConnection[] = []
	for (const [family, span] of familySpans) {
		if (span.from !== span.to)
			familyConnections.push({
				family: family.id,
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
		return record && visibleRecord(record).id
	}
	const shownLinks = new Set<string>()
	const outcomes = new Map<number, HistoryEndpoint>()
	for (const entry of historyEndpoints.values()) {
		if (entry.item.history?.direction === `outcome`) {
			const sequence = historyOutcomeSequence(entry.event)
			if (sequence !== undefined) outcomes.set(sequence, entry)
		}
		yield
	}
	const related = (item: GraphItem) =>
		(selection?.selectedIds.has(item.id) ?? false) ||
		(item.familyId !== undefined &&
			(selection?.selectedIds.has(item.familyId) ?? false))
	const tracedHistory: GraphEdge[] = []
	const historyRoutes: GraphEdge[] = []
	const routeHistory = (
		from: HistoryEndpoint,
		to: GraphItem,
		card: GraphItem,
	) => {
		const traced =
			related(from.item) || related(from.card) || related(to) || related(card)
		const route: GraphEdge = {
			from: from.item.id,
			to: to.id,
			relation: from.item.kind === `transaction` ? `transaction` : `timeline`,
			traced,
		}
		if (traced) {
			for (const item of [from.item, from.card, to, card]) {
				historyFocus.add(item.id)
				if (item.familyId) historyFocus.add(item.familyId)
			}
			tracedHistory.push(route)
		} else historyRoutes.push(route)
	}
	let inspected = 0
	for (const entry of historyEndpoints.values()) {
		if (entry.item.kind === `timeline`) {
			const sequence = historyOutcomeSequence(entry.event)
			const outcome = sequence === undefined ? undefined : outcomes.get(sequence)
			if (outcome) routeHistory(entry, outcome.item, outcome.card)
		}
		const targets = new Set<GraphRecord>()
		for (const target of historyTargets(entry.event, layout)) {
			if (inspected === historyWorkLimit) break
			inspected++
			if (target && !targets.has(target)) {
				targets.add(target)
				const card = visibleRecord(target)
				if (painted.has(card.id))
					routeHistory(entry, all.get(target.id)!, all.get(card.id)!)
			}
			yield
		}
		yield
	}
	function* projectLinks(
		links: Iterable<OperationLink>,
		limit = edgeLimit,
	): Generator<void> {
		for (const link of links) {
			if (edges.length === limit) break
			// Transaction definitions still provide admission hints. Only outcomes draw write routes.
			if (link.relation === `transaction`) {
				yield
				continue
			}
			const from = link.from.id
			const to = link.to.id
			const id = JSON.stringify([from, to])
			if (
				painted.has(visibleRecord(link.from).id) &&
				painted.has(visibleRecord(link.to).id) &&
				!shownLinks.has(id)
			) {
				shownLinks.add(id)
				edges.push({
					from,
					to,
					relation: link.relation,
					traced: selection?.links.has(link) ?? false,
				})
			}
			yield
		}
	}
	if (selection) yield* projectLinks(selection.links)
	edges.push(...tracedHistory.slice(0, edgeLimit - edges.length))
	let reservedHistory = 0
	if (candidates.length >= edgeLimit && edges.length < operationEdgeReserve) {
		reservedHistory = Math.min(
			historyRoutes.length,
			(operationEdgeReserve - edges.length) >> 1,
		)
		yield* projectLinks(
			layout.operationLinks,
			operationEdgeReserve - reservedHistory,
		)
		edges.push(...historyRoutes.slice(0, reservedHistory))
	}
	for (const index of candidates) {
		if (edges.length === edgeLimit) break
		const edge = snapshot.edges[index],
			from = endpoint(edge.dependency),
			to = endpoint(edge.selector)
		if (from && to && painted.has(from) && painted.has(to))
			edges.push({
				from: `state:${edge.dependency}`,
				to: `state:${edge.selector}`,
				traced: selection?.edges.has(index) ?? false,
			})
		yield
	}
	yield* projectLinks(layout.operationLinks)
	edges.push(
		...historyRoutes.slice(
			reservedHistory,
			reservedHistory + edgeLimit - edges.length,
		),
	)
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
			: selection?.items.has(record.id) || historyFocus.has(record.id)
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
	const removed: string[] = []
	if (!previous)
		for (const id of context.positions.keys()) {
			if (!all.has(id)) removed.push(id)
			yield
		}
	for (const id of removed) context.positions.delete(id)
	for (const [id, position] of pending) context.positions.set(id, position)
	if (context.selected && !all.has(context.selected)) {
		const stateSelection =
			context.selected.startsWith(`state:`) ||
			context.selected.startsWith(`family:`)
		const truncated = stateSelection
			? snapshot.truncated.nodes || snapshot.truncated.families
			: snapshot.operations?.truncated
		if (!truncated) {
			context.selected = null
			context.selectedHistory = undefined
		}
	}
	return {
		snapshot,
		items: items.concat(historyItems),
		rows,
		rowCount: rowOrder.length,
		matches: matchedIds
			? new Set([...matchingRecords].map((record) => record.id))
			: undefined,
		edges,
		familyConnections,
		historyConnections,
		historyOwners: watchedHistories,
		historyEndpoints,
		historyFocus,
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
