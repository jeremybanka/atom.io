import { isPresent, owner, reportScopeError } from "./core.ts"
import type { ThreeEventAttributes, ThreeEventHandler } from "./three-events.ts"
import {
	createThreeEvents,
	forgetThree,
	listenThree,
	suspendThree,
} from "./three-events.ts"

export type {
	ThreeEventAttributes,
	ThreeEventHandler,
	ThreeEventManager,
	ThreePointerEvent,
} from "./three-events.ts"
export { createThreeEvents } from "./three-events.ts"
import * as THREE from "three"

import type { Children, SpaElement } from "./index.ts"
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
	children?: Children
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
	{
		geometry: THREE.BufferGeometry
		material: THREE.Material | THREE.Material[]
		ownsGeometry: boolean
		ownsMaterial: boolean
	}
>()
const borrowedMeshDefaults = new WeakMap<
	THREE.Mesh,
	{
		geometry: THREE.BufferGeometry
		material: THREE.Material | THREE.Material[]
	}
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
						suspend: () => suspendThree(node),
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
				material: node.material,
				ownsGeometry: props[`args`]?.[0] === undefined,
				ownsMaterial: props[`args`]?.[1] === undefined,
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
	children(parent, children, activeChildren) {
		if (!(parent instanceof THREE.Object3D)) {
			if (children.length)
				throw new Error(`spa/three: resources cannot contain children`)
			return
		}
		const objects = children.filter(
			(child): child is THREE.Object3D => child instanceof THREE.Object3D,
		)
		if (
			parent.children.length !== objects.length ||
			objects.some((child, index) => child !== parent.children[index])
		) {
			const wanted = new Set(objects)
			for (const child of [...parent.children])
				if (!wanted.has(child)) parent.remove(child)
			for (const child of objects) if (child.parent !== parent) parent.add(child)
			parent.children.splice(0, parent.children.length, ...objects)
		}
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
			const activeGeometries = activeChildren.filter(
				(child) => child instanceof THREE.BufferGeometry,
			)
			const activeMaterials = activeChildren.filter(
				(child) => child instanceof THREE.Material,
			)
			if (activeGeometries.length > 1 || activeMaterials.length > 1)
				throw new Error(
					`spa/three: each Mesh accepts one geometry and one material`,
				)
			const owned = meshDefaults.get(parent)
			let baseline = owned ?? borrowedMeshDefaults.get(parent)
			if (!baseline) {
				baseline = { geometry: parent.geometry, material: parent.material }
				borrowedMeshDefaults.set(parent, baseline)
			}
			// Retention owns outgoing resources without occupying incoming attachment slots.
			parent.geometry =
				activeGeometries[0] ??
				geometries.find((geometry) => geometry === parent.geometry) ??
				geometries.at(-1) ??
				baseline.geometry
			parent.material =
				activeMaterials[0] ??
				materials.find((material) => material === parent.material) ??
				materials.at(-1) ??
				baseline.material
			if (!owned && children.length === 0) borrowedMeshDefaults.delete(parent)
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
					if (owned.ownsGeometry) owned.geometry.dispose()
					if (owned.ownsMaterial) (owned.material as THREE.Material).dispose()
				}
			}
		} else node.dispose()
	},
})
function equalArgs(a: unknown[], b: unknown[] = []): boolean {
	return (
		a.length === b.length &&
		a.every(
			(value, index) =>
				Object.is(value, b[index]) ||
				(Array.isArray(value) &&
					Array.isArray(b[index]) &&
					equalArgs(value, b[index])),
		)
	)
}

