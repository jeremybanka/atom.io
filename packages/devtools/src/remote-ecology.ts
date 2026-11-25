import type { RootStore } from "atom.io/internal"
import { isReservedIntrospectionKey } from "atom.io/internal"
import {
	peekDependencies,
	peekStateDefinition,
	type StoreChanges,
} from "atom.io/introspection"

import {
	captureEcologyOperations,
	captureEcologySnapshot,
	describeEcologyNode,
	type EcologyFamily,
	type EcologyLimits,
	type EcologyNode,
	type EcologyOperation,
	ecologyOperationId,
	type EcologySnapshot,
	ecologyValue,
	scanEcologyRelations,
} from "./ecology.ts"
import type {
	RemoteEcologyEdge,
	RemoteEcologyUpdate,
	RemoteRecordsUpdate,
} from "./remote-protocol.ts"

const keyOf = ({ key }: { key: string }) => key
const edgeKey = ({ dependency, selector }: RemoteEcologyEdge) =>
	JSON.stringify([dependency, selector])
const toMap = <T>(records: readonly T[], key: (record: NoInfer<T>) => string) =>
	new Map(records.map((record) => [key(record), record]))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function diff<T>(
	previous: Map<string, T>,
	next: Map<string, T>,
): RemoteRecordsUpdate<T> {
	return {
		upsert: [...next].flatMap(([key, record]) =>
			same(previous.get(key), record) ? [] : [record],
		),
		remove: [...previous.keys()].filter((key) => !next.has(key)),
	}
}

