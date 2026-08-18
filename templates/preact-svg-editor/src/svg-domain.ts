import type { Silo } from "atom.io"
import { getState, setState } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	mosaicDomain,
	type MosaicDomainMemberAddress,
	type MosaicDomainValueModel,
} from "atom.io/realtime"
import type {
	MosaicDomainBatchClient,
	MosaicDomainBatchClientOperation,
	MosaicDomainPresenceClient,
} from "atom.io/realtime-client"
import { z } from "zod"

import {
	materializeSvgOrder,
	placeSvgOrderEntry,
	readSvgRegister,
	removeSvgOrderEntry,
	type SvgOrderOperation,
	type SvgOrderState,
	type SvgRegisterOperation,
} from "./svg-convergence.ts"
import {
	activeDragAtom,
	dragPresenceAtoms,
	edgeAtoms,
	nodeAtoms,
	pathAtoms,
	pathDrawSelectors,
	pathOrderAtom,
	pointerCaptureAtom,
	projectedEdgeSelectors,
	projectedNodeSelectors,
	structureViolationsSelector,
	subpathAtoms,
	subpathOrderAtoms,
	svgDragPresenceKey,
	svgElementAtom,
	svgOperationId,
	SVG_MEMBER_MODEL_SEAMS,
	viewportAtom,
	workspaceAtom,
	type PointXY,
	type SvgDrawingFixture,
	type SvgDragPresence,
	type SvgDragTarget,
	type SvgEdge,
	type SvgGesture,
	type SvgSubpath,
} from "./svg-editor-state.ts"

const keySchema = z.string().min(1)
const pointSchema = z
	.object({ x: z.number().finite(), y: z.number().finite() })
	.strict()
const dragTargetSchema = z.discriminatedUnion(`kind`, [
	z.object({ kind: z.literal(`node`), subpathId: keySchema }).strict(),
	z
		.object({
			control: z.enum([`c`, `s`]),
			kind: z.literal(`edge-control`),
			subpathId: keySchema,
		})
		.strict(),
])
export const svgDragPresenceSchema: z.ZodType<SvgDragPresence> = z
	.object({
		actor: keySchema,
		gestureId: keySchema,
		point: pointSchema,
		sequence: z.number().int().nonnegative(),
		session: keySchema,
		target: dragTargetSchema,
	})
	.strict()

type SvgReceiptState = {
	readonly operations: Readonly<
		Record<string, { readonly actor?: string | undefined }>
	>
}

type AuthoredSvgOperation = {
	readonly actor?: string | undefined
	readonly undoTargets?: readonly string[] | undefined
}

const valueModel = <
	Value extends SvgReceiptState,
	Operation extends AuthoredSvgOperation,
>(seam: {
	readonly identity: { readonly key: string; readonly version: number }
	readonly kind: `value`
	readonly operationSchema: z.ZodType<Operation>
	readonly reduce: (value: Value, operation: Operation) => Value
}): MosaicDomainValueModel<
	Value & Json.Serializable,
	Operation & Json.Serializable
> => ({
	identity: seam.identity,
	kind: `value`,
	operationSchema: seam.operationSchema as z.ZodType<
		Operation & Json.Serializable
	>,
	reduce: (value, operation, context) => {
		if (operation.actor !== context.actor) {
			throw new Error(
				`An SVG member operation must name its authenticated actor.`,
			)
		}
		if (operation.undoTargets !== undefined) {
			for (const target of operation.undoTargets) {
				if (value.operations[target]?.actor !== context.actor) {
					throw new Error(
						`An SVG compensation can target only the authenticated actor's operations.`,
					)
				}
			}
		}
		return seam.reduce(value, operation) as Value & Json.Serializable
	},
})

