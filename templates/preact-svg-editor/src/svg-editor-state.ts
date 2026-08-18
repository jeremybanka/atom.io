import type { TransactionToken } from "atom.io"
import {
	atom,
	atomFamily,
	getState,
	runTransaction,
	selector,
	selectorFamily,
	setState,
	transaction,
} from "atom.io"
import { z } from "zod"

import {
	EMPTY_SVG_ORDER,
	emptySvgRegister,
	materializeSvgOrder,
	placeSvgOrderEntry,
	readSvgRegister,
	reduceSvgOrder,
	reduceSvgRegister,
	removeSvgOrderEntry,
	svgOrderOperationSchema,
	svgOrderStateSchema,
	svgRegisterOperationSchema,
	svgRegisterStateSchema,
	type SvgOrderState,
	type SvgRegisterState,
} from "./svg-convergence.ts"

export type PointXY = { readonly x: number; readonly y: number }

export type SvgEdge =
	| { readonly kind: `close` }
	| { readonly kind: `line` | `move` }
	| {
			readonly c?: PointXY | undefined
			readonly kind: `cubic`
			readonly s: PointXY
	  }

export type SvgPath = { readonly id: string }
export type SvgSubpath = { readonly id: string; readonly pathId: string }

export type SvgSubpathFixture = {
	readonly edge: SvgEdge
	readonly id: string
	readonly node: PointXY | null
}

export type SvgPathFixture = {
	readonly id: string
	readonly subpaths: readonly SvgSubpathFixture[]
}

export type SvgDrawingFixture = { readonly paths: readonly SvgPathFixture[] }

export type SvgGesture = {
	readonly actor: string
	readonly id: string
	readonly logicalTime: number
	readonly session: string
}

export type SvgDragTarget =
	| { readonly kind: `node`; readonly subpathId: string }
	| {
			readonly control: `c` | `s`
			readonly kind: `edge-control`
			readonly subpathId: string
	  }

export type SvgDragPresence = {
	readonly actor: string
	readonly gestureId: string
	readonly point: PointXY
	readonly sequence: number
	readonly session: string
	readonly target: SvgDragTarget
}

export type SvgCollaborationPresence = {
	readonly activePathId: string | null
	readonly actor: string
	readonly color: string
	readonly name: string
	readonly pointer: PointXY | null
	readonly selectedSubpathId: string | null
	readonly session: string
}

export type SvgActiveDrag = {
	readonly gesture: SvgGesture
	readonly pointerId: number
	readonly target: SvgDragTarget
}

export type SvgWorkspace = {
	readonly activePathId: string | null
	readonly selectedSubpathIds: readonly string[]
}

export type SvgViewport = {
	readonly pan: PointXY
	readonly zoom: number
}

const pointSchema: z.ZodType<PointXY> = z
	.object({ x: z.number().finite(), y: z.number().finite() })
	.strict()

const edgeSchema: z.ZodType<SvgEdge> = z.discriminatedUnion(`kind`, [
	z.object({ kind: z.literal(`close`) }).strict(),
	z.object({ kind: z.literal(`line`) }).strict(),
	z.object({ kind: z.literal(`move`) }).strict(),
	z
		.object({
			c: pointSchema.optional(),
			kind: z.literal(`cubic`),
			s: pointSchema,
		})
		.strict(),
])

const pathSchema: z.ZodType<SvgPath> = z
	.object({ id: z.string().min(1) })
	.strict()

const subpathSchema: z.ZodType<SvgSubpath> = z
	.object({ id: z.string().min(1), pathId: z.string().min(1) })
	.strict()

export const svgNodeStateSchema = svgRegisterStateSchema(pointSchema.nullable())
export const svgNodeOperationSchema = svgRegisterOperationSchema(
	pointSchema.nullable(),
)
export const svgEdgeStateSchema = svgRegisterStateSchema(edgeSchema.nullable())
export const svgEdgeOperationSchema = svgRegisterOperationSchema(
	edgeSchema.nullable(),
)
export const svgPathStateSchema = svgRegisterStateSchema(pathSchema.nullable())
export const svgPathOperationSchema = svgRegisterOperationSchema(
	pathSchema.nullable(),
)
export const svgSubpathStateSchema = svgRegisterStateSchema(
	subpathSchema.nullable(),
)
export const svgSubpathOperationSchema = svgRegisterOperationSchema(
	subpathSchema.nullable(),
)

