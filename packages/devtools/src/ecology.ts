import type { ReadableToken } from "atom.io"
import { Future } from "atom.io/foundations/future"
import type { ReadableState, RootStore } from "atom.io/internal"
import { hasRole, isReservedIntrospectionKey } from "atom.io/internal"
import {
	peekDependencies,
	peekState,
	peekStateDefinition,
} from "atom.io/introspection"

import { timelinePosition } from "./history-event.ts"
import { preview } from "./value.ts"

export type EcologyValueType =
	| `undefined`
	| `boolean`
	| `number`
	| `bigint`
	| `string`
	| `symbol`
	| `function`
	| `object`
	| `null`
	| `array`
	| `unknown`

export interface EcologyNode {
	readonly key: string
	readonly kind: `atom` | `selector`
	readonly type: ReadableToken<unknown>[`type`]
	readonly family: { readonly key: string; readonly subKey: string } | null
	readonly value:
		| { readonly status: `unknown` }
		| {
				readonly status: `cached`
				readonly type: EcologyValueType
				readonly preview?: string
		  }
	/** Retained observations, not static dependencies or a guarantee of a successful evaluation. */
	readonly dependencies: `not-applicable` | `unknown` | `observed`
	readonly dependenciesTruncated: boolean
}
export interface EcologyFamily {
	readonly key: string
	readonly type: string
	readonly memberKeys: readonly string[]
	/** Instantiated members only; a lower bound when countComplete is false. */
	readonly memberCount: number
	readonly countComplete: boolean
}
type EcologyTimeline = {
	readonly type: `timeline`
	readonly key: string
	readonly family: EcologyNode[`family`]
	readonly at: number
	readonly historyLength: number
}
export interface EcologyOperationTarget {
	readonly kind: `state` | `family`
	readonly key: string
}
export type EcologyOperation = (
	| { readonly type: `transaction`; readonly key: string }
	| EcologyTimeline
	| (EcologyFamily & { readonly type: `timeline_family` })
) & { readonly targets?: readonly EcologyOperationTarget[] }

export interface EcologyOperations {
	readonly records: readonly EcologyOperation[]
	readonly truncated: boolean
	readonly work: number
	readonly relations?: { readonly work: number; readonly truncated: boolean }
}

export interface EcologyLimits {
	/** Returned application nodes, excluding reserved introspection records. Default 1,000; ceiling 10,000.
	 * Total state inspections are capped at maxNodes + 1,000, including excluded records and an omission probe.
	 * Zero disables state inspection. Exhausting either bound can truncate capture.
	 */
	readonly maxNodes?: number
	/** Counts inspected family records. Default 1,000; ceiling 10,000. */
	readonly maxFamilies?: number
	/** Separate inspection budgets for selector and operation relationships. Default 5,000 each; ceiling 50,000 each. */
	readonly maxRelations?: number
	/** Counts inspected transaction, timeline, and timeline family records. Default 1,000; ceiling 10,000. */
	readonly maxOperations?: number
}
export interface EcologySnapshot {
	readonly version: 1
	readonly nodes: readonly EcologyNode[]
	/** Direction: dependency -> selector. Missing or excluded endpoints are retained as keys. */
	readonly edges: readonly {
		readonly dependency: string
		readonly selector: string
	}[]
	readonly families: readonly EcologyFamily[]
	/** Absent from version 1 captures predating operation records. */
	readonly operations?: EcologyOperations
	readonly truncated: {
		readonly nodes: boolean
		readonly families: boolean
		readonly relations: boolean
	}
	readonly work: {
		/** Actual inspected state records, including excluded records and any omitted-node probe. */
		readonly nodes: number
		readonly families: number
		readonly relations: number
	}
}

function limit(
	value: number | undefined,
	fallback: number,
	ceiling: number,
): number {
	if (value === undefined) return fallback
	if (!Number.isSafeInteger(value) || value < 0 || value > ceiling)
		throw new RangeError(
			`Ecology work limit must be an integer between 0 and ${ceiling}`,
		)
	return value
}

