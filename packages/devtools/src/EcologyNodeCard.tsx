/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement, useStore } from "@atom.io/spa"
import type { MotionAttributes } from "@atom.io/spa/motion"
import { bindScene } from "@atom.io/spa/renderer"
import { peekState } from "atom.io/introspection"
import type { Scene } from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"

import kablooey from "./assets/kablooey.png"
import {
	ecologyLoadState,
	ecologyOperationLabels,
	ecologyTimelinePosition,
} from "./ecology.ts"
import {
	type CardFeedbackState,
	createCardFeedback,
	EXPLOSION_FRAMES,
	EXPLOSION_MS,
} from "./ecology-card-feedback.ts"
import type { GraphItem } from "./ecology-graph.ts"
import type { ProjectedEdge } from "./ecology-lines.ts"
import { type createEcologyMotion, FAMILY_SPRING } from "./ecology-motion.ts"
import css from "./EcologyNodeCard.module.css"
import { EcologyPrimitiveIcon } from "./EcologyPrimitiveIcon.tsx"
import type { EcologyActivity } from "./EcologyView.tsx"
import { type EditorTools, useLocal } from "./store.ts"
import { cardValuePreview } from "./value.ts"

export function EcologyNodeCard(props: {
	motion: ReturnType<typeof createEcologyMotion>
	release(id: string): void
	registerEdges(
		paint: (paths: ReadonlyMap<string, readonly ProjectedEdge[]>) => void,
	): () => void
	item: GraphItem
	expanded?: boolean | undefined
	tools: EditorTools
	activity?: EcologyActivity | undefined
	completedLoads: WeakSet<object>
	reducedMotion: MediaQueryList
	selected: boolean
	hovered: boolean
	dimmed: boolean
	collapsed?: boolean
	traced: boolean
	scene: Scene
	invalidate(): void
}): SpaElement {
	const { source: initialSource, history } = props.item
	const timeline =
		initialSource.type === `timeline` && !history
			? props.tools.history.useTimeline(initialSource.key)
			: undefined
	let previewed:
		| { value: unknown; revision: number | undefined; text: string }
		| undefined
	const detailValue = () => {
		const revision = props.activity?.revision
		const cache = peekState(props.tools.store, props.item.key)
		if (!cache.present) return `–`
		if (
			previewed &&
			Object.is(previewed.value, cache.value) &&
			(revision === undefined || revision === previewed.revision)
		)
			return previewed.text
		const text = cardValuePreview(cache.value)
		previewed = { value: cache.value, revision, text }
		return text
	}
	const detail = (source: GraphItem[`source`]) => {
		if (props.item.history) return props.item.detail
		if (`memberKeys` in source) {
			const label =
				source.type === `timeline_family`
					? ecologyOperationLabels.timeline_family
					: source.type.includes(`selector`)
						? `Selector Family`
						: `Atom Family`
			return `${label} · ${source.memberCount}${source.countComplete ? `` : `+`} members`
		}
		if (!(`kind` in source))
			return source.type === `transaction`
				? ecologyOperationLabels.transaction
				: `${ecologyOperationLabels.timeline} · ${ecologyTimelinePosition(source, timeline?.())}`
		return `${source.kind === `atom` ? `Atom` : `Selector`} · ${detailValue()}`
	}
	const description = () => {
		const item = props.item
		return `${item.history ? item.label : item.key} · ${detail(item.source)}`
	}
	const title = () => {
		const item = props.item
		if (item.history) return description()
		return `${item.key}\n${item.source.type}\n${`at` in item.source ? ecologyTimelinePosition(item.source, timeline?.()) : item.detail}`
	}
	const position = () => {
		const { x, y, z } = props.item
		return `${x},${y},${z}`
	}
	const uncached = () => {
		const source = props.item.source
		// Refresh the cache check when the node's activity changes.
		props.activity
		return `value` in source && !peekState(props.tools.store, source.key).present
	}
	const empty: readonly ProjectedEdge[] = []
	const store = useStore()
	const [pathCount, setPathCount] = useLocal(store, 0)
	const [feedbackState, setFeedbackState] = useLocal<CardFeedbackState>(store, {
		future: undefined,
		caught: undefined,
	})
	const futureDescription = () => {
		switch (feedbackState().future) {
			case `loading`:
				return `Loading`
			case `windback`:
				return `Load restarted`
			case `done`:
			case `complete`:
				return `Load complete`
			case undefined:
				return undefined
		}
	}
	let feedback: ReturnType<typeof createCardFeedback> | undefined
	const errorReveal = () => {
		const { caught } = feedbackState()
		if (!caught || caught.phase === `true`) return null
		const { replay } = caught
		return (
			<span
				key={replay}
				data-error-reveal
				aria-hidden="true"
				style={`--ecology-explosion-duration: ${EXPLOSION_MS}ms; --ecology-explosion-frames: ${EXPLOSION_FRAMES}`}
			>
				<span data-explosion>
					<img
						alt=""
						onLoad={() => feedback?.imageLoaded(replay)}
						onError={() => feedback?.finishError(replay)}
						onAnimationEnd={() => feedback?.finishError(replay)}
						onAnimationCancel={() => feedback?.finishError(replay)}
						src={kablooey}
					/>
				</span>
			</span>
		)
	}
	const paths = new Map<number, SVGPathElement>()
	const paintPath = (
		node: SVGPathElement,
		path: ProjectedEdge,
		previous?: ProjectedEdge,
	) => {
		if (path.d !== previous?.d) node.setAttribute(`d`, path.d)
		if (path.traced !== previous?.traced)
			node.setAttribute(`data-traced`, String(path.traced))
		if (path.relation !== previous?.relation) {
			if (path.relation) node.setAttribute(`data-relation`, path.relation)
			else node.removeAttribute(`data-relation`)
		}
	}
	let outgoing = empty,
		id = ``
	const identity = props.item.id
	onCleanup(() => {
		props.release(identity)
	})
	let element: HTMLElement | null = null
	let button: HTMLButtonElement | null = null
	onMount(() => {
		const label = new CSS2DObject(element!)
		label.name = props.item.id
		props.scene.add(label)
		onCleanup(
			props.registerEdges((layers) => {
				const next = layers.get(id) ?? empty
				if (
					next.length !== outgoing.length ||
					next.some((path, index) => path !== outgoing[index])
				) {
					const resized = next.length !== outgoing.length
					// Exiting SPA subtrees freeze reconciliation; clear retired geometry now.
					for (const [index, node] of paths)
						if (index >= next.length) node.setAttribute(`d`, ``)
					for (let index = 0; index < next.length; index++) {
						const node = paths.get(index)
						if (node) paintPath(node, next[index], outgoing[index])
					}
					outgoing = next
					if (resized) setPathCount(next.length)
				}
			}),
		)
		bindScene(
			() => ({
				item: props.item,
				order: props.hovered ? 3 : props.selected ? 2 : props.traced ? 1 : 0,
			}),
			({ item, order }) => {
				id = item.id
				label.position.set(item.x, item.y, item.z)
				label.renderOrder = order
				props.invalidate()
			},
		)
		let flash: Animation | undefined
		let lastRevision = 0
		bindScene(
			() => props.activity,
			(activity) => {
				if (!activity || activity.revision <= lastRevision) return
				lastRevision = activity.revision
				if (props.reducedMotion.matches || performance.now() - activity.at > 500)
					return
				flash?.cancel()
				flash = button?.animate?.(
					[
						{
							backgroundColor: `color-mix(in srgb, var(--ecology-color) 24%, var(--surface-inactive))`,
						},
						{},
					],
					{ duration: 480, easing: `ease-out` },
				)
			},
		)
		if (`kind` in props.item.source) {
			const controller = createCardFeedback(
				button!.ownerDocument.defaultView!,
				props.reducedMotion,
				setFeedbackState,
			)
			feedback = controller
			let lastCaught: unknown
			let feedbackRevision = 0
			let feedbackItem: GraphItem | undefined
			bindScene(
				() => ({ item: props.item, activity: props.activity }),
				({ item, activity }) => {
					const newRevision =
						activity !== undefined && activity.revision > feedbackRevision
					if (!newRevision && item === feedbackItem) return
					const fresh = newRevision && performance.now() - activity.at < 500
					const events =
						newRevision && (feedbackItem || fresh) ? activity.future : undefined
					if (newRevision) feedbackRevision = activity.revision
					feedbackItem = item
					const { definition, raw, status } = ecologyLoadState(
						props.tools.store,
						item.key,
					)
					if (definition && status) props.completedLoads.delete(definition)
					controller.future(
						status === `pending`,
						definition !== undefined && props.completedLoads.has(definition),
						events,
					)
					const caught = status === `caught`
					const nextCaught = caught ? raw : undefined
					if (!Object.is(nextCaught, lastCaught)) {
						controller.error(caught, fresh)
						lastCaught = nextCaught
					}
				},
			)
			onCleanup(controller.dispose)
		}
		onCleanup(() => {
			flash?.cancel()
			label.removeFromParent()
			props.invalidate()
		})
	})
	const animation = (): MotionAttributes =>
		props.item.cluster
			? {
					"motion:initial": props.motion.entering(props.item.id)
						? { opacity: 0 }
						: false,
					"motion:animate": { opacity: 1 },
					"motion:exit": props.motion.exiting(props.item.id)
						? { opacity: 0 }
						: {},
					"motion:transition": FAMILY_SPRING,
				}
			: {}
	return (
		<ecology-node-card
			{...animation()}
			class={css.class}
			style={`--ecology-color: ${props.item.color}`}
			ref={(node) => {
				element = node
			}}
			data-kind={props.item.kind}
			data-history={props.item.history?.direction}
			data-type={props.item.source.type}
			data-family={props.item.familyLabel}
			data-traced={props.traced}
			data-dimmed={props.dimmed}
			data-collapsed={props.collapsed}
			data-hovered={props.hovered}
			data-position={position()}
		>
			{pathCount() > 0 && (
				<svg
					width="1"
					height="1"
					aria-hidden="true"
					focusable="false"
					fill="none"
					stroke="var(--ecology-color)"
				>
					{/* SPA owns the paths; the camera pass paints geometry into these retained slots. */}
					{Array.from({ length: pathCount() }, (_, index) => (
						<path
							ref={(node) => {
								if (node) {
									paths.set(index, node)
									paintPath(node, outgoing[index])
								} else paths.delete(index)
							}}
						/>
					))}
				</svg>
			)}
			<button
				ref={(node) => {
					button = node
				}}
				type="button"
				data-node
				data-graph-id={props.item.id}
				data-history-owner={props.item.history ? props.item.familyId : undefined}
				data-history-event={props.item.history?.identity}
				data-future={feedbackState().future}
				data-caught={feedbackState().caught?.phase}
				aria-label={description()}
				aria-description={futureDescription()}
				aria-pressed={props.selected}
				aria-expanded={props.expanded}
				onPointerDown={(event) => {
					event.stopPropagation()
				}}
				title={title()}
			>
				{props.item.familyLabel !== undefined && (
					<small data-family>{props.item.familyLabel}</small>
				)}
				<strong>{props.item.label}</strong>
				<small data-uncached={uncached()}>
					<EcologyPrimitiveIcon source={props.item.source} placement="detail" />
					{detail(props.item.source)}
				</small>
				{feedbackState().future && (
					<span data-future-indicator aria-hidden="true">
						<span data-loading-glyph />
						<span data-done-glyph>✓</span>
					</span>
				)}
				{errorReveal()}
			</button>
		</ecology-node-card>
	)
}