export interface CanvasState {
	scene: THREE.Scene
	camera: THREE.Camera
	renderer: THREE.WebGLRenderer
}
export interface CanvasResizeState extends CanvasState {
	width: number
	height: number
	dpr: number
}
export interface CanvasProps {
	children?: Children
	width?: number
	height?: number
	camera?: THREE.Camera
	/** Constructor-time options. Canvas always supplies its own DOM canvas. */
	rendererOptions?: Omit<THREE.WebGLRendererParameters, `canvas`>
	/** The returned renderer belongs exclusively to Canvas and is disposed with it. */
	createRenderer?: (
		options: THREE.WebGLRendererParameters,
	) => THREE.WebGLRenderer
	/** A fixed ratio, or a device-pixel-ratio clamp. Defaults to 1. */
	dpr?: number | readonly [min: number, max: number]
	/** Runs after sizing and scene mounting, before the first draw. May return cleanup. */
	onCreated?: (state: CanvasState) => void | (() => void)
	/** Supplied cameras keep their projection; update it explicitly here if desired. */
	onResize?: (state: CanvasResizeState) => void
	onFrame?: (state: CanvasState & { delta: number; time: number }) => void
}
/** Browser-only scene boundary. The camera prop is borrowed and never disposed. */
export function Canvas(props: CanvasProps): SpaElement {
	let canvas: HTMLCanvasElement | null = null
	onMount(() => {
		const parameters: THREE.WebGLRendererParameters = {
			antialias: true,
			...props.rendererOptions,
			canvas: canvas!,
		}
		const webgl = props.createRenderer
			? props.createRenderer(parameters)
			: new THREE.WebGLRenderer(parameters)
		onCleanup(() => {
			webgl.dispose()
		})
		if (webgl.domElement !== canvas)
			throw new Error(`spa/three: renderer must use the supplied Canvas element`)
		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000)
		camera.position.z = 5
		const view = canvas.ownerDocument.defaultView!
		const size = () => ({
			width: props.width ?? 800,
			height: props.height ?? 600,
			dpr: props.dpr ?? 1,
			active: props.camera ?? camera,
		})
		const resize = ({ width, height, dpr, active }: ReturnType<typeof size>) => {
			const range = typeof dpr === `number` ? [dpr, dpr] : dpr
			if (
				![width, height, ...range].every(
					(value) => Number.isFinite(value) && value > 0,
				) ||
				range[0] > range[1]
			)
				throw new Error(
					`spa/three: dimensions and DPR must be positive with an ordered DPR range`,
				)
			const ratio = Math.max(
				range[0],
				Math.min(range[1], view.devicePixelRatio || 1),
			)
			webgl.setPixelRatio(ratio)
			webgl.setSize(width, height)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			props.onResize?.({
				scene,
				camera: active,
				renderer: webgl,
				width,
				height,
				dpr: ratio,
			})
		}
		bindScene(size, resize)
		const scope = owner!
		const resized = () => {
			try {
				resize(size())
			} catch (error) {
				reportScopeError(scope, error)
			}
		}
		view.addEventListener(`resize`, resized)
		onCleanup(() => {
			view.removeEventListener(`resize`, resized)
		})
		renderer.mount(() => props.children, scene)
		const events = createThreeEvents(
			canvas,
			scene,
			() => props.camera ?? camera,
			(error) => {
				reportScopeError(scope, error)
			},
		)
		onCleanup(() => {
			events.dispose()
		})
		// Scene mounting queues child refs and mount hooks; setup must follow them.
		onMount(() => {
			const cleanup = props.onCreated?.({
				scene,
				camera: props.camera ?? camera,
				renderer: webgl,
			})
			if (cleanup) onCleanup(cleanup)
			let last: number | undefined
			onSceneFrame((time) => {
				const active = props.camera ?? camera
				const delta = last === undefined ? 0 : (time - last) / 1000
				last = time
				if (isPresent(scope))
					props.onFrame?.({
						scene,
						camera: active,
						renderer: webgl,
						delta,
						time: time / 1000,
					})
				events.update()
				webgl.render(scene, active)
			}, true)
		})
	})
	return jsx(`canvas`, {
		ref: (element: HTMLCanvasElement | null) => {
			canvas = element
		},
	})
}
export const Group = sceneComponent<ObjectProps>(`Group`)
export const Mesh = sceneComponent<
	ObjectProps<THREE.Mesh> & {
		args?: ConstructorParameters<typeof THREE.Mesh>
	}
>(`Mesh`)
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
