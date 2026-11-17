import type { EcologyFamily, EcologyNode, EcologySnapshot } from "./ecology.ts"

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
): Generator<void, GraphModel> {
	const all = new Map<string, GraphItem>(),
		mapped = new Map<string, string>()
	const query = context.query.toLocaleLowerCase()
	const items: GraphItem[] = [],
		edges: GraphEdge[] = []
	const pendingPositions = new Map<string, { x: number; y: number }>()
	let atoms = 0,
		selectors = 0,
		members = 0,
		matching = 0,
		newPositions = 0
	const add = (item: Omit<GraphItem, `x` | `y`>, matches: boolean): void => {
		const previous = context.positions.get(item.id)
		const positioned: GraphItem = {
			...item,
			x: previous?.x ?? 0,
			y: previous?.y ?? 0,
		}
		all.set(item.id, positioned)
		if (!matches) return
		matching++
		if (items.length >= 500) return
		if (!previous) {
			// Position identity survives filtering and value-only refresh. No force simulation or recursive graph walk.
			const slot = context.nextSlot + pendingPositions.size
			positioned.x = 24 + (slot % 4) * 210
			positioned.y = 24 + Math.floor(slot / 4) * 82
			pendingPositions.set(item.id, { x: positioned.x, y: positioned.y })
			newPositions++
		}
		items.push(positioned)
	}
	for (const family of snapshot.families) {
		const id = graphFamilyId(family.key)
		add(
			{
				id,
				key: family.key,
				kind: `family`,
				label: family.key,
				detail: `${family.type} · ${family.memberCount}${family.countComplete ? `` : `+`} members`,
				source: family,
			},
			!query ||
				`${family.key} ${family.type}`.toLocaleLowerCase().includes(query),
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
			!!query ||
			!all.has(group)
		mapped.set(node.key, visible ? id : group)
		const detail =
			node.value.status === `cached`
				? `cached ${node.value.type}`
				: `not cached / unknown`
		add(
			{
				id,
				key: node.key,
				kind: node.kind,
				label: node.key,
				detail: `${node.kind} · ${detail}`,
				source: node,
			},
			visible &&
				(!query ||
					`${node.key} ${node.family?.key ?? ``} ${node.type} ${detail}`
						.toLocaleLowerCase()
						.includes(query)),
		)
		yield
	}
	const painted = new Set(items.map((item) => item.id))
	const seen = new Map<string, GraphEdge>()
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
	return { items, edges, all, matching, atoms, selectors, members, newPositions }
}

/** Layout/projection work is scheduled in 4ms slices, leaving margin below the 8ms target. */
export function scheduleGraph<T>(
	iterator: Generator<void, T>,
	done: (value: T, chunks: number[]) => void,
	schedule: (run: () => void) => () => void = (run) => {
		const timer = setTimeout(run, 0)
		return () => {
			clearTimeout(timer)
		}
	},
	now: () => number = () => performance.now(),
): () => void {
	let active = true
	let cancel: () => void
	const chunks: number[] = []
	const run = () => {
		if (!active) return
		const start = now()
		let step: IteratorResult<void, T>
		do {
			step = iterator.next()
			if (step.done) {
				chunks.push(now() - start)
				active = false
				done(step.value, chunks)
				return
			}
		} while (now() - start < 4)
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