/** Durable members remain ordinary Atom.io atoms and atom families. */
export const pathOrderAtom = atom<SvgOrderState>({
	key: `svgPathOrder`,
	default: EMPTY_SVG_ORDER,
})
export const pathAtoms = atomFamily<SvgRegisterState<SvgPath | null>, string>({
	key: `svgPaths`,
	default: emptySvgRegister(),
})
export const subpathOrderAtoms = atomFamily<SvgOrderState, string>({
	key: `svgSubpathOrder`,
	default: EMPTY_SVG_ORDER,
})
export const subpathAtoms = atomFamily<
	SvgRegisterState<SvgSubpath | null>,
	string
>({ key: `svgSubpaths`, default: emptySvgRegister() })
export const nodeAtoms = atomFamily<SvgRegisterState<PointXY | null>, string>({
	key: `svgNodes`,
	default: emptySvgRegister(),
})
export const edgeAtoms = atomFamily<SvgRegisterState<SvgEdge | null>, string>({
	key: `svgEdges`,
	default: emptySvgRegister(),
})

/** Local-only state is deliberately absent from the durable model inventory. */
export const svgElementAtom = atom<SVGSVGElement | null>({
	key: `svgElement`,
	default: null,
})
export const pointerCaptureAtom = atom<{
	readonly element: Element
	readonly pointerId: number
} | null>({ key: `svgPointerCapture`, default: null })
export const activeDragAtom = atom<SvgActiveDrag | null>({
	key: `svgActiveDrag`,
	default: null,
})
export const viewportAtom = atom<SvgViewport>({
	key: `svgViewport`,
	default: { pan: { x: 0, y: 0 }, zoom: 1 },
})
export const workspaceAtom = atom<SvgWorkspace>({
	key: `svgWorkspace`,
	default: { activePathId: null, selectedSubpathIds: [] },
})

/** Ephemeral presence is addressable by logical actor/session, never by a DOM node. */
export const dragPresenceAtoms = atomFamily<SvgDragPresence | null, string>({
	key: `svgDragPresence`,
	default: null,
})

/** Identity, focus, pointer, and selection are lossy collaboration presence. */
export const collaborationPresenceAtoms = atomFamily<
	SvgCollaborationPresence | null,
	string
>({ key: `svgCollaborationPresence`, default: null })

/** Distinguish concurrent sessions belonging to the same logical actor. */
export function svgDragPresenceKey(
	identity: Pick<SvgGesture, `actor` | `session`>,
): string {
	return `${identity.actor}\u0000${identity.session}`
}

export const svgCollaborationPresenceKey = svgDragPresenceKey

export const projectedNodeSelectors = selectorFamily<PointXY | null, string>({
	key: `svgProjectedNode`,
	get:
		(subpathId) =>
		({ get }) => {
			const durable = readSvgRegister(get(nodeAtoms, subpathId)) ?? null
			const drag = get(activeDragAtom)
			if (drag?.target.kind !== `node` || drag.target.subpathId !== subpathId) {
				return durable
			}
			const presence = get(dragPresenceAtoms, svgDragPresenceKey(drag.gesture))
			return presence?.gestureId === drag.gesture.id ? presence.point : durable
		},
})

export const projectedEdgeSelectors = selectorFamily<SvgEdge | null, string>({
	key: `svgProjectedEdge`,
	get:
		(subpathId) =>
		({ get }) => {
			const durable = readSvgRegister(get(edgeAtoms, subpathId)) ?? null
			const drag = get(activeDragAtom)
			if (
				durable?.kind !== `cubic` ||
				drag?.target.kind !== `edge-control` ||
				drag.target.subpathId !== subpathId
			) {
				return durable
			}
			const presence = get(dragPresenceAtoms, svgDragPresenceKey(drag.gesture))
			const point =
				presence?.gestureId === drag.gesture.id ? presence.point : undefined
			if (point === undefined) return durable
			return drag.target.control === `c`
				? { ...durable, c: point }
				: { ...durable, s: point }
		},
})

