import * as THREE from "three"

import type { FamilyConnection, GraphPosition } from "./ecology-graph.ts"

export interface EcologyLine {
	source: string
	from: GraphPosition
	to: GraphPosition
	color: string
	fromCard?: GraphPosition | undefined
	toCard?: GraphPosition | undefined
	traced: boolean
	fromCollapsed?: boolean | undefined
	toCollapsed?: boolean | undefined
}
export interface ProjectedEdge {
	d: string
	traced: boolean
	order: number
}
const segments = 16
function createLineBuffer(vertices: number): THREE.BufferGeometry {
	const geometry = new THREE.BufferGeometry()
	geometry.setAttribute(
		`position`,
		new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
			THREE.DynamicDrawUsage,
		),
	)
	geometry.setAttribute(
		`color`,
		new THREE.BufferAttribute(new Float32Array(vertices * 3), 3).setUsage(
			THREE.DynamicDrawUsage,
		),
	)
	geometry.setDrawRange(0, 0)
	return geometry
}
export function createFamilyBuffer(): THREE.BufferGeometry {
	return createLineBuffer(500 * 2)
}

/** A straight, arrowless spine joins only the painted nodes of an expanded family. */
export function writeFamilyBuffer(
	geometry: THREE.BufferGeometry,
	connections: readonly FamilyConnection[],
	worldScale: THREE.Vector3,
): void {
	const positions = geometry.getAttribute(`position`) as THREE.BufferAttribute
	const colors = geometry.getAttribute(`color`) as THREE.BufferAttribute
	const color = new THREE.Color()
	let cursor = 0
	for (const connection of connections) {
		color.setStyle(connection.color)
		for (const point of [connection.from, connection.to]) {
			positions.setXYZ(
				cursor,
				point.x * worldScale.x,
				point.y * worldScale.y,
				point.z * worldScale.z,
			)
			colors.setXYZ(cursor++, color.r, color.g, color.b)
		}
	}
	geometry.setDrawRange(0, cursor)
	for (const attribute of [positions, colors]) {
		attribute.clearUpdateRanges()
		if (cursor) attribute.addUpdateRange(0, cursor * 3)
		attribute.needsUpdate = true
	}
}

interface CachedEdge extends Pick<
	EcologyLine,
	`fromCard` | `toCard` | `fromCollapsed` | `toCollapsed`
