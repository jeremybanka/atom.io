/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement, useStore } from "@atom.io/spa"
import type { MotionAttributes } from "@atom.io/spa/motion"
import { bindScene } from "@atom.io/spa/renderer"
import type { Scene } from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"

import type { GraphItem } from "./ecology-graph.ts"
import type { ProjectedEdge } from "./ecology-lines.ts"
import { type createEcologyMotion, FAMILY_SPRING } from "./ecology-motion.ts"
import css from "./EcologyNodeCard.module.css"
import { useLocal } from "./store.ts"

export function EcologyNodeCard(props: {
	motion: ReturnType<typeof createEcologyMotion>
	release(id: string): void
	registerEdges(
		paint: (paths: ReadonlyMap<string, readonly ProjectedEdge[]>) => void,
	): () => void
	item: GraphItem
	selected: boolean
	dimmed: boolean
	collapsed?: boolean
	traced: boolean
	scene: Scene
	invalidate(): void
}): SpaElement {
	const detail = (source: GraphItem[`source`]) => {
		return `memberKeys` in source
			? `${source.type.includes(`selector`) ? `Selector Family` : `Atom Family`} · ${source.memberCount}${source.countComplete ? `` : `+`} members`
			: `${source.kind === `atom` ? `Atom` : `Selector`} · ${source.value.status === `cached` ? (source.value.preview ?? `…`) : `–`}`
	}
	const description = () => {
		const item = props.item
		return `${item.key} · ${detail(item.source)}`
	}
	const title = () => {
		const item = props.item
		return `${item.key}\n${item.source.type}\n${item.detail}`
	}
	const position = () => {
		const { x, y, z } = props.item
		return `${x},${y},${z}`
	}
	const uncached = () => {
		const source = props.item.source
		return `value` in source && source.value.status === `unknown`
	}
	const empty: readonly ProjectedEdge[] = []
	const [pathCount, setPathCount] = useLocal(useStore(), 0)
	const paths = new Map<number, SVGPathElement>()
	const paintPath = (
		node: SVGPathElement,
		path: ProjectedEdge,
		previous?: ProjectedEdge,
	) => {
		if (path.d !== previous?.d) node.setAttribute(`d`, path.d)
		if (path.traced !== previous?.traced)
			node.setAttribute(`data-traced`, String(path.traced))
	}
	let outgoing = empty,
		id = ``
	const identity = props.item.id
	onCleanup(() => {
		props.release(identity)
	})
	let element: HTMLElement | null = null
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
				order: props.selected ? 2 : props.traced ? 1 : 0,
			}),
			({ item, order }) => {
				id = item.id
				label.position.set(item.x, item.y, item.z)
				label.renderOrder = order
				props.invalidate()
			},
		)
		onCleanup(() => {
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
			data-type={props.item.source.type}
			data-family={props.item.familyLabel}
			data-traced={props.traced}
			data-dimmed={props.dimmed}
			data-collapsed={props.collapsed}
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
				type="button"
				data-node
				data-graph-id={props.item.id}
				aria-label={description()}
				aria-pressed={props.selected}
				onPointerDown={(event) => {
					event.stopPropagation()
				}}
				title={title()}
			>
				{props.item.familyLabel !== undefined && (
					<small data-family>{props.item.familyLabel}</small>
				)}
				<strong>{props.item.label}</strong>
				<small data-uncached={uncached()}>{detail(props.item.source)}</small>
			</button>
		</ecology-node-card>
	)
}
