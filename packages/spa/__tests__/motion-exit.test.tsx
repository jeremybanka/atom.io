import { Silo } from "atom.io"
import Konva from "konva"
import * as THREE from "three"
import { expect, it, vi } from "vitest"

import { hydrate, render, useGetter } from "../src/index.ts"
import { Group, konvaRenderer } from "../src/konva.ts"
import { motionCapability } from "../src/motion.ts"
import { renderToString } from "../src/server.ts"
import {
	BoxGeometry,
	createThreeEvents,
	Mesh,
	MeshNormalMaterial,
	threeRenderer,
} from "../src/three.ts"

const wait = async (time = 100) => {
	await new Promise((resolve) => setTimeout(resolve, time))
}

it(`animates compiled DOM exits from current values, retains refs, and resumes a keyed instance`, async () => {
	const silo = new Silo({
		name: `motion-exit`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const xAtom = silo.atom<number>({ key: `x`, default: 0 })
	const host = document.createElement(`div`)
	const ref = vi.fn()
	function App() {
		const getVisible = useGetter(visibleAtom)
		const getX = useGetter(xAtom)
		return (
			<>
				{getVisible() && (
					<custom-panel
						key="panel"
						ref={ref}
						motion:initial={false}
						motion:animate={{ x: getX(), opacity: 1 }}
						motion:exit={{ x: 100, opacity: 0 }}
						motion:transition={{ type: `tween`, duration: 0.1 }}
					/>
				)}
			</>
		)
	}
	const capabilities = [motionCapability({ reducedMotion: `never` })]
	const root = render(() => <App />, host, { store: silo.store, capabilities })
	const panel = host.querySelector<HTMLElement>(`custom-panel`)!
	silo.setState(visibleAtom, false)
	root.flush()
	await wait(40)
	expect(host.querySelector(`custom-panel`)).toBe(panel)
	expect(ref).toHaveBeenCalledTimes(1)
	silo.setState(xAtom, 20)
	silo.setState(visibleAtom, true)
	root.flush()
	await wait(150)
	expect(host.querySelector(`custom-panel`)).toBe(panel)
	expect(panel.style.transform).toContain(`20px`)
	silo.setState(visibleAtom, false)
	root.flush()
	await wait(180)
	expect(host.querySelector(`custom-panel`)).toBeNull()
	expect(ref).toHaveBeenLastCalledWith(null)
	root.dispose()
})
it(`supports exit-only properties and immediate removal for reduced motion or no exit`, async () => {
	const silo = new Silo({
		name: `motion-immediate`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const host = document.createElement(`div`)
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<i
						motion:exit={{ opacity: 0 }}
						motion:transition={{ duration: 0.01 }}
					/>
				)}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `never` })],
	})
	silo.setState(visibleAtom, false)
	root.flush()
	expect(host.querySelector(`i`)).not.toBeNull()
	await wait()
	expect(host.querySelector(`i`)).toBeNull()
	root.dispose()
	silo.setState(visibleAtom, true)
	const reduced = render(() => <App />, host, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `always` })],
	})
	silo.setState(visibleAtom, false)
	reduced.flush()
	expect(host.querySelector(`i`)).toBeNull()
	reduced.dispose()
})
it(`finishes an active exit when reduced motion changes and cancels promptly on root disposal`, async () => {
	let changed = () => {}
	const preference = {
		matches: false,
		addEventListener(_type: string, callback: () => void) {
			changed = callback
		},
		removeEventListener() {},
	}
	vi.stubGlobal(`matchMedia`, () => preference)
	try {
		const silo = new Silo({
			name: `motion-preference`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
		const host = document.createElement(`div`)
		function App() {
			const getVisible = useGetter(visibleAtom)
			return (
				<>
					{getVisible() && (
						<b
							motion:exit={{ opacity: 0 }}
							motion:transition={{ duration: 10 }}
						/>
					)}
				</>
			)
		}
		const root = render(() => <App />, host, {
			store: silo.store,
			capabilities: [motionCapability()],
		})
		silo.setState(visibleAtom, false)
		root.flush()
		preference.matches = true
		changed()
		await wait(10)
		expect(host.children).toHaveLength(0)
		root.dispose()
		preference.matches = false
		silo.setState(visibleAtom, true)
		const next = render(() => <App />, host, {
			store: silo.store,
			capabilities: [motionCapability()],
		})
		silo.setState(visibleAtom, false)
		next.flush()
		next.dispose()
		expect(host.children).toHaveLength(0)
	} finally {
		vi.unstubAllGlobals()
	}
})
it(`rejects non-settling exits through the root error path`, () => {
	for (const transition of [
		{ damping: 0 },
		{ stiffness: 0 },
		{ duration: Infinity },
		{ delay: -1 },
		{ restDelta: 0 },
		{ visualDuration: Infinity },
		{ velocity: Infinity },
		{ bounce: 1 },
	]) {
		const silo = new Silo({
			name: `invalid-exit`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
		function App() {
			const getVisible = useGetter(visibleAtom)
			return (
				<>
					{getVisible() && (
						<i motion:exit={{ opacity: 0 }} motion:transition={transition} />
					)}
				</>
			)
		}
		const host = document.createElement(`div`)
		const root = render(() => <App />, host, {
			store: silo.store,
			capabilities: [motionCapability()],
		})
		silo.setState(visibleAtom, false)
		expect(() => {
			root.flush()
		}).toThrow(`finite settling transition`)
		expect(host.children).toHaveLength(0)
	}
})
it(`hydrates exit declarations without serializing or starting them, then retains the first removal`, async () => {
	const silo = new Silo({
		name: `hydrated-exit`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const capabilities = [motionCapability({ reducedMotion: `never` })]
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<custom-panel
						key="panel"
						motion:exit={{ opacity: 0 }}
						motion:transition={{ duration: 0.01 }}
					>
						hello
					</custom-panel>
				)}
			</>
		)
	}
	const setup = () => <App />
	const html = renderToString(setup, { store: silo.store, capabilities })
	expect(html).not.toContain(`motion:`)
	const host = document.createElement(`div`)
	host.innerHTML = html
	const panel = host.querySelector(`custom-panel`)
	const root = hydrate(setup, host, { store: silo.store, capabilities })
	expect(host.querySelector(`custom-panel`)).toBe(panel)
	silo.setState(visibleAtom, false)
	root.flush()
	expect(host.querySelector(`custom-panel`)).toBe(panel)
	await wait()
	expect(host.querySelector(`custom-panel`)).toBeNull()
	root.dispose()
})

it(`retains native Konva/Three objects, excludes exiting meshes from picking, and delays resource disposal`, async () => {
	const silo = new Silo({
		name: `native-exit`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const capabilities = [motionCapability({ reducedMotion: `never` })]
	let mesh!: THREE.Mesh
	const down = vi.fn()
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<Mesh
						ref={(node) => {
							if (node) mesh = node
						}}
						motion:exit={{ position: [2, 0, 0] }}
						motion:transition={{ duration: 0.05 }}
						onPointerDown={down}
					>
						<BoxGeometry />
						<MeshNormalMaterial />
					</Mesh>
				)}
			</>
		)
	}
	const scene = new THREE.Scene()
	const root = threeRenderer.render(() => <App />, scene, {
		store: silo.store,
		capabilities,
	})
	const geometry = vi.spyOn(mesh.geometry, `dispose`)
	const canvas = document.createElement(`canvas`)
	vi.spyOn(canvas, `getBoundingClientRect`).mockReturnValue({
		left: 0,
		right: 100,
		top: 0,
		bottom: 100,
		width: 100,
		height: 100,
	} as DOMRect)
	const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100)
	camera.position.z = 5
	const events = createThreeEvents(canvas, scene, () => camera)
	canvas.dispatchEvent(
		new PointerEvent(`pointerdown`, { pointerId: 1, clientX: 50, clientY: 50 }),
	)
	expect(down).toHaveBeenCalledOnce()
	silo.setState(visibleAtom, false)
	root.flush()
	expect(scene.children).toContain(mesh)
	expect(geometry).not.toHaveBeenCalled()
	canvas.dispatchEvent(
		new PointerEvent(`pointerdown`, { pointerId: 2, clientX: 50, clientY: 50 }),
	)
	expect(down).toHaveBeenCalledOnce()
	await wait(160)
	expect(scene.children).toHaveLength(0)
	expect(geometry).toHaveBeenCalledOnce()
	root.dispose()
	events.dispose()
	silo.setState(visibleAtom, true)
	const parent = new Konva.Group()
	let group!: Konva.Group
	function Drawing() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<Group
						ref={(node) => {
							if (node) group = node
						}}
						motion:exit={{ x: 100 }}
						motion:transition={{ duration: 0.05 }}
					/>
				)}
			</>
		)
	}
	const drawing = konvaRenderer.render(() => <Drawing />, parent, {
		store: silo.store,
		capabilities,
	})
	silo.setState(visibleAtom, false)
	drawing.flush()
	expect(group.listening()).toBe(false)
	expect(parent.children).toContain(group)
	silo.setState(visibleAtom, true)
	drawing.flush()
	expect(group.listening()).toBe(true)
	drawing.dispose()
})

