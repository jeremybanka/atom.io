import type { EcologyFamily, EcologyNode, EcologySnapshot } from "./ecology.ts"
import { scheduleTask } from "./task.ts"

interface GraphItem {
	id: string
	key: string
	kind: `atom` | `selector` | `family`
	label: string
	detail: string
	x: number
	y: number
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
	positions: Map<string, { x: number; y: number }>
	nextSlot: number
	pan: { x: number; y: number; zoom: number }
}
export interface GraphModel {
	snapshot: EcologySnapshot
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
		nextSlot: 0,
		pan: { x: 0, y: 0, zoom: 1 },
	}
}
const graphNodeId = (key: string): string => `state:${key}`
const graphFamilyId = (key: string): string => `family:${key}`

/** Every visited record yields, allowing the owner to budget/cancel projection as well as positioning. */
export function* projectEcology(
	snapshot: EcologySnapshot,
	context: GraphContext,
	matchedIds?: ReadonlySet<string>,
	previous?: GraphModel,
): Generator<void, GraphModel> {
	// Reuse detached metadata only within one capture; pending coordinates remain private until completion.
	if (previous?.snapshot !== snapshot) previous = undefined
	const all = new Map<string, GraphItem>(),
		mapped = new Map<string, string>(),
		selectorIds = new Set<string>()
	const filtered = Boolean(context.query.trim())
	const items: GraphItem[] = [],
		edges: GraphEdge[] = []
	const pendingPositions = new Map<string, { x: number; y: number }>()
	let atoms = 0,
		selectors = 0,
		members = 0,
		matching = 0,
		newPositions = 0
	const add = (
		item: Omit<GraphItem, `x` | `y`> | GraphItem,
		matches: boolean,
	): void => {
		const previousPosition = context.positions.get(item.id)
		let positioned: GraphItem =
			`x` in item
				? item
				: {
						id: item.id,
						key: item.key,
						kind: item.kind,
						label: item.label,
						detail: item.detail,
						source: item.source,
						x: previousPosition?.x ?? 0,
						y: previousPosition?.y ?? 0,
					}
		all.set(item.id, positioned)
		if (!matches) return
		matching++
		if (items.length >= 500) {
			if (item.id !== context.selected) return
			const removed = items.pop()!
			if (pendingPositions.delete(removed.id)) newPositions--
		}
		if (!previousPosition) {
			// Position identity survives filtering and value-only refresh. No force simulation or recursive graph walk.
			const slot = context.nextSlot + pendingPositions.size
			positioned = {
				...positioned,
				x: 24 + (slot % 4) * 210,
				y: 24 + Math.floor(slot / 4) * 82,
			}
			all.set(item.id, positioned)
			pendingPositions.set(item.id, { x: positioned.x, y: positioned.y })
			newPositions++
		}
		items.push(positioned)
	}
	for (const family of snapshot.families) {
		const id = graphFamilyId(family.key)
		add(
			previous?.all.get(id) ?? {
				id,
				key: family.key,
				kind: `family`,
				label: family.key,
				detail: `${family.type} · ${family.memberCount}${family.countComplete ? `` : `+`} members`,
				source: family,
			},
			!matchedIds || matchedIds.has(id),
		)
		yield
	}
	for (const node of snapshot.nodes) {
		if (node.kind === `atom`) atoms++
		else selectors++
		if (node.family) members++
		const id = graphNodeId(node.key)
		const group = node.family ? graphFamilyId(node.family.key) : null
		const visible =
			!group ||
			context.expanded.has(node.family!.key) ||
			filtered ||
			id === context.selected ||
			!all.has(group)
		mapped.set(node.key, visible ? id : group)
		if (node.kind === `selector`) selectorIds.add(visible ? id : group)
		add(
			previous?.all.get(id) ?? {
				id,
				key: node.key,
				kind: node.kind,
				label: node.key,
				detail: `${node.kind} · ${node.value.status === `cached` ? `cached ${node.value.type}` : `not cached / unknown`}`,
				source: node,
			},
			visible && (!matchedIds || matchedIds.has(id)),
		)
		yield
	}
	const painted = new Set(items.map((item) => item.id))
	const seen = new Map<string, GraphEdge>()
	// Atom-only projections have no edge destinations. Once an untraced paint cap is full, later edges cannot affect it.
	if (items.some((item) => selectorIds.has(item.id)))
		for (const edge of snapshot.edges) {
			const from = mapped.get(edge.dependency),
				to = mapped.get(edge.selector)
			if (from && to && from !== to && painted.has(from) && painted.has(to)) {
				const id = JSON.stringify([from, to])
				const traced =
					context.trace.has(edge.dependency) && context.trace.has(edge.selector)
				const prior = seen.get(id)
				if (prior) prior.traced ||= traced
				else if (edges.length < 1_000) {
					const link = { from, to, traced }
					seen.set(id, link)
					edges.push(link)
				}
			}
			if (edges.length === 1_000 && context.trace.size === 0) break
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
	context.nextSlot += pendingPositions.size
	// Missing entries in a truncated capture are unknown, not evidence of disposal.
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

/** Route between outward-facing card ports so arrowheads never terminate underneath a card. */
export function graphEdgePath(
	from: { x: number; y: number },
	to: { x: number; y: number },
): string {
	const dx = to.x - from.x,
		dy = to.y - from.y
	if (Math.abs(dx) >= Math.abs(dy)) {
		const direction = dx >= 0 ? 1 : -1
		const startX = from.x + (direction > 0 ? 176 : 0),
			endX = to.x + (direction > 0 ? 0 : 176)
		const bend = Math.max(24, Math.abs(endX - startX) / 2)
		return `M${startX} ${from.y + 26} C${startX + direction * bend} ${from.y + 26} ${endX - direction * bend} ${to.y + 26} ${endX} ${to.y + 26}`
	}
	const direction = dy > 0 ? 1 : -1
	const startY = from.y + (direction > 0 ? 52 : 0),
		endY = to.y + (direction > 0 ? 0 : 52)
	const bend = Math.max(24, Math.abs(endY - startY) / 2)
	return `M${from.x + 88} ${startY} C${from.x + 88} ${startY + direction * bend} ${to.x + 88} ${endY - direction * bend} ${to.x + 88} ${endY}`
}