export function ecologyOperationId(operation: EcologyOperation): string {
	return `${operation.type}:${operation.key}`
}

export const ecologyOperationLabels = {
	transaction: `Transaction`,
	timeline: `Timeline`,
	timeline_family: `Timeline Family`,
} as const

export function ecologyTimelinePosition(
	timeline: EcologyTimeline,
	live?: { at: number; history: readonly unknown[] },
): string {
	return timelinePosition(
		live?.at ?? timeline.at,
		live?.history.length ?? timeline.historyLength,
	)
}

export function captureEcologyOperations(
	store: RootStore,
	maxOperations?: number,
	maxRelations?: number,
): EcologyOperations {
	const budget = limit(maxOperations, 1_000, 10_000)
	const relationBudget = limit(maxRelations, 5_000, 50_000)
	const relations = { work: 0, truncated: false }
	const maps = [store.timelineFamilies, store.transactions, store.timelines]
	const records: EcologyOperation[] = []
	const families: { key: string; targets?: EcologyOperationTarget[] }[] = []
	const members = new Map<string, string[]>()
	const captureTargets = (
		keys: Iterable<string>,
		kind: (key: string) => EcologyOperationTarget[`kind`] | undefined,
	): { targets?: EcologyOperationTarget[] } => {
		const targets: EcologyOperationTarget[] = []
		for (const key of keys) {
			if (relations.work === relationBudget) {
				relations.truncated = true
				break
			}
			relations.work++
			if (isReservedIntrospectionKey(key)) continue
			const targetKind = kind(key)
			if (targetKind) targets.push({ kind: targetKind, key })
		}
		return targets.length ? { targets } : {}
	}
	let work = 0
	for (const map of maps) {
		const entries = map.values()
		while (work < budget) {
			const entry = entries.next()
			if (entry.done) break
			work++
			const { key, type } = entry.value
			if (isReservedIntrospectionKey(key) || key.startsWith(`👁‍🗨`)) continue
			if (type === `timeline_family`) {
				families.push({
					key,
					...captureTargets(entry.value.routes.keys(), () => `family`),
				})
			} else if (type === `transaction`) {
				const writes = entry.value.observedWrites
				relations.truncated ||= writes?.truncated ?? false
				records.push({
					type,
					key,
					...captureTargets(writes?.keys ?? [], () => `state`),
				})
			} else {
				const { at, history, family } = entry.value
				const topics = store.timelineTopics
				records.push({
					type,
					key,
					family: family ? { key: family.key, subKey: family.subKey } : null,
					at,
					historyLength: history.length,
					...captureTargets(topics.getRelatedKeys(key) ?? [], (target) => {
						const topicType = topics.getContent(key, target)?.topicType
						if (topicType === `atom_family`) return `family`
						if (topicType !== `atom`) return
						const atom = store.atoms.get(target)
						if (atom && !hasRole(atom, `tracker:signal`)) return `state`
					}),
				})
				if (family) {
					let keys = members.get(family.key)
					if (!keys) members.set(family.key, (keys = []))
					keys.push(key)
				}
			}
		}
	}
	const truncated = work < maps.reduce((sum, map) => sum + map.size, 0)
	for (const family of families) {
		const { key } = family
		const memberKeys = members.get(key) ?? []
		records.push({
			type: `timeline_family`,
			...family,
			memberKeys,
			memberCount: memberKeys.length,
			countComplete: !truncated,
		})
	}
	return {
		records,
		truncated,
		work,
		...((relations.work > 0 || relations.truncated) && { relations }),
	}
}

function valueType(value: unknown): EcologyValueType {
	if (value === null) return `null`
	try {
		return Array.isArray(value) ? `array` : typeof value
	} catch {
		// Array.isArray can reject a revoked proxy. Never inspect prototypes or invoke getters.
		return `unknown`
	}
}