function hasChanges<T>(change: RemoteRecordsUpdate<T>): boolean {
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

type EcologyChanges = Pick<
	StoreChanges,
	`values` | `states` | `families` | `dependencies`
> & { operations?: boolean }

const remoteLimits = {
	maxNodes: 10_000,
	maxFamilies: 10_000,
	maxRelations: 50_000,
	maxOperations: 10_000,
}
const emptyChange = <T>(): RemoteRecordsUpdate<T> => ({ upsert: [], remove: [] })
const compare = (a: string, b: string) => (a < b ? -1 : Number(a > b))

function updateFrame(
	nodes: RemoteRecordsUpdate<EcologyNode>,
	edges: RemoteRecordsUpdate<RemoteEcologyEdge>,
	families: RemoteRecordsUpdate<EcologyFamily>,
	metadata: RemoteEcologyUpdate[`metadata`],
): RemoteEcologyUpdate | undefined {
	if (
		!hasChanges(nodes) &&
		!hasChanges(edges) &&
		!hasChanges(families) &&
		!metadata
	)
		return
	return {
		nodes,
		...(hasChanges(edges) && { edges }),
		...(hasChanges(families) && { families }),
		...(metadata && { metadata }),
	}
}

/** Track observed changes by key. Recapture when limits can change which records are visible. */
export function trackRemoteEcology(
	store: RootStore,
	options: EcologyLimits = {},
): {
	initial: EcologySnapshot
	update(changes: EcologyChanges): RemoteEcologyUpdate | undefined
} {
	const limits = { ...remoteLimits, ...options }
	const capture = () => captureEcologySnapshot(store, limits)
	const initial = capture()
	let operationCapture = initial.operations
	let operationRecords = toMap(operationCapture.records, ecologyOperationId)
	const neighbors = (key: string) => peekDependencies(store, key, 0).total
	const definition = (key: string) => peekStateDefinition(store, key)
	function indexTopology(snapshot: EcologySnapshot) {
		const incoming = new Map<string, Map<string, RemoteEcologyEdge>>()
		const members = new Map<string, Set<string>>()
		const degrees = new Map<string, number>()
		for (const edge of snapshot.edges) {
			let entries = incoming.get(edge.selector)
			if (!entries) incoming.set(edge.selector, (entries = new Map()))
			entries.set(edgeKey(edge), edge)
		}
		for (const node of snapshot.nodes) {
			if (node.family) {
				let keys = members.get(node.family.key)
				if (!keys) members.set(node.family.key, (keys = new Set()))
				keys.add(node.key)
			}
			if (node.kind === `selector`) degrees.set(node.key, neighbors(node.key))
		}
		return { ...index(snapshot), incoming, members, degrees }
	}
	let graph = indexTopology(initial)

	function recapture() {
		const next = indexTopology(capture())
		const update = updateFrame(
			diff(graph.nodes, next.nodes),
			diff(graph.edges, next.edges),
			diff(graph.families, next.families),
			same(graph.metadata, next.metadata) ? undefined : next.metadata,
		)
		graph = next
		return update
	}

	function updateValues(
		keys: ReadonlySet<string>,
	): RemoteEcologyUpdate | undefined {
		const nodes = emptyChange<EcologyNode>()
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
						: value.status === `cached` || graph.incoming.has(key)
							? `observed`
							: `unknown`,
			}
			graph.nodes.set(key, updated)
			nodes.upsert.push(updated)
		}
		if (hasChanges(nodes)) return { nodes }
	}

	function updateTopology(changes: EcologyChanges) {
		const inspectedNodes =
			store.atoms.size +
			store.readonlySelectors.size +
			store.writableSelectors.size
		if (
			Object.values(graph.metadata.truncated).includes(true) ||
			inspectedNodes > limits.maxNodes + Math.min(1, limits.maxNodes) * 1_000 ||
			store.families.size > limits.maxFamilies
		)
			return recapture()

		const nodes = emptyChange<EcologyNode>()
		const edges = emptyChange<RemoteEcologyEdge>()
		const families = emptyChange<EcologyFamily>()
		const familyKeys = new Set(changes.families)
		const topology = new Set([...changes.states, ...changes.dependencies])
		const incoming = new Map<string, Map<string, RemoteEcologyEdge>>()
		const relationKeys = new Set(topology)
		let nodeCount = graph.nodes.size
		let relationBudget = limits.maxRelations
		for (const key of topology) {
			const previous = graph.nodes.get(key)
			const state = definition(key)
			const node =
				state && !isReservedIntrospectionKey(key)
					? describeEcologyNode(store, state)
					: undefined
			const nextEdges: RemoteEcologyEdge[] = []
			if (node?.kind === `selector`) {
				const { inspected, incomplete } = scanEcologyRelations(
					store,
					key,
					relationBudget,
					nextEdges,
				)
				if (incomplete) return recapture()
				relationBudget -= inspected
			}
			const previousIncoming = graph.incoming.get(key) ?? new Map()
			const nextIncoming = toMap(nextEdges, edgeKey)
			incoming.set(key, nextIncoming)
			for (const [id, edge] of previousIncoming) {
				if (nextIncoming.has(id)) continue
				edges.remove.push(id)
				relationKeys.add(edge.dependency)
			}
			for (const [id, edge] of nextIncoming) {
				if (previousIncoming.has(id)) continue
				edges.upsert.push(edge)
				relationKeys.add(edge.dependency)
			}
			if (node) {
				const current: EcologyNode = nextEdges.length
					? { ...node, dependencies: `observed` }
					: node
				if (!same(previous, current)) nodes.upsert.push(current)
			} else if (previous) nodes.remove.push(key)
			nodeCount += Number(Boolean(node)) - Number(Boolean(previous))
		}
		if (nodeCount > limits.maxNodes) return recapture()

		let inspectedRelations = graph.metadata.work.relations
		const degrees = new Map<string, number>()
		for (const key of relationKeys) {
			const state = definition(key)
			const degree =
				state?.type.includes(`selector`) && !isReservedIntrospectionKey(key)
					? neighbors(key)
					: 0
			degrees.set(key, degree)
			inspectedRelations += degree - (graph.degrees.get(key) ?? 0)
		}
		if (inspectedRelations > limits.maxRelations) return recapture()

		for (const [key, degree] of degrees) {
			if (degree > 0) graph.degrees.set(key, degree)
			else graph.degrees.delete(key)
		}
		for (const [key, entries] of incoming) {
			if (entries.size > 0) graph.incoming.set(key, entries)
			else graph.incoming.delete(key)
		}
		const moveMember = (key: string, before?: string, after?: string) => {
			if (before === after) return
			if (before !== undefined) {
				familyKeys.add(before)
				const keys = graph.members.get(before)!
				keys.delete(key)
				if (!keys.size) graph.members.delete(before)
			}
			if (after !== undefined) {
				familyKeys.add(after)
				let keys = graph.members.get(after)
				if (!keys) graph.members.set(after, (keys = new Set()))
				keys.add(key)
			}
		}
		for (const key of nodes.remove)
			moveMember(key, graph.nodes.get(key)?.family?.key)
		for (const node of nodes.upsert)
			moveMember(
				node.key,
				graph.nodes.get(node.key)?.family?.key,
				node.family?.key,
			)
		for (const key of familyKeys) {
			const family = store.families.get(key)
			if (!family || isReservedIntrospectionKey(key)) {
				if (graph.families.has(key)) families.remove.push(key)
				continue
			}
			const memberKeys = [...(graph.members.get(key) ?? [])]
			const record: EcologyFamily = {
				key,
				type: family.type,
				memberKeys,
				memberCount: memberKeys.length,
				countComplete: true,
			}
			if (!same(graph.families.get(key), record)) families.upsert.push(record)
		}

		apply(graph.nodes, keyOf, nodes)
		apply(graph.edges, edgeKey, edges)
		apply(graph.families, keyOf, families)
		const values = new Set(
			[...changes.values].filter((key) => !topology.has(key)),
		)
		const valueChanges = updateValues(values)
		if (valueChanges) nodes.upsert.push(...valueChanges.nodes.upsert)
		const work = {
			nodes: inspectedNodes,
			families: store.families.size,
			relations: inspectedRelations,
		}
		const metadata = same(graph.metadata.work, work)
			? undefined
			: { ...graph.metadata, work }
		if (metadata) graph.metadata = metadata
		return updateFrame(nodes, edges, families, metadata)
	}

	return {
		initial,
		update(changes) {
			const state =
				changes.states.size || changes.dependencies.size || changes.families.size
					? updateTopology(changes)
					: updateValues(changes.values)
			if (!changes.operations && !(store.timelines.size && changes.states.size))
				return state
			const { records, ...metadata } = captureEcologyOperations(
				store,
				limits.maxOperations,
				limits.maxRelations,
			)
			const next = toMap(records, ecologyOperationId)
			const operations = diff(operationRecords, next)
			const changed =
				hasChanges(operations) ||
				metadata.work !== operationCapture.work ||
				metadata.truncated !== operationCapture.truncated ||
				!same(metadata.relations, operationCapture.relations)
			operationCapture = { records, ...metadata }
			operationRecords = next
			if (!changed) return state
			return {
				nodes: emptyChange<EcologyNode>(),
				...state,
				operations: { ...operations, ...metadata },
			}
		},
	}
}

