import type { Silo } from "atom.io"
import { atom, atomFamily, getState, selector, setState } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	mosaicDomain,
	type MosaicDomainHistoryRequestResult,
	type MosaicDomainMemberHistoryPolicy,
	type MosaicDomainValueModel,
} from "atom.io/realtime"
import type {
	MosaicDomainBatchClient,
	MosaicDomainBatchClientOperation,
	MosaicDomainPresenceClient,
} from "atom.io/realtime-client"
import { z } from "zod"

import {
	compactSvgRegisterHistory,
	readSvgRegister,
	reduceSvgRegister,
	svgRegisterModelOperationSchema,
	svgRegisterStateSchema,
	type SvgRegisterModelOperation,
	type SvgRegisterState,
} from "./svg-convergence.ts"
import {
	createSvgGestureClock,
	svgHistoryPolicy,
	svgOperationId,
	type PointXY,
	type SvgGesture,
} from "./svg-editor-state.ts"

const keySchema = z.string().min(1)
const pointSchema = z
	.object({ id: keySchema, x: z.number().finite(), y: z.number().finite() })
	.strict()

export type SvgContourNode = {
	readonly id: string
	readonly x: number
	readonly y: number
}

/**
 * A closed line contour. Edges are implicit between adjacent nodes, including
 * the last and first nodes, so branching and dangling-edge states have no
 * representation in this model.
 */
export type SvgContour = {
	readonly nodes: readonly SvgContourNode[]
}

export const svgContourSchema: z.ZodType<SvgContour> = z
	.object({ nodes: z.array(pointSchema).min(3).max(64) })
	.strict()
	.refine(
		({ nodes }) => new Set(nodes.map(({ id }) => id)).size === nodes.length,
		{ message: `A contour cannot contain duplicate node IDs` },
	)

export const DEFAULT_SVG_CONTOUR: SvgContour = {
	nodes: [
		{ id: `north-west`, x: 72, y: 64 },
		{ id: `north-east`, x: 184, y: 72 },
		{ id: `south-east`, x: 184, y: 176 },
		{ id: `south-west`, x: 64, y: 184 },
	],
}

const DEFAULT_CONTOUR_OPERATION_ID = `0000000000000000:system:svg-contour-default:00000000`

export type SvgContourState = SvgRegisterState<SvgContour>
export type SvgContourOperation = SvgRegisterModelOperation<SvgContour>

export const svgContourOperationSchema =
	svgRegisterModelOperationSchema(svgContourSchema)
export const svgContourStateSchema = svgRegisterStateSchema(svgContourSchema)

export const DEFAULT_SVG_CONTOUR_STATE: SvgContourState = {
	operations: {
		[DEFAULT_CONTOUR_OPERATION_ID]: {
			id: DEFAULT_CONTOUR_OPERATION_ID,
			value: DEFAULT_SVG_CONTOUR,
		},
	},
}

/** Parse before reduction so invalid contours cannot enter even in local use. */
export function reduceSvgContour(
	state: SvgContourState,
	operation: SvgContourOperation,
): SvgContourState {
	return reduceSvgRegister(state, svgContourOperationSchema.parse(operation))
}

export function readSvgContour(state: SvgContourState): SvgContour {
	return (
		readSvgRegister(state) ??
		// Checkpoint corruption must fail closed rather than expose no contour.
		svgContourSchema.parse(DEFAULT_SVG_CONTOUR)
	)
}

export function svgContourPath(contour: SvgContour): string {
	const [first, ...rest] = svgContourSchema.parse(contour).nodes
	return [
		`M ${first.x.toString()} ${first.y.toString()}`,
		...rest.map(({ x, y }) => `L ${x.toString()} ${y.toString()}`),
		`Z`,
	].join(` `)
}

export type SvgContourPresence = {
	readonly actor: string
	readonly color: string
	readonly name: string
	readonly pointer: PointXY | null
	readonly selectedNodeId: string | null
	readonly session: string
}

export type SvgContourDragPresence = {
	readonly actor: string
	readonly gestureId: string
	readonly nodeId: string
	readonly point: PointXY
	readonly sequence: number
	readonly session: string
}

export type SvgContourActiveDrag = {
	readonly gesture: SvgGesture
	readonly nodeId: string
	readonly pointerId: number
}

export type SvgContourWorkspace = { readonly selectedNodeId: string | null }
export type SvgContourViewport = { readonly pan: PointXY; readonly zoom: number }