export const pathDrawSelectors = selectorFamily<string, string>({
	key: `svgPathDraw`,
	get:
		(pathId) =>
		({ get }) =>
			materializeSvgOrder(get(subpathOrderAtoms, pathId))
				.map(({ value: subpathId }, index) => {
					const node = get(projectedNodeSelectors, subpathId)
					const edge = get(projectedEdgeSelectors, subpathId)
					if (edge?.kind === `close`) return `Z`
					if (node === null || edge === null) return ``
					if (index === 0 || edge.kind === `move`) {
						return `M ${node.x} ${node.y}`
					}
					if (edge.kind === `line`) return `L ${node.x} ${node.y}`
					if (edge.kind === `cubic` && edge.c !== undefined) {
						return `C ${edge.c.x} ${edge.c.y} ${edge.s.x} ${edge.s.y} ${node.x} ${node.y}`
					}
					if (edge.kind === `cubic`) {
						return `S ${edge.s.x} ${edge.s.y} ${node.x} ${node.y}`
					}
					return ``
				})
				.filter(Boolean)
				.join(` `),
})

export type SvgStructureViolation = {
	readonly code:
		| `duplicate-path`
		| `duplicate-subpath`
		| `edge-node-mismatch`
		| `missing-edge`
		| `missing-node`
		| `missing-path`
		| `missing-subpath`
		| `wrong-path`
	readonly pathId: string
	readonly subpathId?: string
}

function duplicateValues(values: readonly string[]): ReadonlySet<string> {
	const seen = new Set<string>()
	const duplicates = new Set<string>()
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value)
		seen.add(value)
	}
	return duplicates
}

/** Inspect only durable state, so an in-flight drag cannot hide corruption. */
export const structureViolationsSelector = selector<
	readonly SvgStructureViolation[]
>({
	key: `svgStructureViolations`,
	get: ({ get }) => {
		const violations: SvgStructureViolation[] = []
		const pathIds = materializeSvgOrder(get(pathOrderAtom)).map(
			({ value }) => value,
		)
		for (const pathId of duplicateValues(pathIds)) {
			violations.push({ code: `duplicate-path`, pathId })
		}
		for (const pathId of pathIds) {
			const path = readSvgRegister(get(pathAtoms, pathId))
			if (path?.id !== pathId) {
				violations.push({ code: `missing-path`, pathId })
				continue
			}
			const subpathIds = materializeSvgOrder(get(subpathOrderAtoms, pathId)).map(
				({ value }) => value,
			)
			for (const subpathId of duplicateValues(subpathIds)) {
				violations.push({ code: `duplicate-subpath`, pathId, subpathId })
			}
			for (const subpathId of subpathIds) {
				const subpath = readSvgRegister(get(subpathAtoms, subpathId))
				if (subpath?.id !== subpathId) {
					violations.push({ code: `missing-subpath`, pathId, subpathId })
					continue
				}
				if (subpath.pathId !== pathId) {
					violations.push({ code: `wrong-path`, pathId, subpathId })
				}
				const nodeState = get(nodeAtoms, subpathId)
				const edgeState = get(edgeAtoms, subpathId)
				const node = readSvgRegister(nodeState)
				const edge = readSvgRegister(edgeState)
				if (Object.keys(nodeState.operations).length === 0) {
					violations.push({ code: `missing-node`, pathId, subpathId })
				}
				if (edge === undefined || edge === null) {
					violations.push({ code: `missing-edge`, pathId, subpathId })
				} else if ((edge.kind === `close`) !== (node === null)) {
					violations.push({ code: `edge-node-mismatch`, pathId, subpathId })
				}
			}
		}
		return violations
	},
})