function apply<T>(
	records: Map<string, T>,
	key: (record: T) => string,
	change: RemoteRecordsUpdate<T>,
): void {
	for (const removed of change.remove) records.delete(removed)
	for (const record of change.upsert) records.set(key(record), record)
}

export function projectRemoteEcology(initial: EcologySnapshot): {
	read(): EcologySnapshot
	update(change: RemoteEcologyUpdate): boolean
} {
	const graph = index(initial)
	const operations = toMap<EcologyOperation>(
		initial.operations?.records ?? [],
		ecologyOperationId,
	)
	let operationMetadata = initial.operations && {
		work: initial.operations.work,
		truncated: initial.operations.truncated,
		...(initial.operations.relations && {
			relations: initial.operations.relations,
		}),
	}
	let snapshot: EcologySnapshot | undefined
	return {
		read: () =>
			(snapshot ??= {
				version: 1,
				nodes: [...graph.nodes.values()].sort(
					(a, b) => compare(a.kind, b.kind) || compare(a.key, b.key),
				),
				edges: [...graph.edges.values()].sort(
					(a, b) =>
						compare(a.selector, b.selector) ||
						compare(a.dependency, b.dependency),
				),
				families: [...graph.families.values()]
					.sort((a, b) => compare(a.key, b.key))
					.map((family) => ({
						...family,
						memberKeys: [...family.memberKeys].sort(compare),
					})),
				...(operationMetadata && {
					operations: {
						...operationMetadata,
						records: [...operations.values()].sort(
							(a, b) => compare(a.type, b.type) || compare(a.key, b.key),
						),
					},
				}),
				...graph.metadata,
			}),
		update(change: RemoteEcologyUpdate): boolean {
			const topology =
				Boolean(
					change.edges ??
					change.families ??
					change.metadata ??
					change.operations,
				) ||
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
			if (change.operations) {
				apply(operations, ecologyOperationId, change.operations)
				const { work, truncated, relations } = change.operations
				operationMetadata = { work, truncated, ...(relations && { relations }) }
			}
			if (change.metadata) graph.metadata = change.metadata
			snapshot = undefined
			return topology
		},
	}
}
