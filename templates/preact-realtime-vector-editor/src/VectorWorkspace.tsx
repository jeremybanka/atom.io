import { useO } from "atom.io/react"
import type { CSSProperties, TargetedPointerEvent, VNode } from "preact"
import { useCallback, useEffect, useRef, useState } from "preact/hooks"

import {
	contourActiveDragAtom,
	contourPathSelector,
	contourPointerCaptureAtom,
	contourViewportAtom,
	contourWorkspaceAtom,
	createSvgGestureClock,
	projectedContourSelector,
	type PointXY,
	type SvgContourDragPresence,
	type SvgContourNode,
	type SvgContourPresence,
} from "./design-model.ts"
import {
	publishCollaboratorPresence,
	type VectorCollaborationClient,
	type VectorClientStatus,
} from "./collaboration-client.ts"
import { SIMULATED_IDENTITIES } from "./identities.ts"
import { switchBrowserIdentity } from "./session.ts"
import css from "./VectorWorkspace.module.css"

type WorkspaceProps = { readonly client: VectorCollaborationClient }
type PresenceStyle = CSSProperties & Record<`--person-color`, string>

function activePresence(client: VectorCollaborationClient): {
	collaborators: SvgContourPresence[]
	drags: SvgContourDragPresence[]
} {
	const collaborators: SvgContourPresence[] = []
	const drags: SvgContourDragPresence[] = []
	for (const envelope of client.presence.state.presence) {
		if (envelope.kind !== `update`) continue
		if (envelope.address.member === `collaborator`) {
			collaborators.push(envelope.value as SvgContourPresence)
		}
		if (envelope.address.member === `dragPresence`) {
			drags.push(envelope.value as SvgContourDragPresence)
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
	readonly node: SvgContourNode
	readonly selected: boolean
	readonly startDrag: (
		event: TargetedPointerEvent<SVGCircleElement>,
		node: SvgContourNode,
	) => void
}): VNode {
	return (
		<circle
			aria-label={`Node ${props.node.id}`}
			cx={props.node.x}
			cy={props.node.y}
			data-kind="node"
			data-selected={props.selected}
			data-testid={`node-${props.node.id}`}
			onPointerDown={(event) => {
				props.startDrag(event, props.node)
			}}
			r={props.selected ? 7 : 5}
			role="button"
			tabIndex={0}
		/>
	)
}

export function VectorWorkspace({ client }: WorkspaceProps): VNode {
	const contour = useO(projectedContourSelector)
	const drawing = useO(contourPathSelector)
	const workspace = useO(contourWorkspaceAtom)
	const viewport = useO(contourViewportAtom)
	const [status, setStatus] = useState<VectorClientStatus>(client.status())
	const [presence, setPresence] = useState(() => activePresence(client))
	const [problem, setProblem] = useState<string | null>(null)
	const gestureClock = useRef(
		createSvgGestureClock({
			actor: client.identity.id,
			session: client.sessionId,
		}),
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
		(pointer: PointXY | null, selectedNodeId = workspace.selectedNodeId) =>
			publishCollaboratorPresence(client, {
				color: client.identity.color,
				name: client.identity.name,
				pointer,
				selectedNodeId,
			}),
		[client, workspace.selectedNodeId],
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

	const select = useCallback(
		(nodeId: string | null) => {
			client.silo.setState(contourWorkspaceAtom, { selectedNodeId: nodeId })
			void publishFocus(null, nodeId)
		},
		[client.silo, publishFocus],
	)

	const startDrag = useCallback(
		(event: TargetedPointerEvent<SVGCircleElement>, node: SvgContourNode) => {
			event.currentTarget.setPointerCapture?.(event.pointerId)
			select(node.id)
			void run(() =>
				client.editor.beginDrag({
					element: event.currentTarget,
					gesture: gestureClock.current.begin(),
					nodeId: node.id,
					point: node,
					pointerId: event.pointerId,
				}),
			)
		},
		[client.editor, run, select],
	)

	const finishDrag = useCallback(
		(commit: boolean) => {
			const capture = client.silo.getState(contourPointerCaptureAtom)
			if (capture?.element.hasPointerCapture?.(capture.pointerId)) {
				capture.element.releasePointerCapture?.(capture.pointerId)
			}
			void run(() => client.editor.finishDrag({ commit }))
		},
		[client.editor, client.silo, run],
	)

	const addNode = (): void => {
		const selectedIndex = contour.nodes.findIndex(
			({ id }) => id === workspace.selectedNodeId,
		)
		const previousIndex = selectedIndex < 0 ? 0 : selectedIndex
		const nextIndex = (previousIndex + 1) % contour.nodes.length
		const previous = contour.nodes[previousIndex]
		const next = contour.nodes[nextIndex]
		const node: SvgContourNode = {
			id: `${client.identity.id}-${crypto.randomUUID()}`,
			x: (previous.x + next.x) / 2,
			y: (previous.y + next.y) / 2,
		}
		void run(async () => {
			await client.editor.addNode({
				gesture: gestureClock.current.begin(),
				index: previousIndex + 1,
				node,
			})
			select(node.id)
		})
	}

	const deleteNode = (): void => {
		const nodeId = workspace.selectedNodeId
		if (nodeId === null || contour.nodes.length <= 3) return
		void run(async () => {
			await client.editor.deleteNode({
				gesture: gestureClock.current.begin(),
				nodeId,
			})
			select(null)
		})
	}

	return (
		<vector-workspace className={css.class}>
			<header>
				<brand-lockup>
					<mark>p</mark>
					<label-set>
						<strong>Plane</strong>
						<span>Shared contour study</span>
					</label-set>
				</brand-lockup>
				<document-title>
					<strong>Untitled contour</strong>
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
						<avatar-dot style={{ [`--person-color`]: client.identity.color }}>
							{client.identity.name[0]}
						</avatar-dot>
						<select
							aria-label="Simulated identity"
							onChange={(event) => {
								switchBrowserIdentity(event.currentTarget.value)
							}}
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
					<strong>Contour</strong>
					<button data-testid="add-node" onClick={addNode} type="button">
						Add node
					</button>
					<button
						data-testid="delete-node"
						disabled={
							workspace.selectedNodeId === null || contour.nodes.length <= 3
						}
						onClick={deleteNode}
						type="button"
					>
						Delete node
					</button>
					<strong>Viewport</strong>
					<button
						onClick={() => {
							client.silo.setState(contourViewportAtom, {
								...viewport,
								zoom: Math.min(2, viewport.zoom + 0.1),
							})
						}}
						type="button"
					>
						Zoom in
					</button>
					<button
						onClick={() => {
							client.silo.setState(contourViewportAtom, {
								...viewport,
								zoom: Math.max(0.5, viewport.zoom - 0.1),
							})
						}}
						type="button"
					>
						Zoom out
					</button>
				</tool-rail>
				<canvas-pane>
					<svg
						aria-label="Shared vector canvas"
						data-testid="canvas"
						onPointerCancel={() => {
							finishDrag(false)
						}}
						onPointerMove={(event) => {
							const point = logicalPoint(event)
							void publishFocus(point)
							if (client.silo.getState(contourActiveDragAtom) !== null) {
								void client.editor.previewDrag(point)
							}
						}}
						onPointerUp={() => {
							finishDrag(true)
						}}
						viewBox={`${viewport.pan.x} ${viewport.pan.y} ${256 / viewport.zoom} ${256 / viewport.zoom}`}
					>
						<title>Shared vector canvas</title>
						<rect data-kind="artboard" height="256" width="256" x="0" y="0" />
						<path data-kind="path" d={drawing} />
						{contour.nodes.map((node) => (
							<NodeHandle
								key={node.id}
								node={node}
								selected={workspace.selectedNodeId === node.id}
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
								<span>{peer.selectedNodeId ?? `observing`}</span>
							</label-set>
						</collaborator-card>
					))}
					<small>
						Every accepted edit is a complete closed contour. Undo can select a
						prior contour, never half of one.
					</small>
				</presence-rail>
			</main>
			<footer>
				One durable contour · implicit straight edges · atomic gestures
			</footer>
		</vector-workspace>
	)
}
