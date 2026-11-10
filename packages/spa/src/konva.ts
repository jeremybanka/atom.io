import Konva from "konva"

import { capabilityProps } from "./capabilities.ts"
import { owner } from "./core.ts"
import type { Children, SpaElement } from "./index.ts"
import { onCleanup, onMount } from "./index.ts"
import type { CapabilityAttributes } from "./jsx-runtime.ts"
import { jsx } from "./jsx-runtime.ts"
import { bindScene, createSceneRenderer, sceneComponent } from "./renderer.ts"

type InteractionEvent = MouseEvent | TouchEvent | PointerEvent
interface Events {
	onClick: MouseEvent
	onDblClick: MouseEvent
	onMouseDown: MouseEvent
	onMouseUp: MouseEvent
	onMouseMove: MouseEvent
	onMouseEnter: MouseEvent
	onMouseLeave: MouseEvent
	onMouseOver: MouseEvent
	onMouseOut: MouseEvent
	onContextMenu: PointerEvent
	onWheel: WheelEvent
	onPointerDown: PointerEvent
	onPointerUp: PointerEvent
	onPointerMove: PointerEvent
	onPointerEnter: PointerEvent
	onPointerLeave: PointerEvent
	onPointerOver: PointerEvent
	onPointerOut: PointerEvent
	onPointerCancel: PointerEvent
	onPointerClick: PointerEvent
	onPointerDblClick: PointerEvent
	onGotPointerCapture: PointerEvent
	onLostPointerCapture: PointerEvent
	onTouchStart: TouchEvent
	onTouchMove: TouchEvent
	onTouchEnd: TouchEvent
	onTouchCancel: TouchEvent
	onTap: TouchEvent
	onDblTap: TouchEvent
	onDragStart: InteractionEvent
	onDragMove: InteractionEvent
	onDragEnd: InteractionEvent
	onTransformStart: InteractionEvent
	onTransform: InteractionEvent
	onTransformEnd: InteractionEvent | undefined
}
type Config<C> = {
	[K in keyof C as string extends K ? never : number extends K ? never : K]: C[K]
}
type Props<C, N extends Konva.Node> = Config<C> & {
	[K in keyof Events]?:
		| ((
				event: Omit<Konva.KonvaEventObject<Events[K]>, `currentTarget`> & {
					readonly currentTarget: N
				},
		  ) => void)
		| undefined
} & CapabilityAttributes<`konva`> & {
		children?: Children
		ref?: (node: N | null) => void
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
			const current = parent.getChildren()
			if (
				current.length === children.length &&
				children.every((child, index) => child === current[index])
			)
				return
			const wanted = new Set(children)
			for (const child of [...current]) if (!wanted.has(child)) child.remove()
			children.forEach((child, index) => {
				if (child.getParent() !== parent) parent.add(child as any)
				// Layer zIndex also updates the Stage's canvas order.
				if (parent instanceof Konva.Stage && child.zIndex() !== index)
					child.zIndex(index)
			})
			if (!(parent instanceof Konva.Stage)) {
				parent.children = [...children]
				parent._setChildrenIndices()
			}
		}
	},
	destroy(node) {
		node.off()
		node.destroy()
	},
})

/** A DOM boundary owning a Konva stage and its scene subtree. */
export function Stage(
	props: Props<Omit<Config<Konva.StageConfig>, `container`>, Konva.Stage> & {
		width?: number
		height?: number
	},
): SpaElement {
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