export function createSvgGestureClock(options: {
	readonly actor: string
	readonly initialLogicalTime?: number
	readonly session: string
}): {
	readonly begin: () => SvgGesture
	readonly observe: (logicalTime: number) => void
} {
	if (options.actor.length === 0 || options.session.length === 0) {
		throw new Error(`SVG gesture actor and session identities must be nonempty`)
	}
	const initialLogicalTime = options.initialLogicalTime ?? 0
	if (!Number.isSafeInteger(initialLogicalTime) || initialLogicalTime < 0) {
		throw new Error(`Initial SVG logical time must be a nonnegative integer`)
	}
	let logicalTime = initialLogicalTime
	return {
		begin: () => {
			logicalTime++
			return {
				actor: options.actor,
				id: `${options.actor}/${options.session}/${logicalTime.toString().padStart(12, `0`)}`,
				logicalTime,
				session: options.session,
			}
		},
		observe: (observed) => {
			if (!Number.isSafeInteger(observed) || observed < 0) {
				throw new Error(
					`Observed SVG logical time must be a nonnegative integer`,
				)
			}
			logicalTime = Math.max(logicalTime, observed)
		},
	}
}

export function svgOperationId(gesture: SvgGesture, ordinal: number): string {
	if (!Number.isSafeInteger(gesture.logicalTime) || gesture.logicalTime < 0) {
		throw new Error(`SVG gesture logical time must be a nonnegative integer`)
	}
	if (!Number.isSafeInteger(ordinal) || ordinal < 0) {
		throw new Error(`SVG operation ordinal must be a nonnegative integer`)
	}
	return `${gesture.logicalTime.toString().padStart(16, `0`)}:${gesture.actor}:${gesture.id}:${ordinal.toString().padStart(8, `0`)}`
}

function assertFixture(fixture: SvgDrawingFixture): void {
	const pathIds = fixture.paths.map(({ id }) => id)
	if (duplicateValues(pathIds).size > 0) {
		throw new Error(`An SVG drawing cannot contain duplicate path IDs`)
	}
	const allSubpathIds = new Set<string>()
	for (const path of fixture.paths) {
		if (path.id.length === 0) throw new Error(`An SVG path ID cannot be empty`)
		for (const subpath of path.subpaths) {
			if (subpath.id.length === 0 || allSubpathIds.has(subpath.id)) {
				throw new Error(`SVG subpath IDs must be nonempty and globally unique`)
			}
			allSubpathIds.add(subpath.id)
			if ((subpath.edge.kind === `close`) !== (subpath.node === null)) {
				throw new Error(`Only a close edge may have a null SVG node`)
			}
		}
	}
}

type GestureInput = { readonly gesture: SvgGesture }

export const replaceDrawingTransaction = transaction<
	(input: GestureInput & { readonly drawing: SvgDrawingFixture }) => void
