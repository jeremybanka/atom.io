import type { Loadable } from "atom.io"
import { atom, getState, setState } from "atom.io"
import { useAtomicRef, useO } from "atom.io/react"
import type { PointerEventHandler, TargetedPointerEvent, VNode } from "preact"
import { useCallback, useEffect, useRef } from "preact/hooks"

import { parsePreactLogo } from "./preact-logo.ts"
import { materializeSvgOrder } from "./svg-convergence.ts"
import {
	activeDragAtom,
	beginSvgDrag,
	createSvgGestureClock,
	finishSvgDrag,
	pathDrawSelectors,
	pathOrderAtom,
	pointerCaptureAtom,
	type PointXY,
	previewSvgDrag,
	projectedEdgeSelectors,
	projectedNodeSelectors,
	replaceSvgDrawing,
	subpathOrderAtoms,
	type SvgDragTarget,
	svgElementAtom,
} from "./svg-editor-state.ts"

const WIDTH = 256
const HEIGHT = 296

function clamp(number: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, number))
}

function logicalPoint(evt: TargetedPointerEvent<SVGSVGElement>): PointXY | null {
	const svg = getState(svgElementAtom)
	if (svg === null) return null
	const point = svg.createSVGPoint()
	point.x = evt.clientX
	point.y = evt.clientY
	const inverse = svg.getScreenCTM()?.inverse()
	if (inverse === undefined) return null
	const transformed = point.matrixTransform(inverse)
	return {
		x: clamp(transformed.x, -185, WIDTH + 185),
		y: clamp(transformed.y, -10, HEIGHT + 10),
	}
}

function ControlHandle({
	at,
	control,
	origin,
	startDrag,
	subpathId,
}: {
	readonly at: PointXY
	readonly control: `c` | `s`
	readonly origin: PointXY | null
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		target: SvgDragTarget,
		point: PointXY,
	) => void
	readonly subpathId: string
}): VNode | null {
	if (origin === null) return null
	return (
		<>
			<line
				class="bezier"
				x1={origin.x}
				y1={origin.y}
				x2={at.x}
				y2={at.y}
				stroke="#777"
				stroke-width={1}
			/>
			<circle
				class="bezier"
				fill="#777"
				stroke="#aaa"
				stroke-width={1}
				cx={at.x}
				cy={at.y}
				r={2}
			/>
			<circle
				class="bezier-draggable"
				fill="transparent"
				cx={at.x}
				cy={at.y}
				r={6}
				onPointerDown={(event) => {
					startDrag(event, { control, kind: `edge-control`, subpathId }, at)
				}}
			/>
		</>
	)
}

function Node({
	previousSubpathId,
	startDrag,
	subpathId,
}: {
	readonly previousSubpathId: string | null
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		target: SvgDragTarget,
		point: PointXY,
	) => void
	readonly subpathId: string
}): VNode | null {
	const node = useO(projectedNodeSelectors, subpathId)
	const edge = useO(projectedEdgeSelectors, subpathId)
	const previousNode = useO(
		projectedNodeSelectors,
		previousSubpathId ?? subpathId,
	)
	if (node === null || edge === null || edge.kind === `close`) return null
	return (
		<>
			{edge.kind === `cubic` ? (
				<>
					<ControlHandle
						at={edge.s}
						control="s"
						origin={node}
						startDrag={startDrag}
						subpathId={subpathId}
					/>
					{edge.c === undefined ? null : (
						<ControlHandle
							at={edge.c}
							control="c"
							origin={previousNode}
							startDrag={startDrag}
							subpathId={subpathId}
						/>
					)}
					<circle class="node" cx={node.x} cy={node.y} r={3} />
				</>
			) : (
				<rect class="node" x={node.x - 3} y={node.y - 3} width={6} height={6} />
			)}
			<circle
				class="node-draggable"
				fill="transparent"
				cx={node.x}
				cy={node.y}
				r={10}
				onPointerDown={(event) => {
					startDrag(event, { kind: `node`, subpathId }, node)
				}}
			/>
		</>
	)
}