/** Public Domain inventory; render and workspace state remain ordinary Atom.io tokens. */
export const svgDesignDomain = mosaicDomain({
	configSchema: z.object({}).strict(),
	key: `svg-design`,
	members: {
		activeDrag: { role: `local`, token: activeDragAtom },
		dragPresence: {
			keySchema,
			role: `ephemeral`,
			schema: svgDragPresenceSchema,
			token: dragPresenceAtoms,
		},
		edges: {
			keySchema,
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.edge),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.edge.stateSchema,
			token: edgeAtoms,
		},
		nodes: {
			keySchema,
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.node),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.node.stateSchema,
			token: nodeAtoms,
		},
		pathDrawing: { keySchema, role: `derived`, token: pathDrawSelectors },
		pathOrder: {
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.order),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.order.stateSchema,
			token: pathOrderAtom,
		},
		paths: {
			keySchema,
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.path),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.path.stateSchema,
			token: pathAtoms,
		},
		pointerCapture: { role: `local`, token: pointerCaptureAtom },
		projectedEdges: {
			keySchema,
			role: `derived`,
			token: projectedEdgeSelectors,
		},
		projectedNodes: {
			keySchema,
			role: `derived`,
			token: projectedNodeSelectors,
		},
		structureViolations: { role: `derived`, token: structureViolationsSelector },
		subpathOrder: {
			keySchema,
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.order),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.order.stateSchema,
			token: subpathOrderAtoms,
		},
		subpaths: {
			keySchema,
			model: valueModel(SVG_MEMBER_MODEL_SEAMS.subpath),
			role: `durable`,
			schema: SVG_MEMBER_MODEL_SEAMS.subpath.stateSchema,
			token: subpathAtoms,
		},
		svgElement: { role: `local`, token: svgElementAtom },
		viewport: { role: `local`, token: viewportAtom },
		workspace: { role: `local`, token: workspaceAtom },
	},
	version: 1,
})

/** Install the ordinary template tokens before activating in an isolated Silo. */
export const SVG_DOMAIN_TOKENS = [
	activeDragAtom,
	dragPresenceAtoms,
	edgeAtoms,
	nodeAtoms,
	pathDrawSelectors,
	pathOrderAtom,
	pathAtoms,
	pointerCaptureAtom,
	projectedEdgeSelectors,
	projectedNodeSelectors,
	structureViolationsSelector,
	subpathOrderAtoms,
	subpathAtoms,
	svgElementAtom,
	viewportAtom,
	workspaceAtom,
] as const

export async function activateSvgDesignDomain(options: {
	readonly instance: string
	readonly silo: Silo
}): Promise<SvgDesignDomain> {
	options.silo.install([...SVG_DOMAIN_TOKENS])
	return svgDesignDomain.activate({
		config: {},
		instance: options.instance,
		store: options.silo.store,
	})
}

export type SvgDesignDomain = Awaited<
	ReturnType<typeof svgDesignDomain.activate>
>

export type SvgDomainState = {
	readonly getState: (...parameters: any[]) => any
	readonly setState: (...parameters: any[]) => void
}

const implicitState: SvgDomainState = {
	getState: getState as SvgDomainState[`getState`],
	setState: setState as SvgDomainState[`setState`],
}

type Planned = {
	readonly address: MosaicDomainMemberAddress
	readonly id: string
	readonly operation: SvgOrderOperation | SvgRegisterOperation<any>
}

type HistoryEntry = {
	readonly gesture: SvgGesture
	readonly operations: readonly Planned[]
	undone: boolean
}

export type SvgDomainEditor = {
	beginDrag(options: {
		readonly element: Element
		readonly gesture: SvgGesture
		readonly point: PointXY
		readonly pointerId: number
		readonly target: SvgDragTarget
	}): Promise<void>
	commitGeometry(input: {
		readonly gesture: SvgGesture
		readonly point: PointXY
		readonly target: SvgDragTarget
	}): Promise<void>
	deletePath(input: {
		readonly gesture: SvgGesture
		readonly pathId: string
	}): Promise<void>
	deleteSubpath(input: {
		readonly gesture: SvgGesture
		readonly pathId: string
		readonly subpathId: string
	}): Promise<void>
	finishDrag(options: { readonly commit: boolean }): Promise<void>
	insertPath(input: {
		readonly gesture: SvgGesture
		readonly index: number
		readonly pathId: string
	}): Promise<void>
	insertSubpath(input: {
		readonly edge: SvgEdge
		readonly gesture: SvgGesture
		readonly index: number
		readonly node: PointXY | null
		readonly pathId: string
		readonly subpathId: string
	}): Promise<void>
	previewDrag(point: PointXY): Promise<void>
	reorderPath(input: {
		readonly gesture: SvgGesture
		readonly index: number
		readonly pathId: string
	}): Promise<void>
	reorderSubpath(input: {
		readonly gesture: SvgGesture
		readonly index: number
		readonly pathId: string
		readonly subpathId: string
	}): Promise<void>
	replaceDrawing(input: {
		readonly drawing: SvgDrawingFixture
		readonly gesture: SvgGesture
	}): Promise<void>
	splitSubpath(input: {
		readonly continuationEdge: SvgEdge
		readonly gesture: SvgGesture
		readonly inserted: {
			readonly edge: SvgEdge
			readonly node: PointXY | null
			readonly subpathId: string
		}
		readonly pathId: string
		readonly targetSubpathId: string
	}): Promise<void>
	undo(gesture: SvgGesture): Promise<boolean>
}