>({
	key: `replaceSvgDrawing`,
	do: ({ get, set }, { drawing, gesture }) => {
		assertFixture(drawing)
		let ordinal = 0
		const nextId = () => svgOperationId(gesture, ordinal++)
		let nextPathOrder = get(pathOrderAtom)
		for (const { value: pathId } of materializeSvgOrder(nextPathOrder)) {
			let nextSubpathOrder = get(subpathOrderAtoms, pathId)
			for (const { entryId, value: subpathId } of materializeSvgOrder(
				nextSubpathOrder,
			)) {
				nextSubpathOrder = removeSvgOrderEntry(
					nextSubpathOrder,
					entryId,
					nextId(),
				)
				set(
					subpathAtoms,
					subpathId,
					reduceSvgRegister(get(subpathAtoms, subpathId), {
						id: nextId(),
						value: null,
					}),
				)
				set(
					nodeAtoms,
					subpathId,
					reduceSvgRegister(get(nodeAtoms, subpathId), {
						id: nextId(),
						value: null,
					}),
				)
				set(
					edgeAtoms,
					subpathId,
					reduceSvgRegister(get(edgeAtoms, subpathId), {
						id: nextId(),
						value: null,
					}),
				)
			}
			set(subpathOrderAtoms, pathId, nextSubpathOrder)
			set(
				pathAtoms,
				pathId,
				reduceSvgRegister(get(pathAtoms, pathId), {
					id: nextId(),
					value: null,
				}),
			)
			nextPathOrder = removeSvgOrderEntry(nextPathOrder, pathId, nextId())
		}

		for (const [pathIndex, path] of drawing.paths.entries()) {
			set(
				pathAtoms,
				path.id,
				reduceSvgRegister(get(pathAtoms, path.id), {
					id: nextId(),
					value: { id: path.id },
				}),
			)
			nextPathOrder = placeSvgOrderEntry(nextPathOrder, {
				entryId: path.id,
				id: nextId(),
				index: pathIndex,
				value: path.id,
			})
			let nextSubpathOrder = get(subpathOrderAtoms, path.id)
			for (const [subpathIndex, subpath] of path.subpaths.entries()) {
				set(
					subpathAtoms,
					subpath.id,
					reduceSvgRegister(get(subpathAtoms, subpath.id), {
						id: nextId(),
						value: { id: subpath.id, pathId: path.id },
					}),
				)
				set(
					nodeAtoms,
					subpath.id,
					reduceSvgRegister(get(nodeAtoms, subpath.id), {
						id: nextId(),
						value: subpath.node,
					}),
				)
				set(
					edgeAtoms,
					subpath.id,
					reduceSvgRegister(get(edgeAtoms, subpath.id), {
						id: nextId(),
						value: subpath.edge,
					}),
				)
				nextSubpathOrder = placeSvgOrderEntry(nextSubpathOrder, {
					entryId: subpath.id,
					id: nextId(),
					index: subpathIndex,
					value: subpath.id,
				})
			}
			set(subpathOrderAtoms, path.id, nextSubpathOrder)
		}
		set(pathOrderAtom, nextPathOrder)
	},
})

export const insertPathTransaction = transaction<
	(
		input: GestureInput & {
			readonly index: number
			readonly pathId: string
		},
	) => void
>({
	key: `insertSvgPath`,
	do: ({ get, set }, { gesture, index, pathId }) => {
		if (readSvgRegister(get(pathAtoms, pathId)) != null) {
			throw new Error(`SVG path ${pathId} already exists`)
		}
		set(
			pathAtoms,
			pathId,
			reduceSvgRegister(get(pathAtoms, pathId), {
				id: svgOperationId(gesture, 0),
				value: { id: pathId },
			}),
		)
		set(
			pathOrderAtom,
			placeSvgOrderEntry(get(pathOrderAtom), {
				entryId: pathId,
				id: svgOperationId(gesture, 1),
				index,
				value: pathId,
			}),
		)
	},
})

export const deletePathTransaction = transaction<
	(input: GestureInput & { readonly pathId: string }) => void
>({
	key: `deleteSvgPath`,
	do: ({ get, set }, { gesture, pathId }) => {
		if (readSvgRegister(get(pathAtoms, pathId)) == null) {
			throw new Error(`SVG path ${pathId} does not exist`)
		}
		let ordinal = 0
		const nextId = () => svgOperationId(gesture, ordinal++)
		let order = get(subpathOrderAtoms, pathId)
		for (const { entryId, value: subpathId } of materializeSvgOrder(order)) {
			order = removeSvgOrderEntry(order, entryId, nextId())
			set(
				subpathAtoms,
				subpathId,
				reduceSvgRegister(get(subpathAtoms, subpathId), {
					id: nextId(),
					value: null,
				}),
			)
			set(
				nodeAtoms,
				subpathId,
				reduceSvgRegister(get(nodeAtoms, subpathId), {
					id: nextId(),
					value: null,
				}),
			)
			set(
				edgeAtoms,
				subpathId,
				reduceSvgRegister(get(edgeAtoms, subpathId), {
					id: nextId(),
					value: null,
				}),
			)
		}
		set(subpathOrderAtoms, pathId, order)
		set(
			pathAtoms,
			pathId,
			reduceSvgRegister(get(pathAtoms, pathId), {
				id: nextId(),
				value: null,
			}),
		)
		set(pathOrderAtom, removeSvgOrderEntry(get(pathOrderAtom), pathId, nextId()))
	},
})

