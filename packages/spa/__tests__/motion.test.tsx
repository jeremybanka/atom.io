import { Silo } from "atom.io"
import { visualElementStore } from "motion"
import { expect, it, vi } from "vitest"

import { render, Root, useGetter } from "../src/index.ts"
import type { MotionAttributes } from "../src/motion.ts"
import { motionCapability } from "../src/motion.ts"
import { createSceneRenderer, sceneComponent } from "../src/renderer.ts"

it(`initializes layout when the first Motion boundary mounts during a flush`, () => {
	const silo = new Silo({
		name: `scoped-motion`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: false })
	const motion = motionCapability({ reducedMotion: `always` })
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<Root capabilities={[motion]}>
						<div motion:layout />
					</Root>
				)}
			</>
		)
	}
	const host = document.createElement(`section`)
	document.body.append(host)
	const root = render(() => <App />, host, { store: silo.store })
	try {
		silo.setState(visibleAtom, true)
		root.flush()
		expect(
			visualElementStore.get(host.querySelector(`div`)!)?.projection,
		).toBeDefined()
	} finally {
		root.dispose()
		host.remove()
	}
})

it(`animates native scene properties, respects reduced motion, and restores borrowed values`, () => {
	const silo = new Silo({
		name: `motion`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const positionAtom = silo.atom<number>({ key: `position`, default: 5 })
	type Node = { x: number; children: Node[] }
	let node!: Node
	const destroy = vi.fn()
	const renderer = createSceneRenderer<Node>({
		create: () => (node = { x: 0, children: [] }),
		update() {},
		children(parent, children) {
			parent.children = children
		},
		destroy,
		target(target) {
			return {
				kind: `konva`,
				node: target,
				read: () => target.x,
				write: (_, value) => {
					target.x = value as number
				},
			}
		},
	})
	const Shape = sceneComponent<MotionAttributes<`konva`>>(`shape`)
	function App() {
		const getPosition = useGetter(positionAtom)
		return (
			<Shape motion:initial={{ x: -1 }} motion:animate={{ x: getPosition() }} />
		)
	}
	const host = { x: 0, children: [] }
	const root = renderer.render(() => <App />, host, {
		store: silo.store,
		capabilities: [motionCapability({ reducedMotion: `always` })],
	})
	expect(node.x).toBe(5)
	silo.setState(positionAtom, 10)
	root.flush()
	expect(node.x).toBe(10)
	root.dispose()
	expect(node.x).toBe(0)
	expect(destroy).toHaveBeenCalledTimes(1)
})

it(`rejects unsupported capabilities and scene gestures with actionable errors`, () => {
	const host = document.createElement(`div`)
	const capability = motionCapability()
	expect(() =>
		render(() => <custom-panel {...{ "motion:unknown": 1 }} />, host, {
			capabilities: [capability],
		}),
	).toThrow(`unknown property motion:unknown`)
	const binding = capability.attach({
		kind: `three`,
		node: {},
		read: () => 0,
		write() {},
	})
	expect(() => {
		binding.update({ whileHover: { scale: 2 } })
	}).toThrow(`gestures require a renderer event adapter`)
	binding.dispose()
	expect(() => capability.attach({ kind: `unknown`, node: {} })).toThrow(
		`does not support motion`,
	)
})

it(`finishes active springs when reduced motion changes and removes its listener`, () => {
	let changed = () => {}
	const preference = {
		matches: false,
		addEventListener: vi.fn((_event, listener) => {
			changed = listener
		}),
		removeEventListener: vi.fn(),
	}
	vi.stubGlobal(`matchMedia`, () => preference)
	try {
		const node = { x: 0 }
		const binding = motionCapability().attach({
			kind: `konva`,
			node,
			read: () => node.x,
			write: (_, value) => {
				node.x = value as number
			},
		})
		binding.update({
			animate: { x: 100 },
			transition: { type: `spring`, stiffness: 180 },
		})
		preference.matches = true
		changed()
		expect(node.x).toBe(100)
		binding.dispose()
		expect(node.x).toBe(0)
		expect(preference.removeEventListener).toHaveBeenCalledWith(
			`change`,
			changed,
		)
	} finally {
		vi.unstubAllGlobals()
	}
})
