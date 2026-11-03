import { fail, owner } from "./core.ts"
import type { ThreeEventAttributes, ThreeEventHandler } from "./three-events.ts"
import { createThreeEvents, forgetThree, listenThree } from "./three-events.ts"

export type {
	ThreeEventAttributes,
	ThreeEventHandler,
	ThreeEventManager,
	ThreePointerEvent,
} from "./three-events.ts"
export { createThreeEvents } from "./three-events.ts"
import * as THREE from "three"

import type { Child, VNode } from "./index.ts"
import { onCleanup, onMount } from "./index.ts"
import type { CapabilityAttributes } from "./jsx-runtime.ts"
import { jsx } from "./jsx-runtime.ts"
import {
	bindScene,
	createSceneRenderer,
	onSceneFrame,
	sceneComponent,
} from "./renderer.ts"

type Resource = THREE.Object3D | THREE.BufferGeometry | THREE.Material
type Vector3 = readonly [number, number, number]
export interface ObjectProps<N extends THREE.Object3D = THREE.Object3D>
	extends CapabilityAttributes<`three`>, ThreeEventAttributes<N> {
	children?: Child
	position?: Vector3
	rotation?: Vector3
	scale?: Vector3 | number
	visible?: boolean
	name?: string
	ref?: (object: N | null) => void
}
const constructors = {
	Group: THREE.Group,
	Mesh: THREE.Mesh,
	PerspectiveCamera: THREE.PerspectiveCamera,
	AmbientLight: THREE.AmbientLight,
	DirectionalLight: THREE.DirectionalLight,
	BoxGeometry: THREE.BoxGeometry,
	SphereGeometry: THREE.SphereGeometry,
	PlaneGeometry: THREE.PlaneGeometry,
	MeshStandardMaterial: THREE.MeshStandardMaterial,
	MeshBasicMaterial: THREE.MeshBasicMaterial,
	MeshNormalMaterial: THREE.MeshNormalMaterial,
}
const meshDefaults = new WeakMap<
	THREE.Mesh,
	{ geometry: THREE.BufferGeometry; material: THREE.Material }
>()
const constructorArgs = new WeakMap<Resource, unknown[]>()
const eventHandlers = new WeakMap<Resource, Map<string, () => void>>()
const defaults = new WeakMap<Resource, Map<string, any>>()
function writeProperty(node: Resource, key: string, value: any): void {
	const target = node as any
	if (!(key in target)) throw new Error(`spa/three: unknown property ${key}`)
	const current = target[key]
	if (current?.isColor) current.set(value)
	else if (Array.isArray(value) && typeof current?.set === `function`)
		current.set(...value)
	else if (key === `scale` && typeof value === `number`) current.setScalar(value)
	else if (current?.copy && value?.constructor === current.constructor)
		current.copy(value)
	else target[key] = value
	if (node instanceof THREE.PerspectiveCamera) node.updateProjectionMatrix()
}
const renderer = createSceneRenderer<Resource>({
	target(node) {
		return {
			kind: `three`,
			node,
			...(node instanceof THREE.Object3D
				? {
						listen: (type: string, listener: () => void) =>
							listenThree(node, type, listener),
					}
				: {}),
			read(key) {
				const value = (node as any)[key]
				return value?.isColor
					? value.getStyle()
					: value?.isVector3 || value?.isEuler
						? [value.x, value.y, value.z]
						: value
			},
			write(key, value) {
				writeProperty(node, key, value)
			},
		}
	},
	create(type, props) {
		const Constructor = constructors[type as keyof typeof constructors]
		if (!Constructor) throw new Error(`spa/three: unknown node ${type}`)
		const node = new (Constructor as any)(...(props[`args`] ?? [])) as Resource
		// Mesh's implicit resources are replaced by owned JSX resources below.
		if (node instanceof THREE.Mesh)
			meshDefaults.set(node, {
				geometry: node.geometry,
				material: node.material as THREE.Material,
			})
		constructorArgs.set(node, [...(props[`args`] ?? [])])
		defaults.set(node, new Map())
		eventHandlers.set(node, new Map())
		return node
	},
	update(node, props, previous) {
		if (!equalArgs(constructorArgs.get(node)!, props[`args`]))
			throw new Error(
				`spa/three: change the component key to replace constructor args`,
			)
		const target = node as any
		const saved = defaults.get(node)!
		for (const key of new Set([
			...Object.keys(previous),
			...Object.keys(props),
		])) {
			if (
				/^(key|children|ref|args)$/.test(key) ||
				Object.is(props[key], previous[key])
			)
				continue
			if (key.startsWith(`on`)) {
				if (
					!(node instanceof THREE.Object3D) ||
					!/^on(Pointer(Down|Up|Move|Enter|Leave|Over|Out|Cancel)|Click)$/.test(
						key,
					)
				)
					throw new Error(`spa/three: unknown event ${key}`)
				const handlers = eventHandlers.get(node)!
				handlers.get(key)?.()
				handlers.delete(key)
				if (props[key])
					handlers.set(
						key,
						listenThree(
							node,
							key.slice(2).toLowerCase(),
							props[key] as ThreeEventHandler,
						),
					)
				continue
			}
			if (!(key in target)) throw new Error(`spa/three: unknown property ${key}`)
			const current = target[key]
			if (!saved.has(key))
				saved.set(key, current?.clone ? current.clone() : current)
			const value = props[key] === undefined ? saved.get(key) : props[key]
			writeProperty(node, key, value)
		}
		if (node instanceof THREE.PerspectiveCamera) node.updateProjectionMatrix()
	},
	children(parent, children) {
		if (!(parent instanceof THREE.Object3D)) {
			if (children.length)
				throw new Error(`spa/three: resources cannot contain children`)
			return
		}
		const objects = children.filter(
			(child): child is THREE.Object3D => child instanceof THREE.Object3D,
		)
		for (const child of [...parent.children])
			if (!objects.includes(child)) parent.remove(child)
		for (const child of objects) if (child.parent !== parent) parent.add(child)
		parent.children.splice(0, parent.children.length, ...objects)
		const resources = children.filter(
			(child) => !(child instanceof THREE.Object3D),
		)
		if (resources.length && !(parent instanceof THREE.Mesh))
			throw new Error(`spa/three: geometry and material require a Mesh parent`)
		if (parent instanceof THREE.Mesh) {
			const geometries = resources.filter(
				(child) => child instanceof THREE.BufferGeometry,
			)
			const materials = resources.filter(
				(child) => child instanceof THREE.Material,
			)
			if (geometries.length > 1 || materials.length > 1)
				throw new Error(
					`spa/three: each Mesh accepts one geometry and one material`,
				)
			parent.geometry = geometries[0] ?? meshDefaults.get(parent)!.geometry
			parent.material = materials[0] ?? meshDefaults.get(parent)!.material
		}
	},
	destroy(node) {
		eventHandlers.get(node)!.clear()
		if (node instanceof THREE.Object3D) {
			try {
				forgetThree(node)
			} finally {
				node.removeFromParent()
				if (node instanceof THREE.Mesh) {
					const owned = meshDefaults.get(node)!
					owned.geometry.dispose()
					owned.material.dispose()
				}
			}
		} else node.dispose()
	},
})
function equalArgs(a: unknown[], b: unknown[] = []): boolean {
	return (
		a.length === b.length &&
		a.every((value, index) => Object.is(value, b[index]))
	)
}