const contourPresenceSchema: z.ZodType<SvgContourPresence> = z
	.object({
		actor: keySchema,
		color: keySchema.max(64),
		name: keySchema.max(128),
		pointer: z
			.object({ x: z.number().finite(), y: z.number().finite() })
			.strict()
			.nullable(),
		selectedNodeId: keySchema.nullable(),
		session: keySchema,
	})
	.strict()

const contourDragPresenceSchema: z.ZodType<SvgContourDragPresence> = z
	.object({
		actor: keySchema,
		gestureId: keySchema,
		nodeId: keySchema,
		point: z.object({ x: z.number().finite(), y: z.number().finite() }).strict(),
		sequence: z.number().int().nonnegative(),
		session: keySchema,
	})
	.strict()

export const contourAtom = atom<SvgContourState>({
	default: DEFAULT_SVG_CONTOUR_STATE,
	key: `svgClosedContour`,
})
export const contourActiveDragAtom = atom<SvgContourActiveDrag | null>({
	default: null,
	key: `svgContourActiveDrag`,
})
export const contourPointerCaptureAtom = atom<{
	readonly element: Element
	readonly pointerId: number
} | null>({ default: null, key: `svgContourPointerCapture` })
export const contourWorkspaceAtom = atom<SvgContourWorkspace>({
	default: { selectedNodeId: null },
	key: `svgContourWorkspace`,
})
export const contourViewportAtom = atom<SvgContourViewport>({
	default: { pan: { x: 0, y: 0 }, zoom: 1 },
	key: `svgContourViewport`,
})
export const contourPresenceAtoms = atomFamily<
	SvgContourPresence | null,
	string
>({ default: null, key: `svgContourPresence` })
export const contourDragPresenceAtoms = atomFamily<
	SvgContourDragPresence | null,
	string
>({ default: null, key: `svgContourDragPresence` })

export function svgContourPresenceKey(
	identity: Pick<SvgContourPresence, `actor` | `session`>,
): string {
	return `${identity.actor}\u0000${identity.session}`
}

export const projectedContourSelector = selector<SvgContour>({
	get: ({ get }) => {
		const durable = readSvgContour(get(contourAtom))
		const drag = get(contourActiveDragAtom)
		if (drag === null) return durable
		const presence = get(
			contourDragPresenceAtoms,
			svgContourPresenceKey({
				actor: drag.gesture.actor,
				session: drag.gesture.session,
			}),
		)
		if (presence?.gestureId !== drag.gesture.id) return durable
		return {
			nodes: durable.nodes.map((node) =>
				node.id === drag.nodeId ? { ...node, ...presence.point } : node,
			),
		}
	},
	key: `svgProjectedClosedContour`,
})

export const contourPathSelector = selector<string>({
	get: ({ get }) => svgContourPath(get(projectedContourSelector)),
	key: `svgClosedContourPath`,
})

type SvgContourReceiptState = {
	readonly operations: Readonly<
		Record<string, { readonly actor?: string | undefined }>
	>
}

type AuthoredSvgContourOperation = {
	readonly actor?: string | undefined
	readonly targetOperationIds?: readonly string[] | undefined
	type?: string | undefined
}

const contourModel: MosaicDomainValueModel<
	SvgContourState & Json.Serializable,
	SvgContourOperation & Json.Serializable
> = {
	history: svgHistoryPolicy<SvgContourState>(
		compactSvgRegisterHistory,
	) as MosaicDomainMemberHistoryPolicy<
		SvgContourState & Json.Serializable,
		SvgContourOperation & Json.Serializable
	>,
	identity: { key: `svg/closed-contour-register`, version: 1 },
	kind: `value`,
	operationSchema: svgContourOperationSchema as z.ZodType<
		SvgContourOperation & Json.Serializable
	>,
	reduce(value, operation, context) {
		const current = value as SvgContourReceiptState
		const authored = operation as AuthoredSvgContourOperation
		if (authored.actor !== context.actor) {
			throw new Error(
				`An SVG contour operation must name its authenticated actor.`,
			)
		}
		if (authored.targetOperationIds !== undefined) {
			for (const target of authored.targetOperationIds) {
				if (current.operations[target]?.actor !== context.actor) {
					throw new Error(
						`An SVG contour compensation can target only the authenticated actor's operations.`,
					)
				}
			}
		}
		return reduceSvgContour(value, operation) as SvgContourState &
			Json.Serializable
	},
}

