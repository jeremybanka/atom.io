/** @jsxImportSource @atom.io/spa */
import type * as THREE from "three"

import {
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
	DZ2_ORBITAL_LIGHTS,
	DZ2_ORBITAL_Y_ROTATION_RADIANS_PER_SECOND,
} from "./brand-model.ts"
import css from "./BrandMarkScene.module.css"
import type { SpaElement } from "./core.ts"
import { onCleanup, onMount } from "./core.ts"
import { AmbientLight, Canvas, Group, Mesh, PointLight } from "./three.ts"

const canvas = { Canvas }
export function BrandMarkScene(props: {
	variant: `mark` | `splash`
	width: number
	height: number
	view: Window
	onReady(): void
	onError(error: unknown): void
}): SpaElement {
	const view = props.view
	const camera = createDz2OrbitalCamera()
	const model = createDz2OrbitalModel()
	const mark = () => props.variant === `mark`
	const narrow = () => view.innerWidth < 680
	let orbital: THREE.Object3D | null = null
	let dirty = true
	const preference = view.matchMedia(`(prefers-reduced-motion: reduce)`)
	const invalidate = () => {
		dirty = true
	}
	onMount(() => {
		preference.addEventListener(`change`, invalidate)
		view.document.addEventListener(`visibilitychange`, invalidate)
		onCleanup(() => {
			preference.removeEventListener(`change`, invalidate)
			view.document.removeEventListener(`visibilitychange`, invalidate)
		})
	})
	onCleanup(() => {
		disposeDz2OrbitalModel(model)
	})
	return (
		<brand-mark-scene class={css[`class`]}>
			<canvas.Canvas
				camera={camera}
				width={props.width}
				height={props.height}
				dpr={Math.min(
					view.devicePixelRatio || 1,
					mark() ? 2 : 1.35,
					mark()
						? Infinity
						: Math.sqrt(16_000_000 / (props.width * props.height)),
				)}
				rendererOptions={{
					alpha: true,
					antialias: true,
					powerPreference: mark() ? `low-power` : `high-performance`,
				}}
				onError={props.onError}
				onCreated={({ scene, renderer }) => {
					renderer.render(scene, camera)
					props.onReady()
				}}
				onResize={({ width, height }) => {
					camera.aspect = width / height
					camera.updateProjectionMatrix()
					invalidate()
				}}
				renderWhen={() =>
					!view.document.hidden && (dirty || !preference.matches)
				}
				onFrame={({ delta }) => {
					if (view.document.hidden) return
					if (!preference.matches)
						orbital!.rotation.y +=
							Math.min(delta, 0.1) * DZ2_ORBITAL_Y_ROTATION_RADIANS_PER_SECOND
					dirty = false
				}}
			>
				<AmbientLight
					color={DZ2_ORBITAL_LIGHTS.ambient.color}
					intensity={DZ2_ORBITAL_LIGHTS.ambient.intensity}
				/>
				<PointLight
					color={DZ2_ORBITAL_LIGHTS.core.color}
					intensity={DZ2_ORBITAL_LIGHTS.core.intensity}
					distance={DZ2_ORBITAL_LIGHTS.core.distance}
					position={DZ2_ORBITAL_LIGHTS.core.position}
				/>
				<Group
					scale={mark() ? 1.25 : narrow() ? 0.52 : 0.72}
					position={[0, !mark() && narrow() ? -0.08 : 0, 0]}
					ref={(node) => {
						orbital = node
						if (node) node.rotation.copy(model.orbital.rotation)
					}}
				>
					{model.meshes.map((mesh, index) => (
						<Mesh
							key={index}
							args={[mesh.geometry, mesh.material]}
							position={mesh.position.toArray()}
							rotation={[mesh.rotation.x, mesh.rotation.y, mesh.rotation.z]}
						/>
					))}
				</Group>
			</canvas.Canvas>
		</brand-mark-scene>
	)
}
