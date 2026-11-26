import * as THREE from "three"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { LineMaterial } from "three/addons/lines/LineMaterial.js"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { LineSegments2 } from "three/addons/lines/LineSegments2.js"
// eslint-disable-next-line import/extensions -- Three addon exports require the .js suffix.
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js"

import type {
	FamilyConnection,
	GraphPosition,
	OperationRelation,
} from "./ecology-graph.ts"
import type { EdgeRoutingMotion } from "./ecology-motion.ts"

export interface EcologyLine {
	id: string
	source: string
	from: GraphPosition
	to: GraphPosition
	color: string
	fromCard?: GraphPosition | undefined
	toCard?: GraphPosition | undefined
	origin?: GraphPosition | undefined
	traced: boolean
	relation?: OperationRelation | undefined
	fromCollapsed?: boolean | undefined
	toCollapsed?: boolean | undefined
	fromHistory?: boolean | undefined
	toHistory?: boolean | undefined
}
export interface ProjectedEdge {
	d: string
	traced: boolean
	order: number
	relation?: OperationRelation | undefined
}
const segments = 16
const cardinals = [
	[1, 0],
	[0, 1],
	[-1, 0],
	[0, -1],
] as const
export function createFamilySpine(
	width: number,
	opacity: number,
): LineSegments2 {
	const geometry = new LineSegmentsGeometry()
	geometry.setPositions(new Float32Array(500 * 6))
	geometry.setColors(new Float32Array(500 * 6))
	for (const name of [`instanceStart`, `instanceColorStart`]) {
		const { data } = geometry.getAttribute(
			name,
		) as THREE.InterleavedBufferAttribute
		data.setUsage(THREE.DynamicDrawUsage)
	}
	geometry.instanceCount = 0
	const material = new LineMaterial({
		linewidth: width,
		vertexColors: true,
		transparent: true,
		opacity,
		depthWrite: false,
		alphaToCoverage: true,
	})
	const spine = new LineSegments2(geometry, material)
	spine.frustumCulled = false
	spine.visible = false
	// Membership is decorative. Only the cards participate in pointer interactions.
	spine.raycast = () => {}
	return spine
}

/** A straight, arrowless spine joins only the painted nodes of an expanded family. */
export function writeFamilySpine(
	spine: LineSegments2,
	connections: readonly FamilyConnection[],
	worldScale: THREE.Vector3,
): void {
	const { geometry } = spine
	const attribute = (name: string) =>
		geometry.getAttribute(name) as THREE.InterleavedBufferAttribute
	const start = attribute(`instanceStart`)
	const end = attribute(`instanceEnd`)
	const startColor = attribute(`instanceColorStart`)
	const endColor = attribute(`instanceColorEnd`)
	const color = new THREE.Color()
	for (let index = 0; index < connections.length; index++) {
		const { from, to, color: hue } = connections[index]
		color.setStyle(hue)
		start.setXYZ(
			index,
			from.x * worldScale.x,
			from.y * worldScale.y,
			from.z * worldScale.z,
		)
		end.setXYZ(
			index,
			to.x * worldScale.x,
			to.y * worldScale.y,
			to.z * worldScale.z,
		)
		startColor.setXYZ(index, color.r, color.g, color.b)
		endColor.setXYZ(index, color.r, color.g, color.b)
	}
	geometry.instanceCount = connections.length
	spine.visible = connections.length > 0
	for (const { data } of [start, startColor]) {
		data.clearUpdateRanges()
		if (connections.length) {
			data.addUpdateRange(0, connections.length * 6)
			data.needsUpdate = true
		}
	}
}

interface CachedEdge extends Pick<
	EcologyLine,
	| `fromCard`
	| `toCard`
	| `origin`
	| `fromCollapsed`
	| `toCollapsed`
	| `fromHistory`
	| `toHistory`
	| `relation`