export function ecologyValue(
	store: RootStore,
	key: string,
): EcologyNode[`value`] {
	const cached = peekState(store, key)
	return cached.present
		? {
				status: `cached`,
				type: valueType(cached.value),
				preview: preview(cached.value),
			}
		: { status: `unknown` }
}

export function describeEcologyNode(
	store: RootStore,
	state: ReadableState<any, any>,
): EcologyNode {
	const kind =
		state.type === `atom` || state.type === `mutable_atom` ? `atom` : `selector`
	const value = ecologyValue(store, state.key)
	return {
		key: state.key,
		kind,
		type: state.type,
		family: state.family
			? { key: state.family.key, subKey: state.family.subKey }
			: null,
		value,
		dependencies:
			kind === `atom`
				? `not-applicable`
				: value.status === `cached`
					? `observed`
					: `unknown`,
		dependenciesTruncated: false,
	}
}

export function scanEcologyRelations(
	store: RootStore,
	selector: string,
	budget: number,
	edges: EcologySnapshot[`edges`][number][],
): { inspected: number; incomplete: boolean } {
	const { dependencies, inspected, total } = peekDependencies(
		store,
		selector,
		budget,
	)
	for (const dependency of dependencies) edges.push({ dependency, selector })
	return { inspected, incomplete: inspected < total }
}

type EcologyLoadStatus = `pending` | `settled` | `caught` | undefined

export function ecologyLoadState(
	store: RootStore,
	key: string,
): {
	definition: ReadableState<any, any> | undefined
	raw: unknown
	status: EcologyLoadStatus
} {
	const definition = peekStateDefinition(store, key)
	const raw = peekState(store, key).value
	let status: EcologyLoadStatus
	if (typeof raw === `object` && raw !== null) {
		try {
			if (raw instanceof Future) status = raw.done ? `settled` : `pending`
			else if (
				definition &&
				`catch` in definition &&
				definition.catch.some((ErrorType) => raw instanceof ErrorType)
			)
				status = `caught`
		} catch {
			// Proxies can reject prototype inspection.
		}
	}
	return { definition, raw, status }
}

/** Capture the supplied root's committed view without reading state, evaluating defaults, or following transaction children. */
export function captureEcologySnapshot(
	store: RootStore,
	options: EcologyLimits = {},
): EcologySnapshot & { readonly operations: EcologyOperations } {
	const maxNodes = limit(options.maxNodes, 1_000, 10_000)
	const maxFamilies = limit(options.maxFamilies, 1_000, 10_000)
	const maxRelations = limit(options.maxRelations, 5_000, 50_000)
	const operations = captureEcologyOperations(
		store,
		options.maxOperations,
		maxRelations,
	)
	const maxNodeInspections = maxNodes === 0 ? 0 : maxNodes + 1_000
	let omittedNode = false
	const work = { nodes: 0, families: 0, relations: 0 }
	const nodes: EcologyNode[] = []
	const edges: { dependency: string; selector: string }[] = []
	const members = new Map<string, string[]>()
	const maps = [store.atoms, store.readonlySelectors, store.writableSelectors]
	for (const map of maps) {
		const states = map.values()
		while (work.nodes < maxNodeInspections) {
			const entry = states.next()
			if (entry.done) break
			work.nodes++
			const state = entry.value
			if (isReservedIntrospectionKey(state.key)) continue
			if (nodes.length === maxNodes) {
				omittedNode = true
				break
			}
			nodes.push(describeEcologyNode(store, state))
			if (state.family) {
				let keys = members.get(state.family.key)
				if (!keys) members.set(state.family.key, (keys = []))
				keys.push(state.key)
			}
		}
		if (omittedNode) break
	}
	const truncated = {
		nodes:
			omittedNode || work.nodes < maps.reduce((sum, map) => sum + map.size, 0),
		families: false,
		relations: false,
	}
	for (let index = 0; index < nodes.length; index++) {
		const node = nodes[index]
		if (node.kind === `atom`) continue
		const previous = edges.length
		const { inspected, incomplete } = scanEcologyRelations(
			store,
			node.key,
			maxRelations - work.relations,
			edges,
		)
		work.relations += inspected
		if (inspected === 0 && !incomplete) continue
		truncated.relations ||= incomplete
		nodes[index] = {
			...node,
			dependencies: edges.length > previous ? `observed` : node.dependencies,
			dependenciesTruncated: incomplete,
		}
	}
	const families: EcologyFamily[] = []
	const registered = store.families.values()
	while (work.families < maxFamilies) {
		const entry = registered.next()
		if (entry.done) break
		work.families++
		const family = entry.value
		if (isReservedIntrospectionKey(family.key)) continue
		const memberKeys = members.get(family.key) ?? []
		families.push({
			key: family.key,
			type: family.type,
			memberKeys,
			memberCount: memberKeys.length,
			countComplete: !truncated.nodes,
		})
	}
	truncated.families = work.families < store.families.size
	return { version: 1, nodes, edges, families, operations, truncated, work }
}

