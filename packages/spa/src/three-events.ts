import * as THREE from "three"

export interface ThreePointerEvent<N extends THREE.Object3D = THREE.Object3D> {
	type: string
	nativeEvent: PointerEvent
	target: THREE.Object3D
	currentTarget: N
	intersection: THREE.Intersection
	ray: THREE.Ray
	pointerId: number
	button: number
	buttons: number
	clientX: number
	clientY: number
	stopPropagation(): void
	preventDefault(): void
	setPointerCapture(): void
	releasePointerCapture(): void
	hasPointerCapture(): boolean
}
export type ThreeEventHandler<N extends THREE.Object3D = THREE.Object3D> = (
	event: ThreePointerEvent<N>,
) => void
export interface ThreeEventAttributes<
	N extends THREE.Object3D = THREE.Object3D,
> {
	onPointerDown?: ThreeEventHandler<N>
	onPointerUp?: ThreeEventHandler<N>
	onPointerMove?: ThreeEventHandler<N>
	onPointerEnter?: ThreeEventHandler<N>
	onPointerLeave?: ThreeEventHandler<N>
	onPointerOver?: ThreeEventHandler<N>
	onPointerOut?: ThreeEventHandler<N>
	onPointerCancel?: ThreeEventHandler<N>
	onClick?: ThreeEventHandler<N>
}
type Hit = { node: THREE.Object3D; intersection: THREE.Intersection }
type Handler = ThreeEventHandler
const listeners = new WeakMap<THREE.Object3D, Map<string, Set<Handler>>>()
const managers = new Set<{ remove(node: THREE.Object3D): void }>()

export function listenThree(
	node: THREE.Object3D,
	type: string,
	handler: Handler,
): () => void {
	const events = listeners.get(node) ?? new Map<string, Set<Handler>>()
	listeners.set(node, events)
	const handlers = events.get(type) ?? new Set<Handler>()
	events.set(type, handlers)
	handlers.add(handler)
	return () => {
		handlers.delete(handler)
		if (!handlers.size) events.delete(type)
	}
}
export function forgetThree(node: THREE.Object3D): void {
	const errors: unknown[] = []
	for (const manager of managers) {
		try {
			manager.remove(node)
		} catch (error) {
			errors.push(error)
		}
	}
	listeners.delete(node)
	if (errors.length) throw new AggregateError(errors)
}

export interface ThreeEventManager {
	update(): void
	/** Release hover, press, and capture state for a removed subtree. */
	remove(node: THREE.Object3D): void
	dispose(): void
}