type SubpathInput = GestureInput & {
	readonly edge: SvgEdge
	readonly index: number
	readonly node: PointXY | null
	readonly pathId: string
	readonly subpathId: string
}

export const insertSubpathTransaction = transaction<
	(input: SubpathInput) => void
>({
	key: `insertSvgSubpath`,
	do: ({ get, set }, input) => {
		if (readSvgRegister(get(pathAtoms, input.pathId)) == null) {
			throw new Error(`SVG path ${input.pathId} does not exist`)
		}
		if (readSvgRegister(get(subpathAtoms, input.subpathId)) != null) {
			throw new Error(`SVG subpath ${input.subpathId} already exists`)
		}
		if ((input.edge.kind === `close`) !== (input.node === null)) {
			throw new Error(`Only a close edge may have a null SVG node`)
		}
		set(
			subpathAtoms,
			input.subpathId,
			reduceSvgRegister(get(subpathAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 0),
				value: { id: input.subpathId, pathId: input.pathId },
			}),
		)
		set(
			nodeAtoms,
			input.subpathId,
			reduceSvgRegister(get(nodeAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 1),
				value: input.node,
			}),
		)
		set(
			edgeAtoms,
			input.subpathId,
			reduceSvgRegister(get(edgeAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 2),
				value: input.edge,
			}),
		)
		set(
			subpathOrderAtoms,
			input.pathId,
			placeSvgOrderEntry(get(subpathOrderAtoms, input.pathId), {
				entryId: input.subpathId,
				id: svgOperationId(input.gesture, 3),
				index: input.index,
				value: input.subpathId,
			}),
		)
	},
})

export const deleteSubpathTransaction = transaction<
	(
		input: GestureInput & {
			readonly pathId: string
			readonly subpathId: string
		},
	) => void
>({
	key: `deleteSvgSubpath`,
	do: ({ get, set }, input) => {
		const subpath = readSvgRegister(get(subpathAtoms, input.subpathId))
		if (subpath?.pathId !== input.pathId) {
			throw new Error(`SVG subpath ${input.subpathId} is not in ${input.pathId}`)
		}
		set(
			subpathOrderAtoms,
			input.pathId,
			removeSvgOrderEntry(
				get(subpathOrderAtoms, input.pathId),
				input.subpathId,
				svgOperationId(input.gesture, 0),
			),
		)
		set(
			subpathAtoms,
			input.subpathId,
			reduceSvgRegister(get(subpathAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 1),
				value: null,
			}),
		)
		set(
			nodeAtoms,
			input.subpathId,
			reduceSvgRegister(get(nodeAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 2),
				value: null,
			}),
		)
		set(
			edgeAtoms,
			input.subpathId,
			reduceSvgRegister(get(edgeAtoms, input.subpathId), {
				id: svgOperationId(input.gesture, 3),
				value: null,
			}),
		)
	},
})

/**
 * Split geometry is supplied explicitly: model code does not guess Bezier math.
 * The new edge and the continuation edge settle in the same transaction.
 */
export const splitSubpathTransaction = transaction<
	(
		input: GestureInput & {
			readonly continuationEdge: SvgEdge
			readonly inserted: Omit<SubpathInput, `gesture` | `index` | `pathId`>
			readonly pathId: string
			readonly targetSubpathId: string
		},
	) => void
