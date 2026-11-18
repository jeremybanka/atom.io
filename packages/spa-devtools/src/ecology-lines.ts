import * as THREE from "three"

import type { GraphPosition } from "./ecology-graph.ts"

export interface EcologyLine {
	from: GraphPosition
	to: GraphPosition
	color: string
	fromCard?: GraphPosition | undefined
	toCard?: GraphPosition | undefined
	traced: boolean
	fromCollapsed?: boolean
	toCollapsed?: boolean
}
const segments = 16
const verticesPerEdge = segments * 2 + 4
export function createEdgeBuffer(): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute(
		`position`,
		new THREE.BufferAttribute(
			new Float32Array(1_000 * verticesPerEdge * 3),
			3,
		).setUsage(THREE.DynamicDrawUsage),
	)
	geometry.setAttribute(
		`color`,
		new THREE.BufferAttribute(
			new Float32Array(1_000 * verticesPerEdge * 3),
			3,
		).setUsage(THREE.DynamicDrawUsage),
	)
	geometry.setDrawRange(0, 0)
	return geometry
}

/** Clip each endpoint to its billboard's screen-space port, then curve through world space. */
export function writeEdgeBuffer(
	geometry: THREE.BufferGeometry,
	edges: readonly EcologyLine[],
	traced: boolean,
	camera: THREE.PerspectiveCamera,
	width: number,
	height: number,
	worldScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1),
): void {
	const attribute = geometry.getAttribute(`position`) as THREE.BufferAttribute
	const colors = geometry.getAttribute(`color`) as THREE.BufferAttribute
	const color = new THREE.Color()
	let cursor = 0
	const put = (point: THREE.Vector3) => {
		colors.setXYZ(cursor, color.r, color.g, color.b)
		attribute.setXYZ(cursor++, point.x, point.y, point.z)
	}
	const port = (
		point: THREE.Vector3,
		center: THREE.Vector3,
		dx: number,
		dy: number,
		collapsed = false,
	) => {
		const halfWidth = collapsed ? 43 : 91,
			halfHeight = collapsed ? 15 : 29
		const scale =
			1 / Math.max(Math.abs(dx) / halfWidth, Math.abs(dy) / halfHeight)
		const x = dx
			? dx * scale
			: THREE.MathUtils.clamp(
					((point.x - center.x) * width) / 2,
					6 - halfWidth,
					halfWidth - 6,
				)
		const y = dy
			? dy * scale
			: THREE.MathUtils.clamp(
					((point.y - center.y) * height) / 2,
					6 - halfHeight,
					halfHeight - 6,
				)
		return new THREE.Vector3(
			center.x + (x * 2) / width,
			center.y + (y * 2) / height,
			point.z,
		).unproject(camera)
	}
	const project = (point: GraphPosition) =>
		new THREE.Vector3(point.x, point.y, point.z)
			.multiply(worldScale)
			.project(camera)
	const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
	const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
	for (const edge of edges) {
		if (edge.traced !== traced) continue
		// The same source color is exposed as --ecology-color on the SPA card.
		color.setStyle(edge.color)
		const a = project(edge.from),
			b = project(edge.to)
		const fromCard = edge.fromCard ? project(edge.fromCard) : a
		const toCard = edge.toCard ? project(edge.toCard) : b
		let dx = ((toCard.x - fromCard.x) * width) / 2,
			dy = ((toCard.y - fromCard.y) * height) / 2
		const loop = Math.hypot(dx, dy) < 1
		if (loop) {
			dx = 150
			dy = 0
		}
		const horizontal = Math.abs(dx) >= Math.abs(dy)
		if (horizontal) dy = 0
		else dx = 0
		const start = port(a, fromCard, dx, dy, edge.fromCollapsed),
			end = port(b, toCard, -dx, -dy, edge.toCollapsed)
		const direction = right
			.clone()
			.multiplyScalar(dx)
			.addScaledVector(up, dy)
			.normalize()
		const bend = Math.max(2, start.distanceTo(end) * 0.35)
		const controlA = start.clone().addScaledVector(direction, bend)
		const controlB = end.clone().addScaledVector(direction, -bend)
		if (loop) {
			controlA.addScaledVector(up, 6)
			controlB.addScaledVector(up, 6)
		}
		const curve = new THREE.CubicBezierCurve3(start, controlA, controlB, end)
		let previous = start
		for (let step = 1; step <= segments; step++) {
			const next = curve.getPoint(step / segments)
			put(previous)
			put(next)
			previous = next
		}
		const tangent = end.clone().sub(controlB).normalize()
		const depth = Math.abs(end.clone().applyMatrix4(camera.matrixWorldInverse).z)
		const pixel =
			(2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
		const side = new THREE.Vector3()
			.crossVectors(tangent, camera.getWorldDirection(new THREE.Vector3()))
			.normalize()
		const back = end.clone().addScaledVector(tangent, -7 * pixel)
		put(back.clone().addScaledVector(side, 3 * pixel))
		put(end)
		put(back.addScaledVector(side, -3 * pixel))
		put(end)
	}
	geometry.setDrawRange(0, cursor)
	attribute.clearUpdateRanges()
	if (cursor) attribute.addUpdateRange(0, cursor * 3)
	attribute.needsUpdate = true
	colors.clearUpdateRanges()
	if (cursor) colors.addUpdateRange(0, cursor * 3)
	colors.needsUpdate = true
}
