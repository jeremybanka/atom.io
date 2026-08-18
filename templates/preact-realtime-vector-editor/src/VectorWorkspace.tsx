import { useO } from "atom.io/react"
import type { CSSProperties, TargetedPointerEvent, VNode } from "preact"
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks"

import {
	activeDragAtom,
	createSvgGestureClock,
	materializeSvgOrder,
	pathDrawSelectors,
	pathOrderAtom,
	pointerCaptureAtom,
	projectedNodeSelectors,
	subpathOrderAtoms,
	type PointXY,
	type SvgCollaborationPresence,
	type SvgDragPresence,
	type SvgDragTarget,
	viewportAtom,
	workspaceAtom,
} from "./design-model.ts"
import {
	publishCollaboratorPresence,
	type VectorCollaborationClient,
	type VectorClientStatus,
} from "./collaboration-client.ts"
import { SIMULATED_IDENTITIES } from "./identities.ts"
import { INITIAL_DRAWING } from "./initial-drawing.ts"
import { switchBrowserIdentity } from "./session.ts"
import css from "./VectorWorkspace.module.css"

type WorkspaceProps = { readonly client: VectorCollaborationClient }
type PresenceStyle = CSSProperties & Record<`--person-color`, string>

function activePresence(client: VectorCollaborationClient): {
	collaborators: SvgCollaborationPresence[]
	drags: SvgDragPresence[]
} {
	const collaborators: SvgCollaborationPresence[] = []
	const drags: SvgDragPresence[] = []
	for (const envelope of client.presence.state.presence) {
		if (envelope.kind !== `update`) continue
		if (envelope.address.member === `collaborator`) {
			collaborators.push(envelope.value as SvgCollaborationPresence)
		}
		if (envelope.address.member === `dragPresence`) {
			drags.push(envelope.value as SvgDragPresence)
		}
	}
	return { collaborators, drags }
}

function logicalPoint(event: TargetedPointerEvent<SVGSVGElement>): PointXY {
	const bounds = event.currentTarget.getBoundingClientRect()
	return {
		x: ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 256,
		y: ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 256,
	}
}

function NodeHandle(props: {
	readonly point: PointXY
	readonly selected: boolean
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		target: SvgDragTarget,
		point: PointXY,
	) => void
	readonly subpathId: string
}): VNode {
	return (
		<circle
			aria-label={`Node ${props.subpathId}`}
			cx={props.point.x}
			cy={props.point.y}
			data-kind="node"
			data-selected={props.selected}
			data-testid={`node-${props.subpathId}`}
			onPointerDown={(event) => {
				props.startDrag(
					event,
					{ kind: `node`, subpathId: props.subpathId },
					props.point,
				)
			}}
			r={props.selected ? 7 : 5}
			role="button"
			tabIndex={0}
		/>
	)
}

function EditablePath(props: {
	readonly client: VectorCollaborationClient
	readonly pathId: string
	readonly selectedSubpathId: string | null
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		target: SvgDragTarget,
		point: PointXY,
	) => void
}): VNode {
	const drawing = useO(pathDrawSelectors, props.pathId)
	const order = useO(subpathOrderAtoms, props.pathId)
	const subpathIds = materializeSvgOrder(order).map(({ value }) => value)
	return (
		<g>
			<path data-kind="path" d={drawing} />
			{subpathIds.map((subpathId) => {
				const point = props.client.silo.getState(
					projectedNodeSelectors,
					subpathId,
				)
				return point === null ? null : (
					<NodeHandle
						key={subpathId}
						point={point}
						selected={props.selectedSubpathId === subpathId}
						startDrag={props.startDrag}
						subpathId={subpathId}
					/>
				)
			})}
		</g>
	)
}