it(`settles the default spring and ignores resume after disposal`, async () => {
	const element = document.createElement(`div`)
	const binding = motionCapability({ reducedMotion: `never` }).attach({
		kind: `dom`,
		node: element,
	})
	binding.update({ initial: false, animate: { opacity: 1 } })
	const handle = binding.exit!({ exit: { opacity: 1 } })!
	await handle.finished
	const explicit = binding.exit!({
		exit: { opacity: 1 },
		transition: { velocity: -1, bounce: 0.2, visualDuration: 0.1 },
	})!
	explicit.cancel()
	await explicit.finished
	binding.dispose()
	binding.resume!()
})

it(`resumes toward a target shared by animate and exit after an interrupted exit`, async () => {
	let x = 0
	const binding = motionCapability({ reducedMotion: `never` }).attach({
		kind: `scene`,
		node: {},
		read: () => x,
		write(_, value) {
			x = value as number
		},
	})
	const props = {
		initial: false,
		animate: { x: 0 },
		transition: { duration: 0.08 },
	}
	binding.update(props)
	const handle = binding.exit!({
		exit: { x: 10 },
		transition: props.transition,
	})!
	await wait(25)
	handle.cancel()
	binding.update({ ...props, animate: { x: 10 } })
	binding.resume!()
	await wait(140)
	expect(x).toBeCloseTo(10)
	binding.dispose()
})

