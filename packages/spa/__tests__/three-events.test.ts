import * as THREE from "three"
import { afterEach, expect, it, vi } from "vitest"

import type { ThreePointerEvent } from "../src/three-events.ts"
import {
	createThreeEvents,
	forgetThree,
	listenThree,
} from "../src/three-events.ts"

const cleanups: (() => void)[] = []
afterEach(() => {
	for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})
function fixture() {
	const canvas = document.createElement(`canvas`)
	const bounds = {
		left: 20,
		top: 30,
		right: 220,
		bottom: 130,
		width: 200,
		height: 100,
		x: 20,
		y: 30,
		toJSON() {},
	}
	vi.spyOn(canvas, `getBoundingClientRect`).mockImplementation(() => bounds)
	const captured = new Set<number>()
	canvas.setPointerCapture = vi.fn((id) => {
		captured.add(id)
	})
	canvas.hasPointerCapture = (id) => captured.has(id)
	canvas.releasePointerCapture = vi.fn((id) => {
		captured.delete(id)
	})
	const scene = new THREE.Scene()
	const group = new THREE.Group()
	const mesh = new THREE.Mesh<
		THREE.BoxGeometry,
		THREE.Material | THREE.Material[]
	>(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())
	group.add(mesh)
	scene.add(group)
	const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100)
	camera.position.z = 5
	const onError = vi.fn()
	const manager = createThreeEvents(canvas, scene, () => camera, onError)
	cleanups.push(() => {
		manager.dispose()
		mesh.geometry.dispose()
		;(mesh.material as THREE.Material).dispose()
	})
	const send = (type: string, init: PointerEventInit = {}) => {
		const event = new PointerEvent(type, {
			clientX: 120,
			clientY: 80,
			pointerId: 1,
			pointerType: `mouse`,
			isPrimary: true,
			button: 0,
			buttons: 1,
			cancelable: true,
			...init,
		})
		canvas.dispatchEvent(event)
		return event
	}
	return {
		canvas,
		bounds,
		scene,
		group,
		mesh,
		camera,
		manager,
		captured,
		send,
		onError,
	}
}
it(`picks world-space geometry using CSS bounds and the current camera, then bubbles nearest-first`, () => {
	const f = fixture()
	const seen: ThreePointerEvent[] = []
	for (const node of [f.mesh, f.group, f.scene])
		listenThree(node, `pointerdown`, (event) => seen.push(event))
	const native = f.send(`pointerdown`)
	expect(seen.map((event) => event.currentTarget)).toEqual([
		f.mesh,
		f.group,
		f.scene,
	])
	expect(seen[0]).toMatchObject({
		nativeEvent: native,
		target: f.mesh,
		pointerId: 1,
		button: 0,
		buttons: 1,
		clientX: 120,
		clientY: 80,
	})
	expect(seen[0].intersection.object).toBe(f.mesh)
	expect(seen[0].intersection.point.z).toBeCloseTo(0.5)
	expect(seen[0].ray).toBeInstanceOf(THREE.Ray)
	f.camera.position.x = 10
	f.send(`pointerdown`)
	expect(seen).toHaveLength(3)
	expect(f.onError).not.toHaveBeenCalled()
})
it(`supports handler replacement/removal and propagation control without firing occluded meshes`, () => {
	const f = fixture()
	const back = new THREE.Mesh(f.mesh.geometry, f.mesh.material)
	back.position.z = -2
	f.scene.add(back)
	const parent = vi.fn()
	const behind = vi.fn()
	const sameNode = vi.fn()
	const release = listenThree(f.mesh, `pointerdown`, (event) => {
		event.stopPropagation()
		event.preventDefault()
	})
	listenThree(f.group, `pointerdown`, parent)
	listenThree(back, `pointerdown`, behind)
	const releaseSecond = listenThree(f.mesh, `pointerdown`, sameNode)
	expect(f.send(`pointerdown`).defaultPrevented).toBe(true)
	expect(parent).not.toHaveBeenCalled()
	expect(behind).not.toHaveBeenCalled()
	expect(sameNode).toHaveBeenCalledOnce()
	release()
	releaseSecond()
	releaseSecond()
	f.send(`pointerdown`)
	expect(parent).toHaveBeenCalledOnce()
})
it(`tracks hover boundaries per pointer and re-picks stationary pointers after scene changes`, () => {
	const f = fixture()
	const calls: string[] = []
	for (const [name, node] of [
		[`mesh`, f.mesh],
		[`group`, f.group],
	] as const)
		for (const type of [
			`pointerenter`,
			`pointerleave`,
			`pointerover`,
			`pointerout`,
		])
			listenThree(node, type, () => calls.push(`${name}:${type}`))
	f.send(`pointermove`)
	f.send(`pointermove`)
	expect(calls.filter((call) => call.endsWith(`pointerenter`))).toEqual([
		`group:pointerenter`,
		`mesh:pointerenter`,
	])
	f.send(`pointermove`, { pointerId: 2 })
	expect(calls.filter((call) => call === `mesh:pointerenter`)).toHaveLength(2)
	f.mesh.position.x = 20
	f.manager.update()
	expect(calls.filter((call) => call.endsWith(`pointerleave`))).toHaveLength(4)
	f.mesh.position.x = 0
	f.manager.update()
	f.send(`pointerleave`)
	const count = calls.length
	f.manager.update()
	expect(calls).toHaveLength(count)
	f.send(`pointercancel`, { pointerId: 2 })
	f.manager.dispose()
	f.manager.update()
})
it(`does not repeat parent enter/leave when moving between siblings`, () => {
	const f = fixture()
	const other = new THREE.Mesh(f.mesh.geometry, f.mesh.material)
	other.position.x = 1.5
	f.group.add(other)
	const enter = vi.fn()
	const leave = vi.fn()
	listenThree(f.group, `pointerenter`, enter)
	listenThree(f.group, `pointerleave`, leave)
	f.send(`pointermove`)
	f.mesh.position.x = -10
	other.position.x = 0
	f.manager.update()
	expect(enter).toHaveBeenCalledOnce()
	expect(leave).not.toHaveBeenCalled()
})
it(`ignores invisible ancestry, hidden materials, disabled camera layers, and invalid canvas bounds`, () => {
	const f = fixture()
	const hit = vi.fn()
	listenThree(f.mesh, `pointerdown`, hit)
	f.group.visible = false
	f.send(`pointerdown`)
	f.group.visible = true
	;(f.mesh.material as THREE.Material).visible = false
	f.send(`pointerdown`)
	f.mesh.material = [new THREE.MeshBasicMaterial({ visible: false })]
	f.send(`pointerdown`)
	f.mesh.material = []
	f.send(`pointerdown`)
	f.mesh.material = new THREE.MeshBasicMaterial()
	cleanups.push(() => {
		;(f.mesh.material as THREE.Material).dispose()
	})
	f.mesh.layers.set(1)
	f.send(`pointerdown`)
	f.mesh.layers.set(0)
	for (const init of [
		{ clientX: 0 },
		{ clientY: 0 },
		{ clientX: 221 },
		{ clientY: 131 },
	])
		f.send(`pointerdown`, init)
	f.bounds.width = 0
	f.send(`pointerdown`)
	f.bounds.width = 200
	f.bounds.height = 0
	f.send(`pointerdown`)
	expect(hit).not.toHaveBeenCalled()
})
it(`routes explicit capture off-canvas, exposes capture ownership, and only clicks a matching press`, () => {
	const f = fixture()
	const events: ThreePointerEvent[] = []
	listenThree(f.group, `pointerdown`, (event) => {
		expect(event.hasPointerCapture()).toBe(false)
		event.setPointerCapture()
		expect(event.hasPointerCapture()).toBe(true)
	})
	listenThree(f.group, `pointermove`, (event) => events.push(event))
	const up = vi.fn()
	const click = vi.fn()
	listenThree(f.group, `pointerup`, up)
	listenThree(f.group, `click`, click)
	f.send(`pointerdown`)
	f.send(`pointermove`, { clientX: 121 })
	f.send(`pointermove`, { clientX: 400 })
	expect(events[0].currentTarget).toBe(f.group)
	expect(events[0].target).toBe(f.group)
	f.send(`pointerup`, { clientX: 400 })
	expect(up).toHaveBeenCalledOnce()
	expect(click).not.toHaveBeenCalled()
	expect(f.captured.size).toBe(0)
	f.send(`pointerdown`)
	f.send(`pointerup`)
	expect(click).toHaveBeenCalledOnce()
	f.send(`pointerdown`, { button: 2 })
	f.send(`pointerup`, { button: 2 })
	expect(click).toHaveBeenCalledOnce()
})
it.each([`mouse`, `touch`])(
	`releases ancestor %s capture without cancellation`,
	(pointerType) => {
		for (const destination of [`original`, `other`, `outside`]) {
			const f = fixture()
			const seen: string[] = []
			let down!: ThreePointerEvent
			listenThree(f.group, `pointerdown`, (event) => {
				seen.push(event.type)
				down = event
				event.setPointerCapture()
			})
			const up = vi.fn((event: ThreePointerEvent) => {
				expect(event.target).toBe(f.group)
				expect(event.hasPointerCapture()).toBe(true)
				seen.push(event.type)
			})
			const click = vi.fn()
			listenThree(f.group, `pointerup`, up)
			listenThree(f.group, `pointercancel`, (event) => seen.push(event.type))
			listenThree(f.group, `click`, click)
			const move = vi.fn()
			listenThree(f.group, `pointermove`, move)
			f.send(`pointerdown`, { pointerType })
			if (destination === `other`) {
				const other = new THREE.Mesh(f.mesh.geometry, f.mesh.material)
				f.scene.add(other)
				f.mesh.position.x = 20
			}
			f.send(`pointerup`, {
				pointerType,
				buttons: 0,
				clientX: destination === `outside` ? 400 : 120,
			})
			expect(seen).toEqual([`pointerdown`, `pointerup`])
			expect(up).toHaveBeenCalledOnce()
			expect(click).toHaveBeenCalledTimes(destination === `original` ? 1 : 0)
			expect(f.captured.size).toBe(0)
			expect(down.hasPointerCapture()).toBe(false)
			f.send(`lostpointercapture`, { pointerType })
			f.send(`pointermove`, { pointerType, clientX: 400 })
			expect(move).not.toHaveBeenCalled()
			expect(seen).toEqual([`pointerdown`, `pointerup`])
			expect(f.onError).not.toHaveBeenCalled()
		}
	},
)
it.each([`mouse`, `touch`])(
	`cleans ancestor %s capture on cancellation, removal, and disposal`,
	(pointerType) => {
		for (const end of [
			`pointercancel`,
			`lostpointercapture`,
			`remove`,
			`dispose`,
		]) {
			const f = fixture()
			let down!: ThreePointerEvent
			listenThree(f.group, `pointerdown`, (event) => {
				down = event
				event.setPointerCapture()
			})
			const cancel = vi.fn()
			const up = vi.fn()
			listenThree(f.group, `pointercancel`, cancel)
			listenThree(f.group, `pointerup`, up)
			f.send(`pointerdown`, { pointerType })
			if (end === `remove`) f.manager.remove(f.group)
			else if (end === `dispose`) f.manager.dispose()
			else f.send(end, { pointerType })
			expect(cancel).toHaveBeenCalledTimes(end === `dispose` ? 0 : 1)
			expect(f.captured.size).toBe(0)
			expect(down.hasPointerCapture()).toBe(false)
			f.send(`lostpointercapture`, { pointerType })
			f.send(`pointerup`, { pointerType, buttons: 0, clientX: 400 })
			expect(cancel).toHaveBeenCalledTimes(end === `dispose` ? 0 : 1)
			expect(up).not.toHaveBeenCalled()
			expect(f.onError).not.toHaveBeenCalled()
		}
	},
)
it(`releases capture explicitly and cancels a press released outside or lost by the browser`, () => {
	const f = fixture()
	const cancel = vi.fn()
	listenThree(f.mesh, `pointercancel`, cancel)
	let captured!: ThreePointerEvent
	listenThree(f.mesh, `pointerdown`, (event) => {
		captured = event
		event.setPointerCapture()
	})
	f.send(`pointerdown`)
	captured.releasePointerCapture()
	captured.releasePointerCapture()
	expect(captured.hasPointerCapture()).toBe(false)
	f.send(`pointerup`, { clientX: 400 })
	expect(cancel).toHaveBeenCalledOnce()
	f.send(`pointerdown`)
	f.send(`lostpointercapture`)
	expect(cancel).toHaveBeenCalledTimes(2)
	f.send(`pointerdown`)
	f.send(`pointercancel`)
	expect(cancel).toHaveBeenCalledTimes(3)
	f.send(`pointercancel`, { pointerId: 5 })
})
it(`clears touch hover after release and removes hovered/captured objects without leaks`, () => {
	const f = fixture()
	const leave = vi.fn()
	const cancel = vi.fn()
	listenThree(f.mesh, `pointerleave`, leave)
	listenThree(f.mesh, `pointercancel`, cancel)
	listenThree(f.mesh, `pointerdown`, (event) => {
		event.setPointerCapture()
	})
	f.send(`pointerdown`, { pointerType: `touch` })
	f.send(`pointerup`, { pointerType: `touch` })
	expect(leave).toHaveBeenCalledOnce()
	f.send(`pointerdown`)
	f.send(`pointerleave`)
	forgetThree(f.mesh)
	expect(cancel).toHaveBeenCalledOnce()
	expect(f.captured.size).toBe(0)
	f.mesh.removeFromParent()
	f.manager.update()
	f.manager.dispose()
	f.manager.dispose()
	f.send(`pointermove`)
})
it(`permits disposal or listener removal during dispatch and reports event/update errors`, () => {
	const f = fixture()
	const skipped = vi.fn()
	let remove = () => {}
	listenThree(f.mesh, `pointerdown`, () => {
		remove()
	})
	remove = listenThree(f.mesh, `pointerdown`, skipped)
	f.send(`pointerdown`)
	expect(skipped).not.toHaveBeenCalled()
	const fail = listenThree(f.mesh, `pointermove`, () => {
		throw new Error(`handler`)
	})
	f.send(`pointermove`)
	expect(f.onError).toHaveBeenCalledWith(
		expect.objectContaining({ message: `handler` }),
	)
	fail()
	vi.spyOn(f.camera, `updateWorldMatrix`).mockImplementation(() => {
		throw new Error(`camera`)
	})
	f.manager.update()
	expect(f.onError).toHaveBeenCalledWith(
		expect.objectContaining({ message: `camera` }),
	)
	f.manager.dispose()
	const g = fixture()
	listenThree(g.mesh, `pointerdown`, () => {
		g.manager.dispose()
	})
	listenThree(g.group, `pointerdown`, skipped)
	g.send(`pointerdown`)
	expect(skipped).not.toHaveBeenCalled()
})