export function VectorWorkspace({ client }: WorkspaceProps): VNode {
	const pathOrder = useO(pathOrderAtom)
	const workspace = useO(workspaceAtom)
	const viewport = useO(viewportAtom)
	const [status, setStatus] = useState<VectorClientStatus>(client.status())
	const [presence, setPresence] = useState(() => activePresence(client))
	const [problem, setProblem] = useState<string | null>(null)
	const gestureClock = useRef(
		createSvgGestureClock({
			actor: client.identity.id,
			session: client.sessionId,
		}),
	)
	const pathIds = useMemo(
		() => materializeSvgOrder(pathOrder).map(({ value }) => value),
		[pathOrder],
	)
	const run = useCallback(
		async (work: () => Promise<unknown>): Promise<void> => {
			setProblem(null)
			try {
				await work()
			} catch (error) {
				setProblem(error instanceof Error ? error.message : String(error))
			}
		},
		[],
	)

	const publishFocus = useCallback(
		(
			pointer: PointXY | null,
			selectedSubpathId = workspace.selectedSubpathIds[0] ?? null,
		) =>
			publishCollaboratorPresence(client, {
				activePathId: workspace.activePathId ?? pathIds[0] ?? null,
				color: client.identity.color,
				name: client.identity.name,
				pointer,
				selectedSubpathId,
			}),
		[client, pathIds, workspace.activePathId, workspace.selectedSubpathIds],
	)

	useEffect(() => {
		const unsubscribeStatus = client.subscribe(setStatus)
		const unsubscribePresence = client.presence.subscribe(() => {
			setPresence(activePresence(client))
		})
		void publishFocus(null)
		return () => {
			unsubscribeStatus()
			unsubscribePresence()
			void client.presence.clear(
				client.domain.address(
					`collaborator`,
					`${client.identity.id}\u0000${client.sessionId}`,
				),
			)
		}
	}, [client, publishFocus])

	useEffect(() => {
		if (pathIds.length > 0 || status.connection !== `live`) return
		void run(() =>
			client.editor.replaceDrawing({
				drawing: INITIAL_DRAWING,
				gesture: gestureClock.current.begin(),
			}),
		)
	}, [client.editor, pathIds.length, run, status.connection])

	const select = useCallback(
		(subpathId: string) => {
			const activePathId =
				pathIds.find((pathId) =>
					materializeSvgOrder(
						client.silo.getState(subpathOrderAtoms, pathId),
					).some(({ value }) => value === subpathId),
				) ?? null
			client.silo.setState(workspaceAtom, {
				activePathId,
				selectedSubpathIds: [subpathId],
			})
			void publishFocus(null, subpathId)
		},
		[client.silo, pathIds, publishFocus],
	)

	const startDrag = useCallback(
		(
			event: TargetedPointerEvent<SVGCircleElement>,
			target: SvgDragTarget,
			point: PointXY,
		) => {
			event.currentTarget.setPointerCapture?.(event.pointerId)
			select(target.subpathId)
			void run(() =>
				client.editor.beginDrag({
					element: event.currentTarget,
					gesture: gestureClock.current.begin(),
					point,
					pointerId: event.pointerId,
					target,
				}),
			)
		},
		[client.editor, run, select],
	)

	const finishDrag = useCallback(
		(commit: boolean) => {
			const capture = client.silo.getState(pointerCaptureAtom)
			if (capture?.element.hasPointerCapture?.(capture.pointerId)) {
				capture.element.releasePointerCapture?.(capture.pointerId)
			}
			void run(() => client.editor.finishDrag({ commit }))
		},
		[client.editor, client.silo, run],
	)

	const addNode = (): void => {
		const pathId = workspace.activePathId ?? pathIds[0]
		if (pathId === undefined) return
		const order = materializeSvgOrder(
			client.silo.getState(subpathOrderAtoms, pathId),
		)
		const subpathId = `${client.identity.id}-${crypto.randomUUID()}`
		void run(() =>
			client.editor.insertSubpath({
				edge: { kind: `line` },
				gesture: gestureClock.current.begin(),
				index: Math.max(0, order.length - 1),
				node: { x: 128, y: 112 },
				pathId,
				subpathId,
			}),
		)
	}

	const deleteNode = (): void => {
		const pathId = workspace.activePathId
		const subpathId = workspace.selectedSubpathIds[0]
		if (pathId === null || subpathId === undefined) return
		void run(async () => {
			await client.editor.deleteSubpath({
				gesture: gestureClock.current.begin(),
				pathId,
				subpathId,
			})
			client.silo.setState(workspaceAtom, {
				activePathId: pathId,
				selectedSubpathIds: [],
			})
		})
	}

	return (
		<vector-workspace className={css.class}>
			<header>
				<brand-lockup>
					<mark>p</mark>
					<label-set>
						<strong>Plane</strong>
						<span>Shared vector study</span>
					</label-set>
				</brand-lockup>
				<document-title>
					<strong>Untitled mark</strong>
					<span data-testid="status">
						{status.connection} · {status.pending} pending
					</span>
				</document-title>
				<toolbar-actions>
					<button
						data-testid="undo"
						onClick={() =>
							void run(() => client.editor.undo(gestureClock.current.begin()))
						}
						type="button"
					>
						Undo mine
					</button>
					<button
						data-testid="redo"
						onClick={() =>
							void run(() => client.editor.redo(gestureClock.current.begin()))
						}
						type="button"
					>
						Redo mine
					</button>
					<label>
						<avatar-dot
							style={
								{ [`--person-color`]: client.identity.color } as PresenceStyle
							}
						>
							{client.identity.name[0]}
						</avatar-dot>
						<select
							aria-label="Simulated identity"
							onChange={(event) =>
								switchBrowserIdentity(event.currentTarget.value)
							}
							value={client.identity.id}
						>
							{SIMULATED_IDENTITIES.map((identity) => (
								<option key={identity.id} value={identity.id}>
									{identity.name}
								</option>
							))}
						</select>
					</label>
				</toolbar-actions>
			</header>
			<main>
				<tool-rail>
					<strong>Structure</strong>
					<button data-testid="add-node" onClick={addNode} type="button">
						Add node
					</button>
					<button
						data-testid="delete-node"
						disabled={workspace.selectedSubpathIds.length === 0}
						onClick={deleteNode}
						type="button"
					>
						Delete node
					</button>
					<strong>Viewport</strong>
					<button
						onClick={() =>
							client.silo.setState(viewportAtom, {
								...viewport,
								zoom: Math.min(2, viewport.zoom + 0.1),
							})
						}
						type="button"
					>
						Zoom in
					</button>
					<button
						onClick={() =>
							client.silo.setState(viewportAtom, {
								...viewport,
								zoom: Math.max(0.5, viewport.zoom - 0.1),
							})
						}
						type="button"
					>
						Zoom out
					</button>
				</tool-rail>
				<canvas-pane>
					<svg
						aria-label="Shared vector canvas"
						data-testid="canvas"
						onPointerCancel={() => finishDrag(false)}
						onPointerMove={(event) => {
							const point = logicalPoint(event)
							void publishFocus(point)
							if (client.silo.getState(activeDragAtom) !== null) {
								void client.editor.previewDrag(point)
							}
						}}
						onPointerUp={() => finishDrag(true)}
						viewBox={`${viewport.pan.x} ${viewport.pan.y} ${256 / viewport.zoom} ${256 / viewport.zoom}`}
					>
						<title>Shared vector canvas</title>
						<rect data-kind="artboard" height="256" width="256" x="0" y="0" />
						{pathIds.map((pathId) => (
							<EditablePath
								client={client}
								key={pathId}
								pathId={pathId}
								selectedSubpathId={workspace.selectedSubpathIds[0] ?? null}
								startDrag={startDrag}
							/>
						))}
						{presence.drags
							.filter(
								(drag) =>
									drag.actor !== client.identity.id ||
									drag.session !== client.sessionId,
							)
							.map((drag) => (
								<circle
									cx={drag.point.x}
									cy={drag.point.y}
									data-kind="remote-preview"
									key={`${drag.actor}:${drag.session}`}
									r="8"
								/>
							))}
						{presence.collaborators
							.filter(
								(peer) =>
									peer.pointer !== null &&
									(peer.actor !== client.identity.id ||
										peer.session !== client.sessionId),
							)
							.map((peer) => (
								<circle
									cx={peer.pointer!.x}
									cy={peer.pointer!.y}
									data-kind="remote-pointer"
									key={`${peer.actor}:${peer.session}`}
									r="4"
									style={{ [`--person-color`]: peer.color } as PresenceStyle}
								/>
							))}
					</svg>
					{(problem ?? status.reason) ? (
						<output data-testid="problem">{problem ?? status.reason}</output>
					) : null}
				</canvas-pane>
				<presence-rail>
					<strong>In this file</strong>
					{presence.collaborators.map((peer) => (
						<collaborator-card
							key={`${peer.actor}:${peer.session}`}
							style={{ [`--person-color`]: peer.color } as PresenceStyle}
						>
							<avatar-dot>{peer.name[0]}</avatar-dot>
							<label-set>
								<strong>{peer.name}</strong>
								<span>
									{[
										peer.activePathId ?? `Canvas`,
										peer.selectedSubpathId ?? `observing`,
									].join(` · `)}
								</span>
							</label-set>
						</collaborator-card>
					))}
					<small>
						Focus is advisory. Simultaneous edits settle through the member
						models, never a UI lock.
					</small>
				</presence-rail>
			</main>
			<footer>
				Ordinary atoms render this SVG · atomic Domain batches carry durable
				gestures
			</footer>
		</vector-workspace>
	)
}