>({
	key: `splitSvgSubpath`,
	do: ({ get, set }, input) => {
		const order = materializeSvgOrder(get(subpathOrderAtoms, input.pathId))
		const targetIndex = order.findIndex(
			({ value }) => value === input.targetSubpathId,
		)
		if (targetIndex === -1) throw new Error(`Cannot split a missing SVG subpath`)
		if (readSvgRegister(get(subpathAtoms, input.inserted.subpathId)) != null) {
			throw new Error(`The inserted SVG subpath already exists`)
		}
		if (
			(input.inserted.edge.kind === `close`) !==
			(input.inserted.node === null)
		) {
			throw new Error(`Only a close edge may have a null SVG node`)
		}
		const targetNodeState = get(nodeAtoms, input.targetSubpathId)
		if (Object.keys(targetNodeState.operations).length === 0) {
			throw new Error(`Cannot split a missing SVG node`)
		}
		const targetNode = readSvgRegister(targetNodeState)
		if ((input.continuationEdge.kind === `close`) !== (targetNode === null)) {
			throw new Error(`Only a close edge may have a null SVG node`)
		}
		set(
			subpathAtoms,
			input.inserted.subpathId,
			reduceSvgRegister(get(subpathAtoms, input.inserted.subpathId), {
				id: svgOperationId(input.gesture, 0),
				value: { id: input.inserted.subpathId, pathId: input.pathId },
			}),
		)
		set(
			nodeAtoms,
			input.inserted.subpathId,
			reduceSvgRegister(get(nodeAtoms, input.inserted.subpathId), {
				id: svgOperationId(input.gesture, 1),
				value: input.inserted.node,
			}),
		)
		set(
			edgeAtoms,
			input.inserted.subpathId,
			reduceSvgRegister(get(edgeAtoms, input.inserted.subpathId), {
				id: svgOperationId(input.gesture, 2),
				value: input.inserted.edge,
			}),
		)
		set(
			edgeAtoms,
			input.targetSubpathId,
			reduceSvgRegister(get(edgeAtoms, input.targetSubpathId), {
				id: svgOperationId(input.gesture, 3),
				value: input.continuationEdge,
			}),
		)
		set(
			subpathOrderAtoms,
			input.pathId,
			placeSvgOrderEntry(get(subpathOrderAtoms, input.pathId), {
				entryId: input.inserted.subpathId,
				id: svgOperationId(input.gesture, 4),
				index: targetIndex,
				value: input.inserted.subpathId,
			}),
		)
	},
})

export const reorderPathTransaction = transaction<
	(
		input: GestureInput & { readonly index: number; readonly pathId: string },
	) => void
>({
	key: `reorderSvgPath`,
	do: ({ get, set }, input) => {
		if (readSvgRegister(get(pathAtoms, input.pathId)) == null) {
			throw new Error(`Cannot reorder a missing SVG path`)
		}
		set(
			pathOrderAtom,
			placeSvgOrderEntry(get(pathOrderAtom), {
				entryId: input.pathId,
				id: svgOperationId(input.gesture, 0),
				index: input.index,
				value: input.pathId,
			}),
		)
	},
})

export const reorderSubpathTransaction = transaction<
	(
		input: GestureInput & {
			readonly index: number
			readonly pathId: string
			readonly subpathId: string
		},
	) => void
>({
	key: `reorderSvgSubpath`,
	do: ({ get, set }, input) => {
		const subpath = readSvgRegister(get(subpathAtoms, input.subpathId))
		if (subpath?.pathId !== input.pathId) {
			throw new Error(`Cannot reorder a missing SVG subpath`)
		}
		set(
			subpathOrderAtoms,
			input.pathId,
			placeSvgOrderEntry(get(subpathOrderAtoms, input.pathId), {
				entryId: input.subpathId,
				id: svgOperationId(input.gesture, 0),
				index: input.index,
				value: input.subpathId,
			}),
		)
	},
})

export const commitGeometryTransaction = transaction<
	(
		input: GestureInput & {
			readonly point: PointXY
			readonly target: SvgDragTarget
		},
	) => void
>({
	key: `commitSvgGeometry`,
	do: ({ get, set }, input) => {
		if (input.target.kind === `node`) {
			if (readSvgRegister(get(nodeAtoms, input.target.subpathId)) == null) {
				throw new Error(`Cannot move a missing or closing SVG node`)
			}
			set(
				nodeAtoms,
				input.target.subpathId,
				reduceSvgRegister(get(nodeAtoms, input.target.subpathId), {
					id: svgOperationId(input.gesture, 0),
					value: input.point,
				}),
			)
			return
		}
		const edge = readSvgRegister(get(edgeAtoms, input.target.subpathId))
		if (edge?.kind !== `cubic`) {
			throw new Error(`Cannot move a control on a non-cubic SVG edge`)
		}
		set(
			edgeAtoms,
			input.target.subpathId,
			reduceSvgRegister(get(edgeAtoms, input.target.subpathId), {
				id: svgOperationId(input.gesture, 0),
				value:
					input.target.control === `c`
						? { ...edge, c: input.point }
						: { ...edge, s: input.point },
			}),
		)
	},
})