it(`keeps a returning native instance and its momentum through repeated presence interruptions`, async () => {
	const silo = new Silo({
		name: `tween-u-turn`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const presentAtom = silo.atom<boolean>({ key: `present`, default: true })
	const parent = new Konva.Group(),
		ref = vi.fn()
	function App() {
		const getPresent = useGetter(presentAtom)
		return (
			<>
				{getPresent() && (
					<Group
						key="same"
						ref={ref}
						motion:initial={false}
						motion:animate={{ x: 0 }}
						motion:exit={{ x: 100 }}
						motion:transition={{ type: `tween`, duration: 0.3, ease: `linear` }}
					/>
				)}
			</>
		)
	}
	const root = konvaRenderer.render(() => <App />, parent, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `never` })],
	})
	const node = parent.children[0] as Konva.Group
	silo.setState(presentAtom, false)
	root.flush()
	await wait(80)
	silo.setState(presentAtom, true)
	root.flush()
	const leaving = node.x()
	await wait(25)
	expect(node.x()).toBeGreaterThan(leaving)
	expect(parent.children[0]).toBe(node)
	expect(ref).toHaveBeenCalledOnce()
	silo.setState(presentAtom, false)
	root.flush()
	await wait(15)
	silo.setState(presentAtom, true)
	root.flush()
	await wait(400)
	expect(parent.children[0]).toBe(node)
	expect(node.x()).toBeCloseTo(0)
	expect(ref).toHaveBeenCalledOnce()
	root.dispose()
	expect(ref).toHaveBeenLastCalledWith(null)
})

it(`cancels same-frame tween exits and active return bridges without leaving stale work`, async () => {
	let preferenceChanged = () => {}
	const preference = {
		matches: false,
		addEventListener(_event: string, callback: () => void) {
			preferenceChanged = callback
		},
		removeEventListener() {},
	}
	vi.stubGlobal(`matchMedia`, () => preference)
	try {
		const silo = new Silo({
			name: `tween-cancellation`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const presentAtom = silo.atom<boolean>({ key: `present`, default: true })
		const parent = new Konva.Group(),
			ref = vi.fn()
		function App() {
			const getPresent = useGetter(presentAtom)
			return (
				<>
					{getPresent() && (
						<Group
							key="same"
							ref={ref}
							motion:initial={false}
							motion:animate={{ x: 0 }}
							motion:exit={{ x: 100 }}
							motion:transition={{ type: `tween`, duration: 0.3 }}
						/>
					)}
				</>
			)
		}
		const root = konvaRenderer.render(() => <App />, parent, {
			store: silo.store,
			capabilities: [motionCapability()],
		})
		const node = parent.children[0] as Konva.Group
		for (const state of [false, true, false, true]) {
			silo.setState(presentAtom, state)
			root.flush()
		}
		await wait(40)
		expect(node.x()).toBe(0)
		expect(parent.children[0]).toBe(node)
		expect(ref).toHaveBeenCalledOnce()
		silo.setState(presentAtom, false)
		root.flush()
		await wait(60)
		silo.setState(presentAtom, true)
		root.flush()
		preference.matches = true
		preferenceChanged()
		expect(node.x()).toBe(0)
		await wait(60)
		expect(node.x()).toBe(0)
		preference.matches = false
		preferenceChanged()
		silo.setState(presentAtom, false)
		root.flush()
		await wait(60)
		silo.setState(presentAtom, true)
		root.flush()
		root.dispose()
		const disposed = node.x()
		await wait(80)
		expect(parent.children).toHaveLength(0)
		expect(node.x()).toBe(disposed)
		expect(ref).toHaveBeenLastCalledWith(null)
	} finally {
		vi.unstubAllGlobals()
	}
})