function Path({
	pathId,
	startDrag,
}: {
	readonly pathId: string
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		target: SvgDragTarget,
		point: PointXY,
	) => void
}): VNode {
	const draw = useO(pathDrawSelectors, pathId)
	const subpathOrder = useO(subpathOrderAtoms, pathId)
	const subpathIds = materializeSvgOrder(subpathOrder).map(({ value }) => value)
	return (
		<>
			<path d={draw} class="path" style={{ pointerEvents: `none` }} />
			{subpathIds.toReversed().map((subpathId, reverseIndex) => {
				const index = subpathIds.length - reverseIndex - 1
				return (
					<Node
						key={subpathId}
						previousSubpathId={subpathIds[index - 1] ?? null}
						startDrag={startDrag}
						subpathId={subpathId}
					/>
				)
			})}
		</>
	)
}

const preactLogoAtom = atom<Loadable<string>>({
	key: `preactLogo`,
	default: () => fetch(`preact.svg`).then((response) => response.text()),
})

export default function BezierPlayground(): VNode {
	const svgRef = useAtomicRef(svgElementAtom, useRef)
	const pathOrder = useO(pathOrderAtom)
	const gestureClock = useRef(
		createSvgGestureClock({
			actor: `local-designer`,
			session: globalThis.crypto.randomUUID(),
		}),
	)

	const startDrag = useCallback(
		(
			event: TargetedPointerEvent<SVGCircleElement>,
			target: SvgDragTarget,
			point: PointXY,
		) => {
			event.currentTarget.setPointerCapture(event.pointerId)
			beginSvgDrag({
				element: event.currentTarget,
				gesture: gestureClock.current.begin(),
				point,
				pointerId: event.pointerId,
				target,
			})
		},
		[],
	)

	const onPointerMove: PointerEventHandler<SVGSVGElement> = useCallback(
		(event) => {
			if (getState(activeDragAtom) === null) return
			event.preventDefault()
			const point = logicalPoint(event)
			if (point !== null) previewSvgDrag(point)
		},
		[],
	)

	const finishPointer = useCallback((commit: boolean) => {
		const capture = getState(pointerCaptureAtom)
		if (capture?.element.hasPointerCapture(capture.pointerId) === true) {
			capture.element.releasePointerCapture(capture.pointerId)
		}
		finishSvgDrag({ commit })
	}, [])

	const reset = useCallback(async () => {
		const svg = await getState(preactLogoAtom)
		replaceSvgDrawing(parsePreactLogo(svg), gestureClock.current.begin())
	}, [])

	useEffect(() => void reset(), [reset])

	return (
		<div
			style={{
				alignItems: `center`,
				display: `flex`,
				flexFlow: `column`,
				maxWidth: `1280px`,
				overflow: `hidden`,
				position: `relative`,
				width: `100vw`,
			}}
		>
			<svg
				ref={svgRef}
				viewBox={`-185 -15 ${WIDTH + 370} ${HEIGHT + 30}`}
				width={1000}
				height={500}
				onPointerMove={onPointerMove}
				onPointerUp={() => {
					finishPointer(true)
				}}
				onPointerCancel={() => {
					finishPointer(false)
				}}
			>
				<title>Bezier Playground</title>
				<defs>
					<pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
						<rect x="0" y="0" width=".5" height=".5" fill="none" stroke="#aaa" />
					</pattern>
				</defs>
				<rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#aaa3" />
				<rect
					x={-185}
					y={-10}
					width={WIDTH + 370}
					height={HEIGHT + 20}
					fill="url(#grid)"
				/>
				{materializeSvgOrder(pathOrder).map(({ value: pathId }) => (
					<Path pathId={pathId} startDrag={startDrag} key={pathId} />
				))}
			</svg>
			<button type="button" class="flat" onClick={reset}>
				Reset
			</button>
		</div>
	)
}