function runGestureTransaction<Input extends GestureInput>(
	token: TransactionToken<(input: Input) => void>,
	input: Input,
): void {
	runTransaction(token, input.gesture.id)(input)
}

export function replaceSvgDrawing(
	drawing: SvgDrawingFixture,
	gesture: SvgGesture,
): void {
	runGestureTransaction(replaceDrawingTransaction, { drawing, gesture })
}

export function beginSvgDrag(options: {
	readonly element: Element
	readonly gesture: SvgGesture
	readonly point: PointXY
	readonly pointerId: number
	readonly target: SvgDragTarget
}): void {
	const presenceKey = svgDragPresenceKey(options.gesture)
	setState(activeDragAtom, {
		gesture: options.gesture,
		pointerId: options.pointerId,
		target: options.target,
	})
	setState(pointerCaptureAtom, {
		element: options.element,
		pointerId: options.pointerId,
	})
	setState(dragPresenceAtoms, presenceKey, {
		actor: options.gesture.actor,
		gestureId: options.gesture.id,
		point: options.point,
		sequence: 0,
		session: options.gesture.session,
		target: options.target,
	})
}

export function previewSvgDrag(point: PointXY): void {
	const active = getState(activeDragAtom)
	if (active === null) return
	setState(
		dragPresenceAtoms,
		svgDragPresenceKey(active.gesture),
		(previous) => ({
			actor: active.gesture.actor,
			gestureId: active.gesture.id,
			point,
			sequence: (previous?.sequence ?? -1) + 1,
			session: active.gesture.session,
			target: active.target,
		}),
	)
}

/** End one pointer gesture with at most one durable geometry transaction. */
export function finishSvgDrag(options: { readonly commit: boolean }): void {
	const active = getState(activeDragAtom)
	if (active === null) return
	const presenceKey = svgDragPresenceKey(active.gesture)
	const presence = getState(dragPresenceAtoms, presenceKey)
	try {
		if (
			options.commit &&
			presence !== null &&
			presence.gestureId === active.gesture.id
		) {
			runGestureTransaction(commitGeometryTransaction, {
				gesture: active.gesture,
				point: presence.point,
				target: active.target,
			})
		}
	} finally {
		setState(dragPresenceAtoms, presenceKey, null)
		setState(activeDragAtom, null)
		setState(pointerCaptureAtom, null)
	}
}

/**
 * Explicit integration seam: schemas/reducers are public application modules,
 * while ownership, batching, transport, and history remain MOS-11 concerns.
 */
export const SVG_MEMBER_MODEL_SEAMS = {
	edge: {
		identity: { key: `svg/edge-register`, version: 1 },
		kind: `value`,
		operationSchema: svgEdgeOperationSchema,
		reduce: reduceSvgRegister<SvgEdge | null>,
		stateSchema: svgEdgeStateSchema,
	},
	node: {
		identity: { key: `svg/node-register`, version: 1 },
		kind: `value`,
		operationSchema: svgNodeOperationSchema,
		reduce: reduceSvgRegister<PointXY | null>,
		stateSchema: svgNodeStateSchema,
	},
	order: {
		identity: { key: `svg/order`, version: 1 },
		kind: `value`,
		operationSchema: svgOrderOperationSchema,
		reduce: reduceSvgOrder,
		stateSchema: svgOrderStateSchema,
	},
	path: {
		identity: { key: `svg/path-register`, version: 1 },
		kind: `value`,
		operationSchema: svgPathOperationSchema,
		reduce: reduceSvgRegister<SvgPath | null>,
		stateSchema: svgPathStateSchema,
	},
	subpath: {
		identity: { key: `svg/subpath-register`, version: 1 },
		kind: `value`,
		operationSchema: svgSubpathOperationSchema,
		reduce: reduceSvgRegister<SvgSubpath | null>,
		stateSchema: svgSubpathStateSchema,
	},
} as const