it(`handles custom raycast objects and material arrays without assuming mesh geometry`, () => {
	const f = fixture()
	f.mesh.removeFromParent()
	const object = new THREE.Object3D() as THREE.Object3D & {
		material?: THREE.Material | THREE.Material[]
	}
	const orphan = new THREE.Object3D()
	let picked: THREE.Object3D = object
	object.raycast = (_ray, results) => {
		results.push({ distance: 1, object: picked, point: new THREE.Vector3() })
	}
	f.scene.add(object)
	const hit = vi.fn()
	listenThree(object, `pointermove`, hit)
	f.send(`pointermove`)
	expect(hit).toHaveBeenCalledOnce()
	const material = new THREE.MeshBasicMaterial()
	object.material = [material]
	cleanups.push(() => {
		material.dispose()
	})
	f.send(`pointermove`)
	expect(hit).toHaveBeenCalledTimes(2)
	object.material[0].visible = false
	f.send(`pointermove`)
	expect(hit).toHaveBeenCalledTimes(2)
	object.material = []
	f.send(`pointermove`)
	expect(hit).toHaveBeenCalledTimes(3)
	picked = orphan
	f.send(`pointermove`)
	expect(hit).toHaveBeenCalledTimes(3)
	forgetThree(orphan)
})
it(`uses its default error boundary and stops if a hover handler disposes the router`, () => {
	const f = fixture()
	f.manager.dispose()
	let fail = false
	const manager = createThreeEvents(f.canvas, f.scene, () => {
		if (fail) throw new Error(`camera unavailable`)
		return f.camera
	})
	cleanups.push(() => {
		manager.dispose()
	})
	f.send(`pointermove`)
	fail = true
	expect(() => {
		manager.update()
	}).toThrow(`camera unavailable`)
	fail = false
	listenThree(f.mesh, `pointerenter`, () => {
		manager.dispose()
	})
	f.send(`pointerleave`)
	f.send(`pointerdown`)
	expect(f.captured.size).toBe(0)
})
it(`scrubs removed hover state while leaving unrelated pointer captures intact`, () => {
	const f = fixture()
	const leave = vi.fn()
	listenThree(f.mesh, `pointerenter`, () => {})
	listenThree(f.mesh, `pointerleave`, leave)
	f.send(`pointermove`)
	forgetThree(new THREE.Object3D())
	forgetThree(f.mesh)
	expect(leave).toHaveBeenCalledOnce()
	f.manager.update()
	f.send(`pointerdown`)
	f.manager.remove(new THREE.Object3D())
	f.manager.dispose()
	expect(f.captured.size).toBe(0)
})