/** Attach raycast pointer routing to a canvas; usable with borrowed scene roots. */
export function createThreeEvents(
	canvas: HTMLCanvasElement,
	scene: THREE.Object3D,
	camera: () => THREE.Camera,
	onError: (error: unknown) => void = (error) => {
		throw error
	},
): ThreeEventManager {
	const raycaster = new THREE.Raycaster()
	const pointer = new THREE.Vector2()
	const hovering = new Map<number, Hit>()
	const pressed = new Map<number, Hit>()
	const captures = new Map<number, Hit>()
	const last = new Map<number, PointerEvent>()
	let dead = false
	const path = (node: THREE.Object3D) => {
		const nodes: THREE.Object3D[] = []
		for (let at: THREE.Object3D | null = node; at; at = at.parent) {
			nodes.push(at)
			if (at === scene) return nodes
		}
		return []
	}
	const contains = (node: THREE.Object3D, child: THREE.Object3D) => {
		for (let at: THREE.Object3D | null = child; at; at = at.parent)
			if (at === node) return true
		return false
	}
	const eligible = (intersection: THREE.Intersection) => {
		const nodes = path(intersection.object)
		if (!nodes.length || nodes.some((node) => !node.visible)) return false
		const material = (intersection.object as THREE.Mesh).material
		return (
			!material ||
			(Array.isArray(material)
				? material[intersection.face?.materialIndex ?? 0]?.visible !== false
				: material.visible)
		)
	}
	const pick = (event: PointerEvent): Hit | undefined => {
		const bounds = canvas.getBoundingClientRect()
		if (!bounds.width || !bounds.height) return undefined
		const active = camera()
		scene.updateWorldMatrix(true, true)
		active.updateWorldMatrix(true, false)
		pointer.set(
			((event.clientX - bounds.left) / bounds.width) * 2 - 1,
			1 - ((event.clientY - bounds.top) / bounds.height) * 2,
		)
		raycaster.layers.mask = active.layers.mask
		raycaster.setFromCamera(pointer, active)
		if (
			event.clientX < bounds.left ||
			event.clientX > bounds.right ||
			event.clientY < bounds.top ||
			event.clientY > bounds.bottom
		)
			return undefined
		const intersection = raycaster.intersectObject(scene, true).find(eligible)
		return intersection ? { node: intersection.object, intersection } : undefined
	}
	const nativeCapture = (id: number) => {
		if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id)
	}
	const dispatch = (
		type: string,
		hit: Hit,
		nativeEvent: PointerEvent,
		nodes = path(hit.node),
	) => {
		let stopped = false
		for (const node of nodes) {
			if (dead) break
			const event: ThreePointerEvent = {
				type,
				nativeEvent,
				target: hit.node,
				currentTarget: node,
				intersection: hit.intersection,
				ray: raycaster.ray.clone(),
				pointerId: nativeEvent.pointerId,
				button: nativeEvent.button,
				buttons: nativeEvent.buttons,
				clientX: nativeEvent.clientX,
				clientY: nativeEvent.clientY,
				stopPropagation() {
					stopped = true
				},
				preventDefault() {
					nativeEvent.preventDefault()
				},
				setPointerCapture() {
					canvas.setPointerCapture(nativeEvent.pointerId)
					captures.set(nativeEvent.pointerId, {
						node,
						intersection: hit.intersection,
					})
				},
				releasePointerCapture() {
					if (captures.get(nativeEvent.pointerId)?.node === node) {
						captures.delete(nativeEvent.pointerId)
						nativeCapture(nativeEvent.pointerId)
					}
				},
				hasPointerCapture() {
					return captures.get(nativeEvent.pointerId)?.node === node
				},
			}
			for (const handler of [...(listeners.get(node)?.get(type) ?? [])])
				if (!dead && listeners.get(node)?.get(type)?.has(handler)) handler(event)
			if (stopped) break
		}
	}
	const hover = (event: PointerEvent, next?: Hit) => {
		const previous = hovering.get(event.pointerId)
		if (previous?.node === next?.node) {
			if (next) hovering.set(event.pointerId, next)
			return
		}
		const oldPath = previous ? path(previous.node) : []
		const newPath = next ? path(next.node) : []
		// Publish state first so handlers may remove nodes or dispose this manager safely.
		if (next) hovering.set(event.pointerId, next)
		else hovering.delete(event.pointerId)
		if (previous) {
			dispatch(`pointerout`, previous, event)
			for (const node of oldPath)
				if (!newPath.includes(node))
					dispatch(`pointerleave`, previous, event, [node])
		}
		if (next && path(next.node).length) {
			dispatch(`pointerover`, next, event)
			for (const node of newPath.reverse())
				if (!oldPath.includes(node))
					dispatch(`pointerenter`, next, event, [node])
		}
	}
	const cancel = (event: PointerEvent) => {
		const hit = captures.get(event.pointerId) ?? pressed.get(event.pointerId)
		captures.delete(event.pointerId)
		pressed.delete(event.pointerId)
		try {
			if (hit) dispatch(`pointercancel`, hit, event)
		} finally {
			nativeCapture(event.pointerId)
		}
	}
	const handle = (event: PointerEvent) => {
		try {
			if (event.type === `lostpointercapture`) {
				cancel(event)
				return
			}
			if (event.type === `pointercancel`) {
				cancel(event)
				hover(event)
				last.delete(event.pointerId)
				return
			}
			if (event.type === `pointerleave`) {
				last.set(event.pointerId, event)
				hover(event)
				return
			}
			last.set(event.pointerId, event)
			const hit = pick(event)
			hover(event, hit)
			if (dead) return
			const capture = captures.get(event.pointerId)
			if (capture && hit && contains(capture.node, hit.node))
				capture.intersection = hit.intersection
			const delivery = capture ?? hit
			if (event.type === `pointerdown`) {
				if (hit) {
					pressed.set(event.pointerId, hit)
					canvas.setPointerCapture?.(event.pointerId)
				}
			}
			if (event.type === `pointerup`) {
				const down = pressed.get(event.pointerId)
				pressed.delete(event.pointerId)
				if (down && down.node !== delivery?.node)
					dispatch(`pointercancel`, down, event)
				if (delivery) dispatch(`pointerup`, delivery, event)
				if (down && down.node === hit?.node && event.button === 0)
					dispatch(`click`, hit, event)
				captures.delete(event.pointerId)
				nativeCapture(event.pointerId)
				if (event.pointerType === `touch`) {
					hover(event)
					last.delete(event.pointerId)
				}
			} else if (delivery) dispatch(event.type, delivery, event)
		} catch (error) {
			onError(error)
		}
	}
	const events = [
		`pointerdown`,
		`pointerup`,
		`pointermove`,
		`pointerleave`,
		`pointercancel`,
		`lostpointercapture`,
	] as const
	for (const type of events) canvas.addEventListener(type, handle)
	const manager = {
		/** Re-pick stationary pointers after camera, geometry, or transforms change. */
		update() {
			if (dead) return
			try {
				for (const event of last.values())
					if (event.type !== `pointerleave`) hover(event, pick(event))
			} catch (error) {
				onError(error)
			}
		},
		remove(node: THREE.Object3D) {
			const errors: unknown[] = []
			for (const [id, hit] of hovering)
				if (contains(node, hit.node)) {
					try {
						hover(last.get(id)!)
					} catch (error) {
						errors.push(error)
					}
				}
			for (const [id, hit] of [...pressed, ...captures])
				if (contains(node, hit.node)) {
					try {
						cancel(last.get(id)!)
					} catch (error) {
						errors.push(error)
					}
				}
			if (errors.length) throw new AggregateError(errors)
		},
		dispose() {
			if (dead) return
			dead = true
			for (const type of events) canvas.removeEventListener(type, handle)
			for (const id of new Set([...pressed.keys(), ...captures.keys()]))
				nativeCapture(id)
			hovering.clear()
			pressed.clear()
			captures.clear()
			last.clear()
			managers.delete(manager)
		},
	}
	managers.add(manager)
	return manager
}