const operationAt = <Operation extends { readonly id: string }>(
	state: { readonly operations: Readonly<Record<string, Operation>> },
	id: string,
): Operation => {
	const operation = state.operations[id]
	if (operation === undefined)
		throw new Error(`SVG operation ${id} was not produced.`)
	return operation
}

function assertClosePair(edge: SvgEdge, node: PointXY | null): void {
	if ((edge.kind === `close`) !== (node === null)) {
		throw new Error(`Only a close edge may have a null SVG node`)
	}
}

/** Build and submit explicit public Domain batches; no private transaction bridge. */
export function createSvgDomainEditor(options: {
	readonly batch: MosaicDomainBatchClient
	readonly domain: SvgDesignDomain
	readonly presence?: MosaicDomainPresenceClient
	readonly state?: SvgDomainState
}): SvgDomainEditor {
	const state = options.state ?? implicitState
	const history: HistoryEntry[] = []
	const sharePresence = async (
		work: Promise<void> | undefined,
	): Promise<void> => {
		try {
			await work
		} catch {
			// Presence is advisory; its controller retains the actionable status.
		}
	}
	const op = (
		address: Planned[`address`],
		operation: Planned[`operation`],
	): Planned => ({ address, id: operation.id, operation })
	const submit = async (
		gesture: SvgGesture,
		operations: readonly Planned[],
		record = true,
	): Promise<void> => {
		const authored = operations.map((planned) => ({
			...planned,
			operation: { ...planned.operation, actor: gesture.actor },
		}))
		await options.batch.submit(
			authored as readonly MosaicDomainBatchClientOperation[],
			gesture.id,
		)
		if (options.batch.state.status === `rejected`) {
			throw new Error(
				options.batch.state.problem?.reason ??
					`The SVG Domain batch was rejected.`,
			)
		}
		if (record) history.push({ gesture, operations: authored, undone: false })
	}
	const orderPlacement = (
		current: SvgOrderState,
		gesture: SvgGesture,
		ordinal: number,
		entryId: string,
		index: number,
		value = entryId,
	): SvgOrderOperation => {
		const id = svgOperationId(gesture, ordinal)
		return operationAt(
			placeSvgOrderEntry(current, { entryId, id, index, value }),
			id,
		)
	}
	const orderRemoval = (
		current: SvgOrderState,
		gesture: SvgGesture,
		ordinal: number,
		entryId: string,
	): SvgOrderOperation => {
		const id = svgOperationId(gesture, ordinal)
		return operationAt(removeSvgOrderEntry(current, entryId, id), id)
	}

	const editor: SvgDomainEditor = {
		async beginDrag(input) {
			state.setState(activeDragAtom, {
				gesture: input.gesture,
				pointerId: input.pointerId,
				target: input.target,
			})
			state.setState(pointerCaptureAtom, {
				element: input.element,
				pointerId: input.pointerId,
			})
			const presence: SvgDragPresence = {
				actor: input.gesture.actor,
				gestureId: input.gesture.id,
				point: input.point,
				sequence: 0,
				session: input.gesture.session,
				target: input.target,
			}
			state.setState(
				dragPresenceAtoms,
				svgDragPresenceKey(input.gesture),
				presence,
			)
			await sharePresence(
				options.presence?.publish(
					options.domain.address(
						`dragPresence`,
						svgDragPresenceKey(input.gesture),
					),
					presence,
				),
			)
		},
		async commitGeometry(input) {
			if (input.target.kind === `node`) {
				if (
					readSvgRegister(state.getState(nodeAtoms, input.target.subpathId)) ==
					null
				) {
					throw new Error(`Cannot move a missing or closing SVG node`)
				}
				const operation = {
					id: svgOperationId(input.gesture, 0),
					value: input.point,
				}
				await submit(input.gesture, [
					op(options.domain.address(`nodes`, input.target.subpathId), operation),
				])
				return
			}
			const edge = readSvgRegister<SvgEdge | null>(
				state.getState(edgeAtoms, input.target.subpathId),
			)
			if (edge?.kind !== `cubic`) {
				throw new Error(`Cannot move a control on a non-cubic SVG edge`)
			}
			const operation = {
				id: svgOperationId(input.gesture, 0),
				value:
					input.target.control === `c`
						? { ...edge, c: input.point }
						: { ...edge, s: input.point },
			}
			await submit(input.gesture, [
				op(options.domain.address(`edges`, input.target.subpathId), operation),
			])
		},
		async deletePath(input) {
			if (readSvgRegister(state.getState(pathAtoms, input.pathId)) == null) {
				throw new Error(`SVG path ${input.pathId} does not exist`)
			}
			let ordinal = 0
			const operations: Planned[] = []
			let subpathOrder = state.getState(subpathOrderAtoms, input.pathId)
			for (const { entryId, value: subpathId } of materializeSvgOrder(
				subpathOrder,
			)) {
				const removal = orderRemoval(
					subpathOrder,
					input.gesture,
					ordinal++,
					entryId,
				)
				subpathOrder = {
					operations: { ...subpathOrder.operations, [removal.id]: removal },
				}
				operations.push(
					op(options.domain.address(`subpathOrder`, input.pathId), removal),
					op(options.domain.address(`subpaths`, subpathId), {
						id: svgOperationId(input.gesture, ordinal++),
						value: null,
					}),
					op(options.domain.address(`nodes`, subpathId), {
						id: svgOperationId(input.gesture, ordinal++),
						value: null,
					}),
					op(options.domain.address(`edges`, subpathId), {
						id: svgOperationId(input.gesture, ordinal++),
						value: null,
					}),
				)
			}
			operations.push(
				op(options.domain.address(`paths`, input.pathId), {
					id: svgOperationId(input.gesture, ordinal++),
					value: null,
				}),
				op(
					options.domain.address(`pathOrder`),
					orderRemoval(
						state.getState(pathOrderAtom),
						input.gesture,
						ordinal,
						input.pathId,
					),
				),
			)
			await submit(input.gesture, operations)
		},
		async deleteSubpath(input) {
			const subpath = readSvgRegister<SvgSubpath | null>(
				state.getState(subpathAtoms, input.subpathId),
			)
			if (subpath?.pathId !== input.pathId) {
				throw new Error(
					`SVG subpath ${input.subpathId} is not in ${input.pathId}`,
				)
			}
			await submit(input.gesture, [
				op(
					options.domain.address(`subpathOrder`, input.pathId),
					orderRemoval(
						state.getState(subpathOrderAtoms, input.pathId),
						input.gesture,
						0,
						input.subpathId,
					),
				),
				op(options.domain.address(`subpaths`, input.subpathId), {
					id: svgOperationId(input.gesture, 1),
					value: null,
				}),
				op(options.domain.address(`nodes`, input.subpathId), {
					id: svgOperationId(input.gesture, 2),
					value: null,
				}),
				op(options.domain.address(`edges`, input.subpathId), {
					id: svgOperationId(input.gesture, 3),
					value: null,
				}),
			])
		},
		async finishDrag({ commit }) {
			const active = state.getState(activeDragAtom)
			if (active === null) return
			const key = svgDragPresenceKey(active.gesture)
			const presence = state.getState(dragPresenceAtoms, key)
			state.setState(dragPresenceAtoms, key, null)
			state.setState(activeDragAtom, null)
			state.setState(pointerCaptureAtom, null)
			const work: Promise<unknown>[] = []
			if (options.presence !== undefined) {
				work.push(
					sharePresence(
						options.presence.clear(options.domain.address(`dragPresence`, key)),
					),
				)
			}
			if (commit && presence?.gestureId === active.gesture.id) {
				work.push(
					editor.commitGeometry({
						gesture: active.gesture,
						point: presence.point,
						target: active.target,
					}),
				)
			}
			await Promise.all(work)
		},
		async insertPath(input) {
			if (readSvgRegister(state.getState(pathAtoms, input.pathId)) != null) {
				throw new Error(`SVG path ${input.pathId} already exists`)
			}
			await submit(input.gesture, [
				op(options.domain.address(`paths`, input.pathId), {
					id: svgOperationId(input.gesture, 0),
					value: { id: input.pathId },
				}),
				op(
					options.domain.address(`pathOrder`),
					orderPlacement(
						state.getState(pathOrderAtom),
						input.gesture,
						1,
						input.pathId,
						input.index,
					),
				),
			])
		},
		async insertSubpath(input) {
			if (readSvgRegister(state.getState(pathAtoms, input.pathId)) == null) {
				throw new Error(`SVG path ${input.pathId} does not exist`)
			}
			if (
				readSvgRegister(state.getState(subpathAtoms, input.subpathId)) != null
			) {
				throw new Error(`SVG subpath ${input.subpathId} already exists`)
			}
			assertClosePair(input.edge, input.node)
			await submit(input.gesture, [
				op(options.domain.address(`subpaths`, input.subpathId), {
					id: svgOperationId(input.gesture, 0),
					value: { id: input.subpathId, pathId: input.pathId },
				}),
				op(options.domain.address(`nodes`, input.subpathId), {
					id: svgOperationId(input.gesture, 1),
					value: input.node,
				}),
				op(options.domain.address(`edges`, input.subpathId), {
					id: svgOperationId(input.gesture, 2),
					value: input.edge,
				}),
				op(
					options.domain.address(`subpathOrder`, input.pathId),
					orderPlacement(
						state.getState(subpathOrderAtoms, input.pathId),
						input.gesture,
						3,
						input.subpathId,
						input.index,
					),
				),
			])
		},
		async previewDrag(point) {
			const active = state.getState(activeDragAtom)
			if (active === null) return
			const key = svgDragPresenceKey(active.gesture)
			const previous = state.getState(dragPresenceAtoms, key)
			const presence: SvgDragPresence = {
				actor: active.gesture.actor,
				gestureId: active.gesture.id,
				point,
				sequence: (previous?.sequence ?? -1) + 1,
				session: active.gesture.session,
				target: active.target,
			}
			state.setState(dragPresenceAtoms, key, presence)
			await sharePresence(
				options.presence?.publish(
					options.domain.address(`dragPresence`, key),
					presence,
				),
			)
		},
		async reorderPath(input) {
			if (readSvgRegister(state.getState(pathAtoms, input.pathId)) == null) {
				throw new Error(`Cannot reorder a missing SVG path`)
			}
			await submit(input.gesture, [
				op(
					options.domain.address(`pathOrder`),
					orderPlacement(
						state.getState(pathOrderAtom),
						input.gesture,
						0,
						input.pathId,
						input.index,
					),
				),
			])
		},
		async reorderSubpath(input) {
			const subpath = readSvgRegister<SvgSubpath | null>(
				state.getState(subpathAtoms, input.subpathId),
			)
			if (subpath?.pathId !== input.pathId) {
				throw new Error(`Cannot reorder a missing SVG subpath`)
			}
			await submit(input.gesture, [
				op(
					options.domain.address(`subpathOrder`, input.pathId),
					orderPlacement(
						state.getState(subpathOrderAtoms, input.pathId),
						input.gesture,
						0,
						input.subpathId,
						input.index,
					),
				),
			])
		},
		async replaceDrawing(input) {
			const pathIds = input.drawing.paths.map(({ id }) => id)
			if (new Set(pathIds).size !== pathIds.length) {
				throw new Error(`An SVG drawing cannot contain duplicate path IDs`)
			}
			const subpathIds = new Set<string>()
			for (const path of input.drawing.paths) {
				for (const subpath of path.subpaths) {
					if (subpathIds.has(subpath.id)) {
						throw new Error(`SVG subpath IDs must be globally unique`)
					}
					subpathIds.add(subpath.id)
					assertClosePair(subpath.edge, subpath.node)
				}
			}
			let ordinal = 0
			const operations: Planned[] = []
			const clearedSubpathOrders = new Map<string, SvgOrderState>()
			let pathOrder = state.getState(pathOrderAtom)
			for (const { entryId, value: pathId } of materializeSvgOrder(pathOrder)) {
				let order = state.getState(subpathOrderAtoms, pathId)
				for (const {
					entryId: subpathEntry,
					value: subpathId,
				} of materializeSvgOrder(order)) {
					const removal = orderRemoval(
						order,
						input.gesture,
						ordinal++,
						subpathEntry,
					)
					order = { operations: { ...order.operations, [removal.id]: removal } }
					operations.push(
						op(options.domain.address(`subpathOrder`, pathId), removal),
						op(options.domain.address(`subpaths`, subpathId), {
							id: svgOperationId(input.gesture, ordinal++),
							value: null,
						}),
						op(options.domain.address(`nodes`, subpathId), {
							id: svgOperationId(input.gesture, ordinal++),
							value: null,
						}),
						op(options.domain.address(`edges`, subpathId), {
							id: svgOperationId(input.gesture, ordinal++),
							value: null,
						}),
					)
				}
				clearedSubpathOrders.set(pathId, order)
				operations.push(
					op(options.domain.address(`paths`, pathId), {
						id: svgOperationId(input.gesture, ordinal++),
						value: null,
					}),
				)
				const removal = orderRemoval(
					pathOrder,
					input.gesture,
					ordinal++,
					entryId,
				)
				pathOrder = {
					operations: { ...pathOrder.operations, [removal.id]: removal },
				}
				operations.push(op(options.domain.address(`pathOrder`), removal))
			}
			for (const [pathIndex, path] of input.drawing.paths.entries()) {
				operations.push(
					op(options.domain.address(`paths`, path.id), {
						id: svgOperationId(input.gesture, ordinal++),
						value: { id: path.id },
					}),
				)
				const pathPlacement = orderPlacement(
					pathOrder,
					input.gesture,
					ordinal++,
					path.id,
					pathIndex,
				)
				pathOrder = {
					operations: {
						...pathOrder.operations,
						[pathPlacement.id]: pathPlacement,
					},
				}
				operations.push(op(options.domain.address(`pathOrder`), pathPlacement))
				let order =
					clearedSubpathOrders.get(path.id) ??
					state.getState(subpathOrderAtoms, path.id)
				for (const [index, subpath] of path.subpaths.entries()) {
					operations.push(
						op(options.domain.address(`subpaths`, subpath.id), {
							id: svgOperationId(input.gesture, ordinal++),
							value: { id: subpath.id, pathId: path.id },
						}),
						op(options.domain.address(`nodes`, subpath.id), {
							id: svgOperationId(input.gesture, ordinal++),
							value: subpath.node,
						}),
						op(options.domain.address(`edges`, subpath.id), {
							id: svgOperationId(input.gesture, ordinal++),
							value: subpath.edge,
						}),
					)
					const subpathPlacement = orderPlacement(
						order,
						input.gesture,
						ordinal++,
						subpath.id,
						index,
					)
					order = {
						operations: {
							...order.operations,
							[subpathPlacement.id]: subpathPlacement,
						},
					}
					operations.push(
						op(
							options.domain.address(`subpathOrder`, path.id),
							subpathPlacement,
						),
					)
				}
			}
			await submit(input.gesture, operations)
		},
		async splitSubpath(input) {
			const order = materializeSvgOrder(
				state.getState(subpathOrderAtoms, input.pathId),
			)
			const targetIndex = order.findIndex(
				({ value }) => value === input.targetSubpathId,
			)
			if (targetIndex === -1)
				throw new Error(`Cannot split a missing SVG subpath`)
			if (
				readSvgRegister(
					state.getState(subpathAtoms, input.inserted.subpathId),
				) != null
			) {
				throw new Error(`The inserted SVG subpath already exists`)
			}
			assertClosePair(input.inserted.edge, input.inserted.node)
			const targetNode = readSvgRegister<PointXY | null>(
				state.getState(nodeAtoms, input.targetSubpathId),
			)
			assertClosePair(input.continuationEdge, targetNode ?? null)
			await submit(input.gesture, [
				op(options.domain.address(`subpaths`, input.inserted.subpathId), {
					id: svgOperationId(input.gesture, 0),
					value: { id: input.inserted.subpathId, pathId: input.pathId },
				}),
				op(options.domain.address(`nodes`, input.inserted.subpathId), {
					id: svgOperationId(input.gesture, 1),
					value: input.inserted.node,
				}),
				op(options.domain.address(`edges`, input.inserted.subpathId), {
					id: svgOperationId(input.gesture, 2),
					value: input.inserted.edge,
				}),
				op(options.domain.address(`edges`, input.targetSubpathId), {
					id: svgOperationId(input.gesture, 3),
					value: input.continuationEdge,
				}),
				op(
					options.domain.address(`subpathOrder`, input.pathId),
					orderPlacement(
						state.getState(subpathOrderAtoms, input.pathId),
						input.gesture,
						4,
						input.inserted.subpathId,
						targetIndex,
					),
				),
			])
		},
		async undo(gesture) {
			const target = history.findLast((entry) => !entry.undone)
			if (target === undefined) return false
			const operations = target.operations.map((original, ordinal) => {
				const previous = original.operation
				const operation = {
					...structuredClone(previous),
					id: svgOperationId(gesture, ordinal),
					undoTargets: [previous.id],
				}
				return op(original.address, operation)
			})
			await submit(gesture, operations, false)
			target.undone = true
			return true
		},
	}
	return editor
}