export interface CanvasProps {
	children?: Child
	width?: number
	height?: number
	camera?: THREE.Camera
	onFrame?: (state: {
		scene: THREE.Scene
		camera: THREE.Camera
		renderer: THREE.WebGLRenderer
		delta: number
		time: number
	}) => void
}
/** Browser-only scene boundary. The camera prop is borrowed and never disposed. */
export function Canvas(props: CanvasProps): VNode {
	let canvas: HTMLCanvasElement | null = null
	onMount(() => {
		const webgl = new THREE.WebGLRenderer({ canvas: canvas!, antialias: true })
		onCleanup(() => {
			webgl.dispose()
		})
		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
		camera.position.z = 5
		bindScene(
			() => [props.width ?? 800, props.height ?? 600] as const,
			([width, height]) => {
				webgl.setSize(width, height)
				camera.aspect = width / height
				camera.updateProjectionMatrix()
			},
		)
		renderer.mount(() => props.children, scene)
		const root = owner!._root
		const events = createThreeEvents(
			canvas!,
			scene,
			() => props.camera ?? camera,
			(error) => {
				try {
					fail(root, error)
				} catch (failure) {
					root.error(failure)
				}
			},
		)
		onCleanup(() => {
			events.dispose()
		})
		let last: number | undefined
		onSceneFrame((time) => {
			const active = props.camera ?? camera
			const delta = last === undefined ? 0 : (time - last) / 1000
			last = time
			props.onFrame?.({
				scene,
				camera: active,
				renderer: webgl,
				delta,
				time: time / 1000,
			})
			events.update()
			webgl.render(scene, active)
		})
	})
	return jsx(`canvas`, {
		ref: (element: HTMLCanvasElement | null) => {
			canvas = element
		},
	})
}
export const Group = sceneComponent<ObjectProps>(`Group`)
export const Mesh = sceneComponent<ObjectProps<THREE.Mesh>>(`Mesh`)
export const PerspectiveCamera = sceneComponent<
	ObjectProps<THREE.PerspectiveCamera> & {
		args?: ConstructorParameters<typeof THREE.PerspectiveCamera>
		fov?: number
		aspect?: number
		near?: number
		far?: number
	}
>(`PerspectiveCamera`)
export const AmbientLight = sceneComponent<
	ObjectProps<THREE.Light> & {
		color?: THREE.ColorRepresentation
		intensity?: number
	}
>(`AmbientLight`)
export const DirectionalLight = sceneComponent<
	ObjectProps<THREE.Light> & {
		color?: THREE.ColorRepresentation
		intensity?: number
	}
>(`DirectionalLight`)
export const BoxGeometry = sceneComponent<{
	args?: ConstructorParameters<typeof THREE.BoxGeometry>
	ref?: (node: THREE.BoxGeometry | null) => void
}>(`BoxGeometry`)
export const SphereGeometry = sceneComponent<{
	args?: ConstructorParameters<typeof THREE.SphereGeometry>
	ref?: (node: THREE.SphereGeometry | null) => void
}>(`SphereGeometry`)
export const PlaneGeometry = sceneComponent<{
	args?: ConstructorParameters<typeof THREE.PlaneGeometry>
	ref?: (node: THREE.PlaneGeometry | null) => void
}>(`PlaneGeometry`)
export const MeshStandardMaterial = sceneComponent<
	THREE.MeshStandardMaterialParameters &
		CapabilityAttributes<`three`> & {
			ref?: (node: THREE.MeshStandardMaterial | null) => void
		}
>(`MeshStandardMaterial`)
export const MeshBasicMaterial = sceneComponent<
	THREE.MeshBasicMaterialParameters &
		CapabilityAttributes<`three`> & {
			ref?: (node: THREE.MeshBasicMaterial | null) => void
		}
>(`MeshBasicMaterial`)
export const MeshNormalMaterial = sceneComponent<
	THREE.MeshNormalMaterialParameters &
		CapabilityAttributes<`three`> & {
			ref?: (node: THREE.MeshNormalMaterial | null) => void
		}
>(`MeshNormalMaterial`)
export { renderer as threeRenderer }
