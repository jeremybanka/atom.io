/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement, useId } from "@atom.io/spa"
import { bindScene } from "@atom.io/spa/renderer"
import { Canvas, LineSegments } from "@atom.io/spa/three"
import * as THREE from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"

import type { EcologyFamily } from "./ecology.ts"
import type { GraphContext, GraphItem } from "./ecology-graph.ts"
import {
	createEdgeBuffer,
	type EcologyLine,
	writeEdgeBuffer,
} from "./ecology-lines.ts"
import { EcologyNodeCard } from "./EcologyNodeCard.tsx"
import css from "./EcologyScene.module.css"
import { type Tools, useLocal } from "./store.ts"

const canvas = { Canvas }

export interface CameraCommand {
	sequence: number
	action: string
	target?: string
}
export function EcologyScene(props: {
	tools: Tools
	context: GraphContext
	slots: number
	generation: number
	card(index: number): GraphItem
	visible(index: number): boolean
	items: GraphItem[]
	edges: EcologyLine[]
	selected?: string | undefined
	traced: Set<string>
	focused?: ReadonlySet<string> | undefined
	command: CameraCommand
}): SpaElement {
	const id = `ecology-controls-${useId()}`
	const [size, setSize] = useLocal(props.tools.store, {
		width: 640,
		height: 400,
	})
	const [failed, setFailed] = useLocal(props.tools.store, false)
	const labels = new THREE.Scene()
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000)
	const normal = createEdgeBuffer(),
		traced = createEdgeBuffer()
	const normalMaterial = new THREE.LineBasicMaterial({
		color: 0x8298b0,
		transparent: true,
		opacity: 0.14,
		depthWrite: false,
	})
	const traceMaterial = new THREE.LineBasicMaterial({
		color: 0x4c9cdb,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
	})
	camera.position.set(23, 7, 28)
	let viewport: HTMLElement | null = null,
		layer: HTMLElement | null = null
	let controls: OrbitControls | undefined, renderer: CSS2DRenderer | undefined
	let dirty = true
	const invalidate = () => {
		dirty = true
		if (controls && viewport) {
			viewport.dataset[`camera`] = [
				...camera.position.toArray(),
				...controls.target.toArray(),
			].join(`,`)
			props.context.camera = {
				position: camera.position.toArray(),
				target: controls.target.toArray(),
			}
		}
	}
	const fit = (overview = true) => {
		if (!props.items.length) return
		const box = new THREE.Box3().setFromPoints(
			props.items.map((item) => new THREE.Vector3(item.x, item.y, item.z)),
		)
		const center = box.getCenter(new THREE.Vector3()),
			extent = box.getSize(new THREE.Vector3())
		const direction = camera.position.clone().sub(controls!.target).normalize()
		const right = new THREE.Vector3()
			.crossVectors(camera.up, direction)
			.normalize()
		const up = new THREE.Vector3().crossVectors(direction, right)
		const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
		const horizontal =
			tangent * camera.aspect * Math.max(0.2, 1 - 192 / size().width)
		const vertical = tangent * Math.max(0.2, 1 - 100 / size().height)
		let distance = 18
		// Include perspective depth and fixed-size DOM card margins in every view orientation.
		for (const x of [-1, 1])
			for (const y of [-1, 1])
				for (const z of [-1, 1]) {
					const corner = new THREE.Vector3(
						(x * extent.x) / 2,
						(y * extent.y) / 2,
						(z * extent.z) / 2,
					)
					distance = Math.max(
						distance,
						corner.dot(direction) + Math.abs(corner.dot(right)) / horizontal,
						corner.dot(direction) + Math.abs(corner.dot(up)) / vertical,
					)
				}
		if (!overview && distance > 90)
			center.set(props.items[0].x, props.items[0].y, props.items[0].z)
		controls!.target.copy(center)
		camera.position
			.copy(center)
			.addScaledVector(direction, overview ? distance : Math.min(distance, 90))
		controls!.update()
	}
	const pan = (x: number, y: number) => {
		camera.updateMatrixWorld()
		const pixel =
			(2 *
				camera.position.distanceTo(controls!.target) *
				Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
			size().height
		const offset = new THREE.Vector3()
			.setFromMatrixColumn(camera.matrixWorld, 0)
			.multiplyScalar(x * pixel)
			.addScaledVector(
				new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1),
				-y * pixel,
			)
		camera.position.add(offset)
		controls!.target.add(offset)
	}
	const command = ({ action, target }: CameraCommand) => {
		if (!controls) return
		if (action === `reset`) {
			camera.position.set(23, 7, 28)
			controls.target.set(0, 0, 0)
			fit(false)
		}
		if (action === `fit`) fit()
		if (action === `left`) pan(-80, 0)
		if (action === `right`) pan(80, 0)
		if (action === `up`) pan(0, -80)
		if (action === `down`) pan(0, 80)
		if (action === `in`) controls.dollyIn(1.25)
		if (action === `out`) controls.dollyOut(1.25)
		if (action === `focus`) {
			const item = props.items.find((candidate) => candidate.id === target)
			if (item) {
				const point = new THREE.Vector3(item.x, item.y, item.z)
				const direction = camera.position
					.clone()
					.sub(controls.target)
					.normalize()
				camera.position
					.copy(point)
					.addScaledVector(
						direction,
						Math.min(45, camera.position.distanceTo(controls.target)),
					)
				controls.target.copy(point)
			}
		}
		controls.update()
		invalidate()
	}
	onMount(() => {
		const resize = () => {
			const { width, height } = viewport!.getBoundingClientRect()
			if (width > 0 && height > 0) setSize({ width, height })
		}
		const observer = new ResizeObserver(resize)
		observer.observe(viewport!)
		resize()
		bindScene(() => props.command, command)
		bindScene(() => props.edges, invalidate)
		bindScene(() => props.items, invalidate)
		onCleanup(() => {
			observer.disconnect()
			normal.dispose()
			traced.dispose()
			normalMaterial.dispose()
			traceMaterial.dispose()
		})
	})
	const draw = () => {
		if (!dirty) return
		dirty = false
		camera.updateMatrixWorld()
		renderer!.render(labels, camera)
		writeEdgeBuffer(
			normal,
			props.edges,
			false,
			camera,
			size().width,
			size().height,
		)
		writeEdgeBuffer(
			traced,
			props.edges,
			true,
			camera,
			size().width,
			size().height,
		)
		viewport!.dataset[`camera`] = [
			...camera.position.toArray(),
			...controls!.target.toArray(),
		].join(`,`)
		viewport!.dataset[`edges`] = String(props.edges.length)
		props.context.camera = {
			position: camera.position.toArray(),
			target: controls!.target.toArray(),
		}
	}
	return (
		<ecology-scene
			class={css.class}
			ref={(node) => {
				viewport = node
			}}
			tabIndex={0}
			role="group"
			aria-label="Observed dependency graph"
			aria-describedby={id}
			data-unavailable={failed()}
		>
			{/* Start with the first populated capture; retain the renderer across subsequent empty filters and captures. */}
			{(props.slots > 0 || controls !== undefined) && !failed() && (
				<canvas.Canvas
					camera={camera}
					width={size().width}
					height={size().height}
					dpr={[1, 2]}
					rendererOptions={{ alpha: true }}
					onError={() => {
						setFailed(true)
					}}
					onResize={({ width, height }) => {
						camera.aspect = width / height
						camera.updateProjectionMatrix()
						renderer?.setSize(width, height)
						invalidate()
					}}
					onCreated={() => {
						renderer = new CSS2DRenderer({ element: layer! })
						renderer.setSize(size().width, size().height)
						controls = new OrbitControls(camera, viewport)
						controls.minDistance = 4
						controls.maxDistance = 50_000
						controls.listenToKeyEvents(viewport!)
						controls.addEventListener(`change`, invalidate)
						if (props.context.camera) {
							camera.position.fromArray(props.context.camera.position)
							controls.target.fromArray(props.context.camera.target)
							controls.update()
						} else fit(false)
						if (props.command.sequence > 0) command(props.command)
						invalidate()
						return () => {
							controls!.dispose()
							renderer = undefined
							controls = undefined
						}
					}}
					renderWhen={() => dirty}
					onFrame={draw}
				>
					<LineSegments args={[normal, normalMaterial]} frustumCulled={false} />
					<LineSegments args={[traced, traceMaterial]} frustumCulled={false} />
				</canvas.Canvas>
			)}
			<ecology-labels
				ref={(node) => {
					layer = node
				}}
				hidden={failed()}
			>
				{Array.from({ length: props.slots }, (_, index) => (
					<EcologyNodeCard
						key={`${props.generation}:${index}`}
						item={props.card(index)}
						visible={props.visible(index)}
						selected={props.selected === props.card(index).id}
						dimmed={
							props.focused !== undefined &&
							!props.focused.has(props.card(index).id)
						}
						traced={
							props.card(index).kind === `family`
								? `memberKeys` in props.card(index).source &&
									(props.card(index).source as EcologyFamily).memberKeys.some(
										(key) => props.traced.has(key),
									)
								: props.traced.has(props.card(index).key)
						}
						scene={labels}
						invalidate={invalidate}
					/>
				))}
			</ecology-labels>
			<p id={id}>
				{failed()
					? `3D view unavailable. Use the accessible node list below to inspect and search captured state.`
					: `Drag to orbit · right-drag to pan · scroll to zoom · touch: one finger orbit, two fingers pan / pinch zoom`}
			</p>
		</ecology-scene>
	)
}