it(`releases native capture and all listener state even when removal handlers fail`, () => {
	const f = fixture()
	listenThree(f.mesh, `pointerleave`, () => {
		throw new Error(`leave`)
	})
	listenThree(f.mesh, `pointercancel`, () => {
		throw new Error(`cancel`)
	})
	listenThree(f.mesh, `pointerdown`, (event) => {
		event.setPointerCapture()
	})
	f.send(`pointerdown`)
	expect(() => {
		forgetThree(f.mesh)
	}).toThrow(AggregateError)
	expect(f.captured.size).toBe(0)
	f.send(`pointermove`)
	expect(f.onError).not.toHaveBeenCalled()
})

it.each([`pointerup`, `click`])(
	`releases ancestor capture when a %s handler throws`,
	(type) => {
		const f = fixture()
		let down!: ThreePointerEvent
		listenThree(f.group, `pointerdown`, (event) => {
			down = event
			event.setPointerCapture()
		})
		listenThree(f.group, type, () => {
			throw new Error(type)
		})
		const cancel = vi.fn()
		listenThree(f.group, `pointercancel`, cancel)
		f.send(`pointerdown`, { pointerType: `touch` })
		f.send(`pointerup`, { pointerType: `touch`, buttons: 0 })
		expect(f.onError).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ message: type }),
		)
		expect(f.captured.size).toBe(0)
		expect(down.hasPointerCapture()).toBe(false)
		f.send(`lostpointercapture`)
		expect(cancel).not.toHaveBeenCalled()
	},
)
