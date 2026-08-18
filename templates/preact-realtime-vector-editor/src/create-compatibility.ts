import type {
	MosaicDomainBatchClient,
	MosaicDomainBatchClientOperation,
} from "atom.io/realtime-client"

import {
	activeDragAtom,
	collaborationPresenceAtoms,
	dragPresenceAtoms,
	edgeAtoms,
	nodeAtoms,
	pathAtoms,
	pathDrawSelectors,
	pathOrderAtom,
	pointerCaptureAtom,
	readSvgRegister,
	structureViolationsSelector,
	subpathAtoms,
	subpathOrderAtoms,
	svgOperationId,
	viewportAtom,
	workspaceAtom,
	type PointXY,
	type SvgDesignDomain,
	type SvgDomainState,
	type SvgEdge,
	type SvgGesture,
	type SvgSubpath,
} from "./design-model.ts"

/**
 * The representative Create-* shape, expressed entirely as existing public
 * Atom.io and SVG-model facilities. This object is intentionally executable:
 * its typecheck detects drift in the supported integration surface.
 */
export const CREATE_COMPATIBILITY_SURFACE = {
	durable: {
		contourOrder: subpathOrderAtoms,
		contours: subpathAtoms,
		edges: edgeAtoms,
		glyphOrder: pathOrderAtom,
		glyphs: pathAtoms,
		nodes: nodeAtoms,
	},
	ephemeral: {
		collaborators: collaborationPresenceAtoms,
		dragPreviews: dragPresenceAtoms,
	},
	local: {
		activeDrag: activeDragAtom,
		pointerCapture: pointerCaptureAtom,
		viewport: viewportAtom,
		workspace: workspaceAtom,
	},
	projected: {
		glyphOutline: pathDrawSelectors,
		structureViolations: structureViolationsSelector,
	},
} as const

export type CreateCompatibilityGeometryTarget = {
	readonly glyphId: string
	readonly pointId: string
}

export type CreateCompatibilityGeometryGesture = {
	readonly delta: PointXY
	readonly gesture: SvgGesture
	readonly targets: readonly CreateCompatibilityGeometryTarget[]
}

export type CreateCompatibilityAdapter = {
	/**
	 * Translate a selection that may span multiple glyphs. Node positions and
	 * their absolute cubic controls settle in one heterogeneous Domain batch.
	 */
	translateGeometry(input: CreateCompatibilityGeometryGesture): Promise<void>
}

const translate = (point: PointXY, delta: PointXY): PointXY => ({
	x: point.x + delta.x,
	y: point.y + delta.y,
})

const translateEdge = (edge: SvgEdge, delta: PointXY): SvgEdge => {
	if (edge.kind !== `cubic`) return edge
	return {
		...edge,
		...(edge.c === undefined ? {} : { c: translate(edge.c, delta) }),
		s: translate(edge.s, delta),
	}
}

/**
 * Adapt Create-*'s multi-glyph geometry commands to public Mosaic batches.
 * The SVG convergence model remains the sole owner of member reduction.
 */
export function createCreateCompatibilityAdapter(options: {
	readonly batch: MosaicDomainBatchClient
	readonly domain: SvgDesignDomain
	readonly state: SvgDomainState
}): CreateCompatibilityAdapter {
	return {
		async translateGeometry({ delta, gesture, targets }) {
			if (targets.length === 0) {
				throw new Error(`A Create-* geometry gesture needs at least one target.`)
			}
			const seen = new Set<string>()
			const operations: MosaicDomainBatchClientOperation[] = []
			let ordinal = 0
			for (const target of targets) {
				if (seen.has(target.pointId)) {
					throw new Error(`Duplicate Create-* point target ${target.pointId}.`)
				}
				seen.add(target.pointId)
				const contour = readSvgRegister<SvgSubpath | null>(
					options.state.getState(subpathAtoms, target.pointId),
				)
				if (contour?.pathId !== target.glyphId) {
					throw new Error(
						`Create-* point ${target.pointId} is not in glyph ${target.glyphId}.`,
					)
				}
				const point = readSvgRegister<PointXY | null>(
					options.state.getState(nodeAtoms, target.pointId),
				)
				if (point == null) {
					throw new Error(`Create-* point ${target.pointId} has no geometry.`)
				}
				const nodeOperationId = svgOperationId(gesture, ordinal++)
				operations.push({
					address: options.domain.address(`nodes`, target.pointId),
					id: nodeOperationId,
					operation: {
						actor: gesture.actor,
						id: nodeOperationId,
						value: translate(point, delta),
					},
				})
				const edge = readSvgRegister<SvgEdge | null>(
					options.state.getState(edgeAtoms, target.pointId),
				)
				if (edge?.kind === `cubic`) {
					const edgeOperationId = svgOperationId(gesture, ordinal++)
					operations.push({
						address: options.domain.address(`edges`, target.pointId),
						id: edgeOperationId,
						operation: {
							actor: gesture.actor,
							id: edgeOperationId,
							value: translateEdge(edge, delta),
						},
					})
				}
			}
			await options.batch.submit(operations, gesture.id)
			if (options.batch.state.status === `rejected`) {
				throw new Error(
					options.batch.state.problem?.reason ??
						`The Create-* compatibility gesture was rejected.`,
				)
			}
		},
	}
}