export interface EcologyRootTrace {
	readonly rootKeys: readonly string[]
	readonly visitedKeys: readonly string[]
	readonly unresolvedKeys: readonly string[]
	/** Back-edge destinations encountered on the active DFS path, not all cycle members. */
	readonly cycleKeys: readonly string[]
	/** 'observed' covers only the retained graph, never unobserved future dependencies. */
	readonly status: `observed` | `incomplete` | `truncated`
	readonly work: number
}

/** Iterative root tracing. The budget includes snapshot indexing and edge traversal, not just returned roots. */
export function traceEcologyRoots(
	snapshot: EcologySnapshot,
	key: string,
	options: { readonly maxWork?: number } = {},
): EcologyRootTrace {
	const maxWork = limit(options.maxWork, 50_000, 1_000_000)
	let work = 0,
		truncated = false
	const spend = () => {
		if (work >= maxWork) {
			truncated = true
			return false
		}
		work++
		return true
	}
	const nodes = new Map<string, EcologyNode>()
	const dependencies = new Map<string, string[]>()
	for (const node of snapshot.nodes) {
		if (!spend()) break
		nodes.set(node.key, node)
	}
	for (const edge of snapshot.edges) {
		if (!spend()) break
		let upstream = dependencies.get(edge.selector)
		if (!upstream) dependencies.set(edge.selector, (upstream = []))
		upstream.push(edge.dependency)
	}
	const roots = new Set<string>(),
		unresolved = new Set<string>(),
		cycles = new Set<string>()
	const colors = new Map<string, `active` | `done`>()
	const stack: { key: string; next: number }[] = [{ key, next: -1 }]
	while (stack.length && !truncated) {
		if (!spend()) break
		const frame = stack.at(-1)!
		const node = nodes.get(frame.key)
		if (frame.next === -1) {
			colors.set(frame.key, `active`)
			frame.next = 0
			if (!node || node.dependencies === `unknown` || node.dependenciesTruncated)
				unresolved.add(frame.key)
			if (node?.kind === `atom`) roots.add(frame.key)
		}
		const upstream = dependencies.get(frame.key)
		if (!upstream || frame.next >= upstream.length) {
			colors.set(frame.key, `done`)
			stack.pop()
			continue
		}
		const dependency = upstream[frame.next++]
		const color = colors.get(dependency)
		if (color === `active`) cycles.add(dependency)
		else if (color !== `done`) stack.push({ key: dependency, next: -1 })
	}
	return {
		rootKeys: [...roots],
		visitedKeys: [...colors.keys()],
		unresolvedKeys: [...unresolved],
		cycleKeys: [...cycles],
		status: truncated
			? `truncated`
			: unresolved.size
				? `incomplete`
				: `observed`,
		work,
	}
}