> {
	path: ProjectedEdge
}
interface CachedPair {
	frame: number
	variants: CachedEdge[]
}
/** Reuse projected geometry while the camera and immutable captured endpoints stay unchanged. */
export function createEdgeProjector() {
	let transform = ``
	let sequence = 0
	const order = new WeakMap<GraphPosition, WeakMap<GraphPosition, number>>()
	const edgeOrder = (edge: EcologyLine) => {
		let targets = order.get(edge.from)
		if (!targets) order.set(edge.from, (targets = new WeakMap()))
		let index = targets.get(edge.to)
		if (index === undefined) targets.set(edge.to, (index = sequence++))
		return index
	}
	let frame = 0
	const previousPaths = new Map<GraphPosition, Map<GraphPosition, CachedPair>>()
	return function projectEdges(
		edges: readonly EcologyLine[],
		camera: THREE.PerspectiveCamera,
		width: number,
		height: number,
		worldScale: THREE.Vector3 = new THREE.Vector3(1, 1, 1),
	): Map<string, ProjectedEdge[]> {
		const nextTransform = [
			width,
			height,
			...worldScale.toArray(),
			...camera.matrixWorld.elements,
			...camera.projectionMatrix.elements,
		].join(`,`)
		if (transform !== nextTransform) previousPaths.clear()
		transform = nextTransform
		frame++
		const paths = new Map<string, ProjectedEdge[]>()
		const retain = (edge: EcologyLine, path: ProjectedEdge) => {
			let targets = previousPaths.get(edge.from)
			if (!targets) previousPaths.set(edge.from, (targets = new Map()))
			let pair = targets.get(edge.to)
			if (!pair) targets.set(edge.to, (pair = { frame, variants: [] }))
			pair.frame = frame
			const variants = pair.variants
			if (
				variants.length &&
				(variants[0].fromCard !== edge.fromCard ||
					variants[0].toCard !== edge.toCard)
			)
				variants.length = 0
			const variant = variants.findIndex(
				(candidate) =>
					candidate.fromCollapsed === edge.fromCollapsed &&
					candidate.toCollapsed === edge.toCollapsed,
			)
			if (variant < 0)
				variants.push({
					fromCard: edge.fromCard,
					toCard: edge.toCard,
					fromCollapsed: edge.fromCollapsed,
					toCollapsed: edge.toCollapsed,
					path,
				})
			else variants[variant].path = path
			let outgoing = paths.get(edge.source)
			if (!outgoing) paths.set(edge.source, (outgoing = []))
			outgoing.push(path)
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
		const view = (point: THREE.Vector3) =>
			point.clone().applyMatrix4(camera.matrixWorldInverse)
		const projected = new THREE.Vector3(),
			clipped = new THREE.Vector3()
		for (const edge of edges) {
			const cached = previousPaths
				.get(edge.from)
				?.get(edge.to)
				?.variants.find(
					(candidate) =>
						candidate.fromCard === edge.fromCard &&
						candidate.toCard === edge.toCard &&
						candidate.fromCollapsed === edge.fromCollapsed &&
						candidate.toCollapsed === edge.toCollapsed,
				)
			if (cached) {
				retain(
					edge,
					cached.path.traced === edge.traced
						? cached.path
						: { ...cached.path, traced: edge.traced },
				)
				continue
			}
			const a = project(edge.from),
				b = project(edge.to)
			const fromCard = edge.fromCard ? project(edge.fromCard) : a
			const toCard = edge.toCard ? project(edge.toCard) : b
			// CSS2D hides this source layer outside the camera depth range.
			if (
				fromCard.z < -1 ||
				fromCard.z > 1 ||
				![a.x, a.y, b.x, b.y].every(Number.isFinite)
			)
				continue
			const xy = (point: THREE.Vector3) => {
				projected.copy(point).applyMatrix4(camera.projectionMatrix)
				return `${(((projected.x - fromCard.x) * width) / 2).toFixed(2)},${((-(projected.y - fromCard.y) * height) / 2).toFixed(2)}`
			}
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
			// Camera transforms are affine: transform four control points once,
			// rather than transforming every sampled segment during an orbit.
			const curve = new THREE.CubicBezierCurve3(
				view(start),
				view(controlA),
				view(controlB),
				view(end),
			)
			let d = ``,
				connected = false
			const segment = (viewFrom: THREE.Vector3, viewTo: THREE.Vector3) => {
				const dz = viewTo.z - viewFrom.z
				const first = dz
					? Math.min(
							(-camera.near - viewFrom.z) / dz,
							(-camera.far - viewFrom.z) / dz,
						)
					: -Infinity
				const last = dz
					? Math.max(
							(-camera.near - viewFrom.z) / dz,
							(-camera.far - viewFrom.z) / dz,
						)
					: Infinity
				const low = Math.max(0, first),
					high = Math.min(1, last)
				if (
					low > high ||
					(!dz && (viewFrom.z > -camera.near || viewFrom.z < -camera.far))
				) {
					connected = false
					return
				}
				if (!connected || low > 0)
					d += `M${xy(clipped.copy(viewFrom).lerp(viewTo, low))}`
				d += `L${xy(clipped.copy(viewFrom).lerp(viewTo, high))}`
				connected = high === 1
			}
			const previous = curve.v0.clone(),
				sample = new THREE.Vector3()
			for (let step = 1; step <= segments; step++) {
				curve.getPoint(step / segments, sample)
				segment(previous, sample)
				previous.copy(sample)
			}
			const tangent = end.clone().sub(controlB).normalize()
			const depth = Math.abs(
				end.clone().applyMatrix4(camera.matrixWorldInverse).z,
			)
			const pixel =
				(2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / height
			const side = new THREE.Vector3()
				.crossVectors(tangent, camera.getWorldDirection(new THREE.Vector3()))
				.normalize()
			const back = end.clone().addScaledVector(tangent, -7 * pixel)
			connected = false
			const tip = view(end)
			segment(view(back.clone().addScaledVector(side, 3 * pixel)), tip)
			segment(tip, view(back.addScaledVector(side, -3 * pixel)))
			if (!d) continue
			retain(edge, { d, traced: edge.traced, order: edgeOrder(edge) })
		}
		// Tracing prioritizes admission, but must not shuffle unchanged SVG path slots.
		for (const outgoing of paths.values())
			outgoing.sort((a, b) => a.order - b.order)
		for (const [from, targets] of previousPaths) {
			for (const [to, pair] of targets)
				if (pair.frame !== frame) targets.delete(to)
			if (!targets.size) previousPaths.delete(from)
		}
		return paths
	}
}