export const svgContourDomain = mosaicDomain({
	configSchema: z.object({}).strict(),
	key: `svg-closed-contour`,
	members: {
		activeDrag: { role: `local`, token: contourActiveDragAtom },
		collaborator: {
			keySchema,
			role: `ephemeral`,
			schema: contourPresenceSchema,
			token: contourPresenceAtoms,
		},
		contour: {
			model: contourModel,
			role: `durable`,
			schema: svgContourStateSchema,
			token: contourAtom,
		},
		dragPresence: {
			keySchema,
			role: `ephemeral`,
			schema: contourDragPresenceSchema,
			token: contourDragPresenceAtoms,
		},
		path: { role: `derived`, token: contourPathSelector },
		pointerCapture: { role: `local`, token: contourPointerCaptureAtom },
		projectedContour: { role: `derived`, token: projectedContourSelector },
		viewport: { role: `local`, token: contourViewportAtom },
		workspace: { role: `local`, token: contourWorkspaceAtom },
	},
	version: 1,
})

export const SVG_CONTOUR_DOMAIN_TOKENS = [
	contourActiveDragAtom,
	contourAtom,
	contourDragPresenceAtoms,
	contourPathSelector,
	contourPointerCaptureAtom,
	contourPresenceAtoms,
	contourViewportAtom,
	contourWorkspaceAtom,
	projectedContourSelector,
] as const

export async function activateSvgContourDomain(options: {
	readonly instance: string
	readonly silo: Pick<Silo, `install` | `store`>
}): Promise<SvgContourDomain> {
	options.silo.install([...SVG_CONTOUR_DOMAIN_TOKENS])
	return svgContourDomain.activate({
		config: {},
		instance: options.instance,
		store: options.silo.store,
	})
}

export type SvgContourDomain = Awaited<
	ReturnType<typeof svgContourDomain.activate>
>

export type SvgContourStateAccess = {
	readonly getState: (...parameters: any[]) => any
	readonly setState: (...parameters: any[]) => void
}

const implicitState: SvgContourStateAccess = {
	getState: getState as SvgContourStateAccess[`getState`],
	setState: setState as SvgContourStateAccess[`setState`],
}

export type SvgContourEditor = {
	addNode(input: {
		readonly gesture: SvgGesture
		readonly index: number
		readonly node: SvgContourNode
	}): Promise<void>
	beginDrag(input: {
		readonly element: Element
		readonly gesture: SvgGesture
		readonly nodeId: string
		readonly point: PointXY
		readonly pointerId: number
	}): Promise<void>
	deleteNode(input: {
		readonly gesture: SvgGesture
		readonly nodeId: string
	}): Promise<void>
	finishDrag(input: { readonly commit: boolean }): Promise<void>
	moveNode(input: {
		readonly gesture: SvgGesture
		readonly nodeId: string
		readonly point: PointXY
	}): Promise<void>
	previewDrag(point: PointXY): Promise<void>
	redo(gesture: SvgGesture): Promise<boolean>
	replaceContour(input: {
		readonly contour: SvgContour
		readonly gesture: SvgGesture
	}): Promise<void>
	undo(gesture: SvgGesture): Promise<boolean>
}

