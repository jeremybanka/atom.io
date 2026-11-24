import type { RootStore } from "atom.io/internal"

import {
	captureEcologySnapshot,
	type EcologyNode,
	type EcologySnapshot,
	ecologyValue,
} from "./ecology.ts"
import type {
	WorkerEcologyEdge,
	WorkerEcologyUpdate,
	WorkerRecordsUpdate,
} from "./worker-protocol.ts"

const keyOf = ({ key }: { key: string }) => key
const edgeKey = ({ dependency, selector }: WorkerEcologyEdge) =>
	JSON.stringify([dependency, selector])
const toMap = <T>(records: readonly T[], key: (record: NoInfer<T>) => string) =>
	new Map(records.map((record) => [key(record), record]))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diff<T>(
	previous: Map<string, T>,
	next: Map<string, T>,
): WorkerRecordsUpdate<T> {
	return {
		upsert: [...next].flatMap(([key, record]) =>
			same(previous.get(key), record) ? [] : [record],
		),
		remove: [...previous.keys()].filter((key) => !next.has(key)),
	}
}

function hasChanges<T>(change: WorkerRecordsUpdate<T>): boolean {
	return change.upsert.length > 0 || change.remove.length > 0
}

function index(snapshot: EcologySnapshot) {
	return {
		nodes: toMap(snapshot.nodes, keyOf),
		edges: toMap(snapshot.edges, edgeKey),
		families: toMap(snapshot.families, keyOf),
		metadata: { truncated: snapshot.truncated, work: snapshot.work },
	}
}

/** Revisit graph limits and membership only when the observed topology changes. */
export function trackWorkerEcology(store: RootStore): {
	initial: EcologySnapshot
	update(
		keys: ReadonlySet<string>,
		topology: boolean,
	): WorkerEcologyUpdate | undefined
} {
	const capture = () =>
		captureEcologySnapshot(store, {
			maxNodes: 10_000,
			maxFamilies: 10_000,
			maxRelations: 50_000,
		})
	const initial = capture()
	let graph = index(initial)
	let linked = new Set(initial.edges.map(({ selector }) => selector))
	return {
		initial,
		update(
			keys: ReadonlySet<string>,
			topology: boolean,
		): WorkerEcologyUpdate | undefined {
			if (topology) {
				const snapshot = capture()
				const next = index(snapshot)
				const nodes = diff(graph.nodes, next.nodes)
				const edges = diff(graph.edges, next.edges)
				const families = diff(graph.families, next.families)
				const metadata = same(graph.metadata, next.metadata)
					? undefined
					: next.metadata
				graph = next
				linked = new Set(snapshot.edges.map(({ selector }) => selector))
				if (
					hasChanges(nodes) ||
					hasChanges(edges) ||
					hasChanges(families) ||
					metadata
				)
					return {
						nodes,
						...(hasChanges(edges) && { edges }),
						...(hasChanges(families) && { families }),
						...(metadata && { metadata }),
					}
				return
			}
			const upsert: EcologyNode[] = []
			for (const key of keys) {
				const node = graph.nodes.get(key)
				if (!node) continue
				const value = ecologyValue(store, key)
				if (same(value, node.value)) continue
				const updated: EcologyNode = {
					...node,
					value,
					dependencies:
						node.kind === `atom`
							? `not-applicable`
							: value.status === `cached` || linked.has(key)
								? `observed`
								: `unknown`,
				}
				graph.nodes.set(key, updated)
				upsert.push(updated)
			}
			if (upsert.length > 0) return { nodes: { upsert, remove: [] } }
		},
	}
}

function apply<T>(
	records: Map<string, T>,
	key: (record: T) => string,
	change: WorkerRecordsUpdate<T>,
): void {
	for (const removed of change.remove) records.delete(removed)
	for (const record of change.upsert) records.set(key(record), record)
}

export function projectWorkerEcology(initial: EcologySnapshot): {
	read(): EcologySnapshot
	update(change: WorkerEcologyUpdate): boolean
} {
	const graph = index(initial)
	let snapshot: EcologySnapshot | undefined = initial
	return {
		read: () =>
			(snapshot ??= {
				version: 1,
				nodes: [...graph.nodes.values()],
				edges: [...graph.edges.values()],
				families: [...graph.families.values()],
				...graph.metadata,
			}),
		update(change: WorkerEcologyUpdate): boolean {
			const topology =
				Boolean(change.edges ?? change.families ?? change.metadata) ||
				change.nodes.remove.length > 0 ||
				change.nodes.upsert.some((node) => {
					const previous = graph.nodes.get(node.key)
					return (
						node.type !== previous?.type ||
						node.dependencies !== previous.dependencies ||
						node.dependenciesTruncated !== previous.dependenciesTruncated ||
						!same(node.family, previous.family)
					)
				})
			apply(graph.nodes, keyOf, change.nodes)
			if (change.edges) apply(graph.edges, edgeKey, change.edges)
			if (change.families) apply(graph.families, keyOf, change.families)
			if (change.metadata) graph.metadata = change.metadata
			snapshot = undefined
			return topology
		},
	}
}
