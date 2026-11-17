import * as THREE from "three"

import type { GraphPosition } from "./ecology-graph.ts"

export interface EcologyLine {
	from: GraphPosition
	to: GraphPosition
	traced: boolean
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
	worldScale = new THREE.Vector3(1, 1, 1),
): void {
	const attribute = geometry.getAttribute(`position`) as THREE.BufferAttribute
	let cursor = 0
	const put = (point: THREE.Vector3) => {
		attribute.setXYZ(cursor++, point.x, point.y, point.z)
	}
	const port = (point: THREE.Vector3, dx: number, dy: number) => {
		const scale = 1 / Math.max(Math.abs(dx) / 91, Math.abs(dy) / 29)
		return point
			.clone()
			.add(
				new THREE.Vector3(
					(dx * scale * 2) / width,
					(dy * scale * 2) / height,
					0,
				),
			)
			.unproject(camera)
	}
	const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
	const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
	for (const edge of edges) {
		if (edge.traced !== traced) continue
		const a = new THREE.Vector3(edge.from.x, edge.from.y, edge.from.z)
			.multiply(worldScale)
			.project(camera)
		const b = new THREE.Vector3(edge.to.x, edge.to.y, edge.to.z)
			.multiply(worldScale)
			.project(camera)
		let dx = ((b.x - a.x) * width) / 2,
			dy = ((b.y - a.y) * height) / 2
		const loop = Math.hypot(dx, dy) < 1
		if (loop) {
			dx = 150
			dy = 0
		}
		const horizontal = Math.abs(dx) >= Math.abs(dy)
		if (horizontal) dy = 0
		else dx = 0
		const start = port(a, dx, dy),
			end = port(b, -dx, -dy)
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
}
