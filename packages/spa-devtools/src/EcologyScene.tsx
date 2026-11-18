/** @jsxImportSource @atom.io/spa */
import { onCleanup, onMount, type SpaElement } from "@atom.io/spa"
import { bindScene } from "@atom.io/spa/renderer"
import { Canvas, LineSegments } from "@atom.io/spa/three"
import * as THREE from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { OrbitControls } from "three/addons/controls/OrbitControls.js"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { CSS2DRenderer } from "three/addons/renderers/CSS2DRenderer.js"

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
	cylinderHeight: number
	slots: number
	generation: number
	card(index: number): GraphItem
	visible(index: number): boolean
	items: GraphItem[]
	edges: EcologyLine[]
	selected?: string | undefined
	selectedIds?: ReadonlySet<string> | undefined
	traced: Set<string>
	focused?: ReadonlySet<string> | undefined
	matches?: ReadonlySet<string> | undefined
	command: CameraCommand
}): SpaElement {
	const [size, setSize] = useLocal(props.tools.store, {
		width: 640,
		height: 400,
	})
	const [failed, setFailed] = useLocal(props.tools.store, false)
	const labels = new THREE.Scene()
	const scale = labels.scale
	const cylinder = () => {
		const ratio = Math.sqrt(size().width / size().height)
		return { diameter: 16 * ratio, height: 16 / ratio }
	}
	const point = (item: GraphItem) =>
		new THREE.Vector3(item.x, item.y, item.z).multiply(scale)
	const highlighted = (item: GraphItem) => {
		const keys = props.traced,
			source = item.source
		return `memberKeys` in source
			? source.memberKeys.some((key) => keys.has(key))
			: keys.has(item.key)
	}
	const dimmed = (item: GraphItem) => {
		const focused = props.focused
		return focused !== undefined && !focused.has(item.id)
	}
	const selected = (item: GraphItem) =>
		props.selected === item.id || (props.selectedIds?.has(item.id) ?? false)
	const collapsed = (item: GraphItem) => {
		const matches = props.matches
		return matches !== undefined && !matches.has(item.id)
	}
	const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000)
	const normal = createEdgeBuffer(),
		traced = createEdgeBuffer()
	const normalMaterial = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.14,
		depthWrite: false,
	})
	const traceMaterial = new THREE.LineBasicMaterial({
		vertexColors: true,
		transparent: true,
		opacity: 0.9,
		depthWrite: false,
		depthTest: false,
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
				aspect: camera.aspect,
			}
		}
	}
	const fit = (overview = true) => {
		if (!props.items.length) return
		const box = new THREE.Box3().setFromPoints(props.items.map(point))
		const center = box.getCenter(new THREE.Vector3())
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
		// Fit the actual projected cylinder points, including perspective depth and DOM card margins.
		for (const item of props.items) {
			const offset = point(item).sub(center)
			distance = Math.max(
				distance,
				offset.dot(direction) + Math.abs(offset.dot(right)) / horizontal,
				offset.dot(direction) + Math.abs(offset.dot(up)) / vertical,
			)
		}
		if (!overview && distance > 90) center.copy(point(props.items[0]))
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
				const targetPoint = point(item)
				const direction = camera.position
					.clone()
					.sub(controls.target)
					.normalize()
				camera.position
					.copy(targetPoint)
					.addScaledVector(
						direction,
						Math.min(45, camera.position.distanceTo(controls.target)),
					)
				controls.target.copy(targetPoint)
			}
		}
		controls.update()
		invalidate()
	}
	const retarget = (previousAspect: number, aspect: number) => {
		if (previousAspect === aspect) return
		const ratio = Math.sqrt(aspect / previousAspect)
		const offset = camera.position.clone().sub(controls!.target)
		controls!.target.multiply(new THREE.Vector3(ratio, 1 / ratio, ratio))
		camera.position.copy(controls!.target).addScaledVector(offset, 1 / ratio)
	}
	const reshape = (width: number, height: number) => {
		const aspect = width / height
		if (controls) retarget(camera.aspect, aspect)
		const dimensions = cylinder()
		scale.set(
			dimensions.diameter / 16,
			dimensions.height / props.cylinderHeight,
			dimensions.diameter / 16,
		)
		camera.aspect = aspect
		camera.updateProjectionMatrix()
		renderer?.setSize(width, height)
		controls?.update()
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
		bindScene(() => props.matches, invalidate)
		bindScene(
			() => props.cylinderHeight,
			() => {
				reshape(size().width, size().height)
			},
		)
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
			scale,
		)
		writeEdgeBuffer(
			traced,
			props.edges,
			true,
			camera,
			size().width,
			size().height,
			scale,
		)
		viewport!.dataset[`camera`] = [
			...camera.position.toArray(),
			...controls!.target.toArray(),
		].join(`,`)
		viewport!.dataset[`edges`] = String(props.edges.length)
		props.context.camera = {
			position: camera.position.toArray(),
			target: controls!.target.toArray(),
			aspect: camera.aspect,
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
			data-unavailable={failed()}
			data-cylinder={`${cylinder().diameter},${cylinder().height}`}
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
						reshape(width, height)
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
							const saved = props.context.camera
							camera.position.fromArray(saved.position)
							controls.target.fromArray(saved.target)
							retarget(saved.aspect ?? camera.aspect, camera.aspect)
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
					<LineSegments
						args={[traced, traceMaterial]}
						frustumCulled={false}
						ref={(line) => {
							if (line) line.renderOrder = 1
						}}
					/>
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
						collapsed={collapsed(props.card(index))}
						selected={selected(props.card(index))}
						dimmed={dimmed(props.card(index))}
						traced={highlighted(props.card(index))}
						scene={labels}
						invalidate={invalidate}
					/>
				))}
			</ecology-labels>
			{failed() && (
				<p role="status">
					3D view unavailable. Use the ecology editor to inspect and search
					captured state.
				</p>
			)}
		</ecology-scene>
	)
}
