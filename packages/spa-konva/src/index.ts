import type { Child, VNode } from "@atom.io/spa"
import { onCleanup, onMount } from "@atom.io/spa"
import { jsx } from "@atom.io/spa/jsx-runtime"
import {
	bindScene,
	createSceneRenderer,
	sceneComponent,
} from "@atom.io/spa/renderer"
import Konva from "konva"

type Props<C, N> = C & {
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
	create(type) {
		const Constructor = constructors[type as keyof typeof constructors]
		if (!Constructor) throw new Error(`spa-konva: unknown node ${type}`)
		return new Constructor({} as any)
	},
	update: updateNode,
	children(parent, children) {
		if (children.length && !(parent instanceof Konva.Container))
			throw new Error(`spa-konva: shapes cannot contain children`)
		if (parent instanceof Konva.Container) {
			for (const child of parent.getChildren())
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
		const stage = new Konva.Stage({
			container: container!,
			width: props.width ?? 300,
			height: props.height ?? 150,
		})
		onCleanup(() => {
			stage.off()
			stage.destroy()
		})
		let previous: Record<string, any> = {}
		bindScene(
			() => ({ ...props }),
			(next) => {
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
