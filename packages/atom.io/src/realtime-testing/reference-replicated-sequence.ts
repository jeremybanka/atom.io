/** Actor-attributed edit group used by the reference replicated sequence. */
export type ReferenceEditGroup = {
	readonly actor: string
	readonly id: string
}

export type ReferenceSequenceInsert = {
	readonly after: string | null
	readonly group: ReferenceEditGroup
	readonly id: string
	readonly nodeId: string
	readonly type: `insert`
	readonly value: string
}

export type ReferenceSequenceDelete = {
	readonly group: ReferenceEditGroup
	readonly id: string
	readonly nodeId: string
	readonly type: `delete`
}

export type ReferenceSequenceToggle = {
	readonly active: boolean
	readonly group: ReferenceEditGroup
	readonly id: string
	readonly type: `toggle-group`
}

/** Immutable operations understood by {@link ReferenceSequenceReplica}. */
export type ReferenceSequenceOperation =
	| ReferenceSequenceDelete
	| ReferenceSequenceInsert
	| ReferenceSequenceToggle

export type ReferenceSequenceNode = {
	readonly after: string | null
	readonly id: string
	readonly value: string
	readonly visible: boolean
}

export type ReferenceSequenceState = {
	readonly nodes: readonly ReferenceSequenceNode[]
	readonly text: string
}

const groupKey = ({ actor, id }: ReferenceEditGroup): string => `${actor}\0${id}`

/** Compare strings by UTF-16 code units, independently of host locale. */
const compareCodeUnits = (left: string, right: string): number =>
	left < right ? -1 : left > right ? 1 : 0

/**
 * A deliberately small operation-set reference model for harness conformance.
 *
 * Inserts use stable predecessor anchors, sibling IDs provide deterministic
 * order, deletes are actor-owned marks, and group toggles provide selective
 * history. It is useful for exercising convergence infrastructure; it is not a
 * production text CRDT and intentionally uses JavaScript strings as node values.
 */
export class ReferenceSequenceReplica {
	#operations = new Map<string, ReferenceSequenceOperation>()

	/** Apply an operation idempotently. Conflicting reuse of an ID fails closed. */
	public apply(operation: ReferenceSequenceOperation): boolean {
		const previous = this.#operations.get(operation.id)
		if (previous !== undefined) {
			if (!structurallyEqual(previous, operation)) {
				throw new Error(
					`Operation ID ${operation.id} was reused with new content`,
				)
			}
			return false
		}
		if (operation.type === `insert` && operation.value.length === 0) {
			throw new Error(`Reference sequence insert values cannot be empty`)
		}
		this.#operations.set(operation.id, structuredClone(operation))
		return true
	}

	/** Apply any operation order; materialization depends only on the final set. */
	public applyAll(operations: Iterable<ReferenceSequenceOperation>): void {
		for (const operation of operations) this.apply(operation)
	}

	/** Stable snapshot of accepted operations, suitable for replication. */
	public operations(): readonly ReferenceSequenceOperation[] {
		return [...this.#operations.values()].sort((left, right) =>
			compareCodeUnits(left.id, right.id),
		)
	}

	/** Anchors or delete targets not present in the accepted operation set. */
	public invalidAnchors(): readonly string[] {
		const nodes = new Set(
			this.operations()
				.filter(
					(operation): operation is ReferenceSequenceInsert =>
						operation.type === `insert`,
				)
				.map(({ nodeId }) => nodeId),
		)
		const invalid = new Set<string>()
		for (const operation of this.#operations.values()) {
			if (
				operation.type === `insert` &&
				operation.after !== null &&
				!nodes.has(operation.after)
			) {
				invalid.add(operation.after)
			}
			if (operation.type === `delete` && !nodes.has(operation.nodeId)) {
				invalid.add(operation.nodeId)
			}
		}
		return [...invalid].sort(compareCodeUnits)
	}

	/** Materialize deterministic text and visibility without mutating the log. */
	public state(): ReferenceSequenceState {
		const operations = this.operations()
		const inserts = operations.filter(
			(operation): operation is ReferenceSequenceInsert =>
				operation.type === `insert`,
		)
		const duplicateNode = this.#duplicateNode(inserts)
		if (duplicateNode !== null) {
			throw new Error(`Node ID ${duplicateNode} was inserted more than once`)
		}
		const active = this.#groupActivity(operations)
		const deleted = new Set<string>()
		for (const operation of operations) {
			if (
				operation.type === `delete` &&
				(active.get(groupKey(operation.group)) ?? true)
			) {
				deleted.add(operation.nodeId)
			}
		}
		const children = new Map<string | null, ReferenceSequenceInsert[]>()
		for (const insert of inserts) {
			const siblings = children.get(insert.after) ?? []
			siblings.push(insert)
			children.set(insert.after, siblings)
		}
		for (const siblings of children.values()) {
			siblings.sort((left, right) => compareCodeUnits(left.nodeId, right.nodeId))
		}

		const nodes: ReferenceSequenceNode[] = []
		const visited = new Set<string>()
		const visit = (after: string | null): void => {
			for (const insert of children.get(after) ?? []) {
				visited.add(insert.nodeId)
				const visible =
					(active.get(groupKey(insert.group)) ?? true) &&
					!deleted.has(insert.nodeId)
				nodes.push({
					after: insert.after,
					id: insert.nodeId,
					value: insert.value,
					visible,
				})
				// Descendants remain traversable when their anchor is hidden.
				visit(insert.nodeId)
			}
		}
		visit(null)
		if (visited.size !== inserts.length) {
			const unreachable = inserts
				.map(({ nodeId }) => nodeId)
				.filter((nodeId) => !visited.has(nodeId))
			throw new Error(
				`Reference sequence contains cyclic or unreachable anchors: ${unreachable.join(`, `)}`,
			)
		}
		return {
			nodes,
			text: nodes
				.filter(({ visible }) => visible)
				.map(({ value }) => value)
				.join(``),
		}
	}

	#duplicateNode(inserts: readonly ReferenceSequenceInsert[]): string | null {
		const seen = new Set<string>()
		for (const { nodeId } of inserts) {
			if (seen.has(nodeId)) return nodeId
			seen.add(nodeId)
		}
		return null
	}

	#groupActivity(
		operations: readonly ReferenceSequenceOperation[],
	): ReadonlyMap<string, boolean> {
		const toggles = new Map<string, ReferenceSequenceToggle>()
		for (const operation of operations) {
			if (operation.type !== `toggle-group`) continue
			const key = groupKey(operation.group)
			const previous = toggles.get(key)
			if (
				previous === undefined ||
				compareCodeUnits(previous.id, operation.id) < 0
			) {
				toggles.set(key, operation)
			}
		}
		return new Map(
			[...toggles].map(([key, operation]) => [key, operation.active]),
		)
	}
}
import { structurallyEqual } from "./structural-equality"