> {
	path: ProjectedEdge
	angle: number | undefined
}
interface CachedPair {
	frame: number
	variants: CachedEdge[]
}
/** Reuse projected geometry while camera, endpoints, and routing stay unchanged. */
export function createEdgeProjector(routing?: EdgeRoutingMotion) {
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
		const retain = (
			edge: EcologyLine,
			path: ProjectedEdge,
			angle: number | undefined,
		) => {
			let targets = previousPaths.get(edge.from)
			if (!targets) previousPaths.set(edge.from, (targets = new Map()))
			let pair = targets.get(edge.to)
			if (!pair) targets.set(edge.to, (pair = { frame, variants: [] }))
			pair.frame = frame
			const variants = pair.variants
			if (
				variants.length &&
				(variants[0].fromCard !== edge.fromCard ||
					variants[0].toCard !== edge.toCard ||
					variants[0].origin !== edge.origin)
			)
				variants.length = 0
			const variant = variants.findIndex(
				(candidate) =>
					candidate.fromCollapsed === edge.fromCollapsed &&
					candidate.toCollapsed === edge.toCollapsed &&
					candidate.fromHistory === edge.fromHistory &&
					candidate.toHistory === edge.toHistory &&
					candidate.relation === edge.relation,
			)
			if (variant < 0)
				variants.push({
					fromCard: edge.fromCard,
					toCard: edge.toCard,
					origin: edge.origin,
					fromCollapsed: edge.fromCollapsed,
					toCollapsed: edge.toCollapsed,
					fromHistory: edge.fromHistory,
					toHistory: edge.toHistory,
					relation: edge.relation,
					path,
					angle,
				})
			else {
				variants[variant].path = path
				variants[variant].angle = angle
			}
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
			history = false,
		) => {
			const halfWidth = collapsed ? 43 : history ? 79 : 91,
				halfHeight = collapsed ? 15 : history ? 22 : 29
			const x = THREE.MathUtils.clamp(
				((point.x - center.x) * width) / 2,
				6 - halfWidth,
				halfWidth - 6,
			)
			const y = THREE.MathUtils.clamp(
				((point.y - center.y) * height) / 2,
				6 - halfHeight,
				halfHeight - 6,
			)
			// Intersect the card rim so moving ports keep their family lane offsets
			// and never detach or cut across the face of the card.
			const distance = Math.min(
				(halfWidth - x * Math.sign(dx)) / Math.abs(dx),
				(halfHeight - y * Math.sign(dy)) / Math.abs(dy),
			)
			return new THREE.Vector3(
				center.x + ((x + dx * distance) * 2) / width,
				center.y + ((y + dy * distance) * 2) / height,
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
			const previousAngle = routing?.angle(edge.id)
			const cached = previousPaths
				.get(edge.from)
				?.get(edge.to)
				?.variants.find(
					(candidate) =>
						candidate.angle === previousAngle &&
						candidate.fromCard === edge.fromCard &&
						candidate.toCard === edge.toCard &&
						candidate.origin === edge.origin &&
						candidate.fromCollapsed === edge.fromCollapsed &&
						candidate.toCollapsed === edge.toCollapsed &&
						candidate.fromHistory === edge.fromHistory &&
						candidate.toHistory === edge.toHistory &&
						candidate.relation === edge.relation,
				)
			if (cached) {
				retain(
					edge,
					cached.path.traced === edge.traced
						? cached.path
						: { ...cached.path, traced: edge.traced },
					previousAngle,
				)
				continue
			}
			const a = project(edge.from),
				b = project(edge.to)
			const fromCard = edge.fromCard ? project(edge.fromCard) : a
			const toCard = edge.toCard ? project(edge.toCard) : b
			const origin = edge.origin ? project(edge.origin) : fromCard
			// CSS2D hides this source layer outside the camera depth range.
			if (
				origin.z < -1 ||
				origin.z > 1 ||
				![a.x, a.y, b.x, b.y].every(Number.isFinite)
			)
				continue
			const xy = (point: THREE.Vector3) => {
				projected.copy(point).applyMatrix4(camera.projectionMatrix)
				return `${(((projected.x - origin.x) * width) / 2).toFixed(2)},${((-(projected.y - origin.y) * height) / 2).toFixed(2)}`
			}
			const horizontal = ((toCard.x - fromCard.x) * width) / 2,
				vertical = ((toCard.y - fromCard.y) * height) / 2
			const separation = Math.hypot(horizontal, vertical)
			const heading =
				separation < 1
					? 0
					: Math.abs(horizontal) >= Math.abs(vertical)
						? horizontal >= 0
							? 0
							: 2
						: vertical >= 0
							? 1
							: 3
			const angle = routing?.steer(edge.id, heading)
			const turn = angle ?? heading
			const [dx, dy] = Number.isInteger(turn)
				? cardinals[((turn % 4) + 4) % 4]
				: [Math.cos((turn * Math.PI) / 2), Math.sin((turn * Math.PI) / 2)]
			const start = port(
					a,
					fromCard,
					dx,
					dy,
					edge.fromCollapsed,
					edge.fromHistory,
				),
				end = port(b, toCard, -dx, -dy, edge.toCollapsed, edge.toHistory)
			const direction = right
				.clone()
				.multiplyScalar(dx)
				.addScaledVector(up, dy)
				.normalize()
			const bend = Math.max(2, start.distanceTo(end) * 0.35)
			const controlA = start.clone().addScaledVector(direction, bend)
			const controlB = end.clone().addScaledVector(direction, -bend)
			const loopLift = 6 * Math.max(0, 1 - separation / 4)
			controlA.addScaledVector(up, loopLift)
			controlB.addScaledVector(up, loopLift)
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
			if (!edge.relation) {
				const tangent = end.clone().sub(controlB).normalize()
				const depth = Math.abs(
					end.clone().applyMatrix4(camera.matrixWorldInverse).z,
				)
				const pixel =
					(2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
					height
				const side = new THREE.Vector3()
					.crossVectors(tangent, camera.getWorldDirection(new THREE.Vector3()))
					.normalize()
				const back = end.clone().addScaledVector(tangent, -7 * pixel)
				connected = false
				const tip = view(end)
				segment(view(back.clone().addScaledVector(side, 3 * pixel)), tip)
				segment(tip, view(back.addScaledVector(side, -3 * pixel)))
			}
			if (!d) continue
			retain(
				edge,
				{
					d,
					traced: edge.traced,
					order: edgeOrder(edge),
					relation: edge.relation,
				},
				angle,
			)
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
