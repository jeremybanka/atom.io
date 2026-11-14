import type { ReadableToken } from "atom.io"
import type { RootStore } from "atom.io/internal"
import { isReservedIntrospectionKey } from "atom.io/internal"

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
		| { readonly status: `cached`; readonly type: EcologyValueType }
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
export interface EcologyLimits {
	/** Returned application nodes, excluding reserved introspection records. Default 1,000; ceiling 10,000.
	 * Total state inspections are capped at maxNodes + 1,000, including excluded records and an omission probe.
	 * Zero disables state inspection. Exhausting either bound can truncate capture.
	 */
	readonly maxNodes?: number
	/** Counts inspected family records. Default 1,000; ceiling 10,000. */
	readonly maxFamilies?: number
	/** Counts inspected neighboring graph relations, including reverse/excluded relations. Default 5,000; ceiling 50,000. */
	readonly maxRelations?: number
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
function valueType(value: unknown): EcologyValueType {
	if (value === null) return `null`
	try {
		return Array.isArray(value) ? `array` : typeof value
	} catch {
		// Array.isArray can reject a revoked proxy. Never inspect prototypes or invoke getters.
		return `unknown`
	}
}

/** Capture the supplied root's committed view without reading state, evaluating defaults, or following transaction children. */
export function captureEcologySnapshot(
	store: RootStore,
	options: EcologyLimits = {},
): EcologySnapshot {
	const maxNodes = limit(options.maxNodes, 1_000, 10_000)
	const maxFamilies = limit(options.maxFamilies, 1_000, 10_000)
	const maxRelations = limit(options.maxRelations, 5_000, 50_000)
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
			const kind =
				state.type === `atom` || state.type === `mutable_atom`
					? `atom`
					: `selector`
			const cached = store.valueMap.has(state.key)
			nodes.push({
				key: state.key,
				kind,
				type: state.type,
				family: state.family
					? { key: state.family.key, subKey: state.family.subKey }
					: null,
				value: cached
					? { status: `cached`, type: valueType(store.valueMap.get(state.key)) }
					: { status: `unknown` },
				dependencies:
					kind === `atom` ? `not-applicable` : cached ? `observed` : `unknown`,
				dependenciesTruncated: false,
			})
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
		const related = store.selectorGraph.getRelatedKeys(node.key)
		if (!related) continue
		const neighbors = related.values()
		let inspected = 0,
			observed = node.dependencies === `observed`
		while (work.relations < maxRelations) {
			const entry = neighbors.next()
			if (entry.done) break
			work.relations++
			inspected++
			const dependency = entry.value
			if (
				store.selectorGraph.getContent(dependency, node.key)?.source ===
				dependency
			) {
				// Keep unknown/missing/reserved endpoints: dropping them would fabricate a complete trace.
				edges.push({ dependency, selector: node.key })
				observed = true
			}
		}
		const incomplete = inspected < related.size
		truncated.relations ||= incomplete
		nodes[index] = {
			...node,
			dependencies: observed ? `observed` : `unknown`,
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
	return { version: 1, nodes, edges, families, truncated, work }
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