export function createSvgContourEditor(options: {
	readonly batch: MosaicDomainBatchClient
	readonly domain: SvgContourDomain
	readonly history?: {
		redo(): Promise<MosaicDomainHistoryRequestResult>
		undo(): Promise<MosaicDomainHistoryRequestResult>
	}
	readonly presence?: MosaicDomainPresenceClient
	readonly state?: SvgContourStateAccess
}): SvgContourEditor {
	const state = options.state ?? implicitState
	const sharePresence = async (
		work: Promise<void> | undefined,
	): Promise<void> => {
		try {
			await work
		} catch {
			// Presence is advisory; its controller retains the actionable status.
		}
	}
	const submit = async (
		gesture: SvgGesture,
		contour: SvgContour,
	): Promise<void> => {
		const operation = svgContourOperationSchema.parse({
			actor: gesture.actor,
			id: svgOperationId(gesture, 0),
			value: contour,
		})
		await options.batch.submit(
			[
				{
					address: options.domain.address(`contour`),
					id: operation.id,
					operation,
				},
			] as readonly MosaicDomainBatchClientOperation[],
			gesture.id,
		)
		if (options.batch.state.status === `rejected`) {
			throw new Error(
				options.batch.state.problem?.reason ??
					`The SVG contour batch was rejected.`,
			)
		}
	}
	const current = (): SvgContour => readSvgContour(state.getState(contourAtom))
	const withNode = (
		nodeId: string,
		change: (node: SvgContourNode) => SvgContourNode,
	): SvgContour => {
		const contour = current()
		if (!contour.nodes.some(({ id }) => id === nodeId)) {
			throw new Error(`Cannot change a missing contour node.`)
		}
		return svgContourSchema.parse({
			nodes: contour.nodes.map((node) =>
				node.id === nodeId ? change(node) : node,
			),
		})
	}

	const editor: SvgContourEditor = {
		async addNode(input) {
			const contour = current()
			if (contour.nodes.some(({ id }) => id === input.node.id)) {
				throw new Error(`A contour node ID must be unique.`)
			}
			const index = Math.max(0, Math.min(input.index, contour.nodes.length))
			await submit(input.gesture, {
				nodes: [
					...contour.nodes.slice(0, index),
					input.node,
					...contour.nodes.slice(index),
				],
			})
		},
		async beginDrag(input) {
			if (!current().nodes.some(({ id }) => id === input.nodeId)) {
				throw new Error(`Cannot drag a missing contour node.`)
			}
			state.setState(contourActiveDragAtom, {
				gesture: input.gesture,
				nodeId: input.nodeId,
				pointerId: input.pointerId,
			})
			state.setState(contourPointerCaptureAtom, {
				element: input.element,
				pointerId: input.pointerId,
			})
			const presence: SvgContourDragPresence = {
				actor: input.gesture.actor,
				gestureId: input.gesture.id,
				nodeId: input.nodeId,
				point: input.point,
				sequence: 0,
				session: input.gesture.session,
			}
			const key = svgContourPresenceKey(presence)
			state.setState(contourDragPresenceAtoms, key, presence)
			await sharePresence(
				options.presence?.publish(
					options.domain.address(`dragPresence`, key),
					presence,
				),
			)
		},
		async deleteNode(input) {
			const contour = current()
			if (!contour.nodes.some(({ id }) => id === input.nodeId)) {
				throw new Error(`Cannot delete a missing contour node.`)
			}
			await submit(input.gesture, {
				nodes: contour.nodes.filter(({ id }) => id !== input.nodeId),
			})
		},
		async finishDrag({ commit }) {
			const active = state.getState(contourActiveDragAtom)
			if (active === null) return
			const key = svgContourPresenceKey({
				actor: active.gesture.actor,
				session: active.gesture.session,
			})
			const presence = state.getState(contourDragPresenceAtoms, key)
			state.setState(contourDragPresenceAtoms, key, null)
			state.setState(contourActiveDragAtom, null)
			state.setState(contourPointerCaptureAtom, null)
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
					editor.moveNode({
						gesture: active.gesture,
						nodeId: active.nodeId,
						point: presence.point,
					}),
				)
			}
			await Promise.all(work)
		},
		async moveNode(input) {
			await submit(
				input.gesture,
				withNode(input.nodeId, (node) => ({ ...node, ...input.point })),
			)
		},
		async previewDrag(point) {
			const active = state.getState(contourActiveDragAtom)
			if (active === null) return
			const key = svgContourPresenceKey({
				actor: active.gesture.actor,
				session: active.gesture.session,
			})
			const previous = state.getState(contourDragPresenceAtoms, key)
			const presence: SvgContourDragPresence = {
				actor: active.gesture.actor,
				gestureId: active.gesture.id,
				nodeId: active.nodeId,
				point,
				sequence: (previous?.sequence ?? -1) + 1,
				session: active.gesture.session,
			}
			state.setState(contourDragPresenceAtoms, key, presence)
			await sharePresence(
				options.presence?.publish(
					options.domain.address(`dragPresence`, key),
					presence,
				),
			)
		},
		async redo(gesture) {
			void gesture
			if (options.history === undefined) return false
			const result = await options.history.redo()
			if (result.status === `rejected`) throw new Error(result.reason)
			return result.status === `accepted`
		},
		async replaceContour(input) {
			await submit(input.gesture, svgContourSchema.parse(input.contour))
		},
		async undo(gesture) {
			void gesture
			if (options.history === undefined) return false
			const result = await options.history.undo()
			if (result.status === `rejected`) throw new Error(result.reason)
			return result.status === `accepted`
		},
	}
	return editor
}

export { createSvgGestureClock }
export type { PointXY, SvgGesture }
