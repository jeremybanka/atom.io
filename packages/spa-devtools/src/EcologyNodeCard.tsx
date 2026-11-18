/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement } from "@atom.io/spa"
import { bindScene } from "@atom.io/spa/renderer"
import type { Scene } from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js"

import type { GraphItem } from "./ecology-graph.ts"
import css from "./EcologyNodeCard.module.css"

export function EcologyNodeCard(props: {
	item: GraphItem
	visible: boolean
	selected: boolean
	dimmed: boolean
	collapsed?: boolean
	traced: boolean
	scene: Scene
	invalidate(): void
}): SpaElement {
	const detail = () => {
		const source = props.item.source
		return `memberKeys` in source
			? `${source.type.includes(`selector`) ? `Selector Family` : `Atom Family`} · ${source.memberCount}${source.countComplete ? `` : `+`} members`
			: `${source.kind === `atom` ? `Atom` : `Selector`} · ${source.value.status === `cached` ? (source.value.preview ?? `…`) : `–`}`
	}
	let element: HTMLElement | null = null
	onMount(() => {
		const label = new CSS2DObject(element!)
		props.scene.add(label)
		bindScene(
			() => ({
				item: props.item,
				visible: props.visible,
				order: props.selected ? 2 : props.traced ? 1 : 0,
			}),
			({ item, visible, order }) => {
				label.position.set(item.x, item.y, item.z)
				label.visible = visible
				label.renderOrder = order
				props.invalidate()
			},
		)
		onCleanup(() => {
			label.removeFromParent()
			props.invalidate()
		})
	})
	return (
		<ecology-node-card
			class={css.class}
			style={`--ecology-color: ${props.item.color}`}
			ref={(node) => {
				element = node
			}}
			hidden={!props.visible}
			data-kind={props.item.kind}
			data-type={props.item.source.type}
			data-traced={props.traced}
			data-dimmed={props.dimmed}
			data-collapsed={props.collapsed}
			data-position={`${props.item.x},${props.item.y},${props.item.z}`}
		>
			<button
				type="button"
				data-node
				data-graph-id={props.visible ? props.item.id : undefined}
				aria-label={`${props.item.label} · ${detail()}`}
				aria-pressed={props.selected}
				onPointerDown={(event) => {
					event.stopPropagation()
				}}
				title={`${props.item.label}\n${props.item.source.type}\n${props.item.detail}`}
			>
				<strong>{props.item.label}</strong>
				<small
					data-uncached={
						`value` in props.item.source &&
						props.item.source.value.status === `unknown`
					}
				>
					{detail()}
				</small>
			</button>
		</ecology-node-card>
	)
}
