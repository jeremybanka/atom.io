import type { EcologyFamily, EcologyNode, EcologySnapshot } from "./ecology.ts"
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
	detail: string
	source: EcologyNode | EcologyFamily
}
interface GraphEdge {
	from: string
	to: string
	traced: boolean
}
export interface GraphContext {
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
	}
}
export interface GraphModel {
	snapshot: EcologySnapshot
	height: number
	edgeIndex: Map<string, number[]>
	items: GraphItem[]
	edges: GraphEdge[]
	all: Map<string, GraphItem>
	matching: number
	atoms: number
	selectors: number
	members: number
	newPositions: number
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
export function helixPosition(
	slot: number,
	selector: boolean,
	height: number,
): GraphPosition {
	const angle = (slot * Math.PI) / 4 + (selector ? Math.PI : 0)
	return {
		x: 8 * Math.cos(angle),
		y: selector ? -height / 2 + slot * 2 : height / 2 - slot * 2,
		z: 8 * Math.sin(angle),
	}
}
/** Fan out on the horizontal tangent, leaving the family card at its anchor. */
export function familyPosition(
	anchor: GraphPosition,
	member: number,
): GraphPosition {
	const offset = (Math.floor(member / 2) + 1) * (member % 2 ? -1 : 1) * 12
	return {
		x: anchor.x - (anchor.z / 8) * offset,
		y: anchor.y,
		z: anchor.z + (anchor.x / 8) * offset,
	}
}

/** Every visited record yields; cancellation never publishes partial positions. */
export function* projectEcology(
	snapshot: EcologySnapshot,
	context: GraphContext,
	matchedIds?: ReadonlySet<string>,
	previous?: GraphModel,
): Generator<void, GraphModel> {
	if (previous?.snapshot !== snapshot) previous = undefined
	const familyIds = new Set<string>(),
		totals = { atom: 0, selector: 0 }
	for (const family of snapshot.families) {
		familyIds.add(family.key)
		totals[family.type.includes(`selector`) ? `selector` : `atom`]++
		yield
	}
	if (!previous)
		for (const node of snapshot.nodes) {
			if (!node.family || !familyIds.has(node.family.key)) totals[node.kind]++
			yield
		}
	const height =
		previous?.height ??
		Math.max(8, (Math.max(totals.atom, totals.selector) - 1) * 2)
	const edgeIndex = previous?.edgeIndex ?? new Map<string, number[]>()
	if (!previous)
		for (let index = 0; index < snapshot.edges.length; index++) {
			const key = snapshot.edges[index].selector
			let indices = edgeIndex.get(key)
			if (!indices) edgeIndex.set(key, (indices = []))
			indices.push(index)
			yield
		}
	let all = previous?.all ?? new Map<string, GraphItem>()
	const items: GraphItem[] = [],
		edges: GraphEdge[] = [],
		painted = new Set<string>(),
		mapped = new Map<string, string>()
	const pendingPositions = new Map<string, GraphPosition>(),
		slots = { atom: 0, selector: 0 }
	let atoms = 0,
		selectors = 0,
		members = 0,
		matching = 0,
		newPositions = 0
	const add = (item: GraphItem, matches: boolean) => {
		if (all.get(item.id) !== item) {
			if (all === previous?.all) all = new Map(all)
			all.set(item.id, item)
		}
		if (!matches) return
		matching++
		if (items.length >= 500) {
			if (item.id !== context.selected) return
			const removed = items.pop()!
			painted.delete(removed.id)
			pendingPositions.delete(removed.id)
			if (!context.positions.has(removed.id)) newPositions--
		}
		if (!context.positions.has(item.id)) newPositions++
		pendingPositions.set(
			item.id,
			context.positions.get(item.id) ?? { x: item.x, y: item.y, z: item.z },
		)
		items.push(item)
		painted.add(item.id)
	}
	// A matching member retains its collapsed family. Search never silently changes expansion.
	const matchingFamilies = new Set<string>()
	if (matchedIds)
		for (const node of snapshot.nodes) {
			if (node.family && matchedIds.has(`state:${node.key}`))
				matchingFamilies.add(node.family.key)
			yield
		}
	for (const family of snapshot.families) {
		const id = `family:${family.key}`,
			lane = family.type.includes(`selector`) ? `selector` : `atom`
		const position = helixPosition(slots[lane]++, lane === `selector`, height)
		add(
			previous?.all.get(id) ?? {
				id,
				key: family.key,
				kind: `family`,
				label: family.key,
				detail: `${family.type} · ${family.memberCount}${family.countComplete ? `` : `+`} members`,
				source: family,
				...position,
			},
			!matchedIds ||
				matchedIds.has(id) ||
				(!context.expanded.has(family.key) && matchingFamilies.has(family.key)),
		)
		yield
	}
	const memberSlots = new Map<string, number>(),
		visibleSelectors: string[] = []
	for (const node of snapshot.nodes) {
		if (node.kind === `atom`) atoms++
		else selectors++
		if (node.family) members++
		const id = `state:${node.key}`,
			group = node.family ? all.get(`family:${node.family.key}`) : undefined
		const member = group ? (memberSlots.get(group.id) ?? 0) : 0
		if (group) memberSlots.set(group.id, member + 1)
		const expanded = !group || context.expanded.has(group.key)
		const prior = previous?.all.get(id)
		const position = group
			? expanded
				? familyPosition(group, member)
				: group
			: (prior ??
				helixPosition(slots[node.kind]++, node.kind === `selector`, height))
		const item =
			prior &&
			prior.x === position.x &&
			prior.y === position.y &&
			prior.z === position.z
				? prior
				: {
						id,
						key: node.key,
						kind: node.kind,
						label: node.key,
						detail: `${node.kind} · ${node.value.status === `cached` ? `cached ${node.value.type}` : `not cached / unknown`}`,
						source: node,
						x: position.x,
						y: position.y,
						z: position.z,
					}
		add(item, expanded && (!matchedIds || matchedIds.has(id)))
		const target = expanded ? id : group.id
		if (painted.has(target)) {
			mapped.set(node.key, target)
			if (node.kind === `selector`) visibleSelectors.push(node.key)
		}
		yield
	}
	// Query only captured adjacency for admitted selector endpoints; preserve capture order and parallel edges.
	const candidates: number[] = []
	for (const key of visibleSelectors) {
		for (const index of edgeIndex.get(key) ?? []) {
			candidates.push(index)
			yield
		}
		yield
	}
	candidates.sort((a, b) => a - b)
	for (const index of candidates) {
		const edge = snapshot.edges[index],
			from = mapped.get(edge.dependency),
			to = mapped.get(edge.selector)
		if (from && to && painted.has(from) && painted.has(to))
			edges.push({
				from,
				to,
				traced:
					context.trace.has(edge.dependency) && context.trace.has(edge.selector),
			})
		if (edges.length === 1_000) break
		yield
	}
	const removed: string[] = []
	for (const id of context.positions.keys()) {
		if (!all.has(id)) removed.push(id)
		yield
	}
	for (const id of removed) context.positions.delete(id)
	for (const [id, position] of pendingPositions)
		context.positions.set(id, position)
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
		height,
		edgeIndex,
		items,
		edges,
		all,
		matching,
		atoms,
		selectors,
		members,
		newPositions,
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
