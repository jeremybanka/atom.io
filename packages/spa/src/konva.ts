import Konva from "konva"

import { capabilityProps } from "./capabilities.ts"
import { owner } from "./core.ts"
import type { Child, VNode } from "./index.ts"
import { onCleanup, onMount } from "./index.ts"
import type { CapabilityAttributes } from "./jsx-runtime.ts"
import { jsx } from "./jsx-runtime.ts"
import { bindScene, createSceneRenderer, sceneComponent } from "./renderer.ts"

type Props<C, N> = C &
	CapabilityAttributes<`konva`> & {
		children?: Child
		ref?: (node: N | null) => void
		onClick?: (event: Konva.KonvaEventObject<MouseEvent>) => void
		onPointerDown?: (event: Konva.KonvaEventObject<PointerEvent>) => void
		onDragMove?: (event: Konva.KonvaEventObject<DragEvent>) => void
		onDragEnd?: (event: Konva.KonvaEventObject<DragEvent>) => void
	}
const constructors = {
	Layer: Konva.Layer,
	Group: Konva.Group,
	Rect: Konva.Rect,
	Circle: Konva.Circle,
	Ellipse: Konva.Ellipse,
	Line: Konva.Line,
	Text: Konva.Text,
	Image: Konva.Image,
	Path: Konva.Path,
	Star: Konva.Star,
	Transformer: Konva.Transformer,
}
function suspendNode(node: Konva.Node): () => void {
	const listening = node.listening()
	const draggable = node.draggable()
	node.listening(false)
	// The public setter clears both pending and active native drag records.
	node.draggable(false)
	return () => {
		node.listening(listening)
		node.draggable(draggable)
	}
}
function updateNode(
	node: Konva.Node,
	props: Record<string, any>,
	previous: Record<string, any>,
): void {
	for (const key of new Set([...Object.keys(previous), ...Object.keys(props)])) {
		if (/^(key|children|ref)$/.test(key) || Object.is(props[key], previous[key]))
			continue
		if (key.startsWith(`on`)) {
			const event = key.slice(2).toLowerCase()
			if (previous[key]) node.off(event, previous[key])
			if (props[key]) node.on(event, props[key])
		} else node.setAttr(key, props[key])
	}
}
const renderer = createSceneRenderer<Konva.Node>({
	target(node) {
		return {
			kind: `konva`,
			node,
			suspend() {
				return suspendNode(node)
			},
			read: (key) => node.getAttr(key),
			write: (key, value) => {
				node.setAttr(key, value)
			},
			listen(event, listener) {
				node.on(event, listener)
				return () => {
					node.off(event, listener)
				}
			},
		}
	},
	create(type) {
		const Constructor = constructors[type as keyof typeof constructors]
		if (!Constructor) throw new Error(`spa/konva: unknown node ${type}`)
		return new Constructor({} as any)
	},
	update: updateNode,
	children(parent, children) {
		if (children.length && !(parent instanceof Konva.Container))
			throw new Error(`spa/konva: shapes cannot contain children`)
		if (parent instanceof Konva.Container) {
			for (const child of [...parent.getChildren()])
				if (!children.includes(child)) child.remove()
			children.forEach((child, index) => {
				if (child.getParent() !== parent) parent.add(child as any)
				child.zIndex(index)
			})
		}
	},
	destroy(node) {
		node.off()
		node.destroy()
	},
})

/** A DOM boundary owning a Konva stage and its scene subtree. */
export function Stage(
	props: Props<Omit<Konva.StageConfig, `container`>, Konva.Stage> & {
		width?: number
		height?: number
	},
): VNode {
	let container: HTMLDivElement | null = null
	onMount(() => {
		// Konva clears its container; preserve SPA's markers in the outer element.
		const surface = container!.ownerDocument.createElement(`div`)
		container!.append(surface)
		onCleanup(() => {
			surface.remove()
		})
		const stage = new Konva.Stage({
			container: surface,
			width: props.width ?? 300,
			height: props.height ?? 150,
		})
		onCleanup(() => {
			stage.off()
			stage.destroy()
		})
		const nativeProps = capabilityProps(
			owner!,
			{
				kind: `konva`,
				node: stage,
				suspend() {
					return suspendNode(stage)
				},
				listen(event, listener) {
					stage.on(event, listener)
					return () => {
						stage.off(event, listener)
					}
				},
				read: (key) => stage.getAttr(key),
				write: (key, value) => {
					stage.setAttr(key, value)
				},
			},
			() => ({ ...props }),
		)
		let previous: Record<string, any> = {}
		bindScene(
			() => ({ ...props }),
			(all) => {
				const next = nativeProps(all)
				updateNode(stage, next, previous)
				previous = next
			},
		)
		props.ref?.(stage)
		onCleanup(() => props.ref?.(null))
		renderer.mount(() => props.children, stage)
	})
	return jsx(`div`, {
		ref: (element: HTMLDivElement | null) => {
			container = element
		},
	})
}
export const Layer =
	sceneComponent<Props<Konva.LayerConfig, Konva.Layer>>(`Layer`)
export const Group =
	sceneComponent<Props<Konva.ContainerConfig, Konva.Group>>(`Group`)
export const Rect = sceneComponent<Props<Konva.RectConfig, Konva.Rect>>(`Rect`)
export const Circle =
	sceneComponent<Props<Konva.CircleConfig, Konva.Circle>>(`Circle`)
export const Ellipse =
	sceneComponent<Props<Konva.EllipseConfig, Konva.Ellipse>>(`Ellipse`)
export const Line = sceneComponent<Props<Konva.LineConfig, Konva.Line>>(`Line`)
export const Text = sceneComponent<Props<Konva.TextConfig, Konva.Text>>(`Text`)
export const Image =
	sceneComponent<Props<Konva.ImageConfig, Konva.Image>>(`Image`)
export const Path = sceneComponent<Props<Konva.PathConfig, Konva.Path>>(`Path`)
export const Star = sceneComponent<Props<Konva.StarConfig, Konva.Star>>(`Star`)
export const Transformer =
	sceneComponent<Props<Konva.TransformerConfig, Konva.Transformer>>(
		`Transformer`,
	)
export { renderer as konvaRenderer }
