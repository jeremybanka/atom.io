import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { onCleanup, onMount, useValue } from "../src/index.ts"
import { createSceneRenderer, sceneComponent } from "../src/renderer.ts"

type Node = { name: string; props: Record<string, any>; children: Node[] }
it(`preserves keyed scene instances, live props, refs, and owner cleanup`, () => {
	const silo = new Silo({
		name: `scene-test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const rowsAtom = silo.atom<{ id: string; x: number }[]>({
		key: `rows`,
		default: [
			{ id: `a`, x: 1 },
			{ id: `b`, x: 2 },
		],
	})
	const destroy = vi.fn()
	const mount = vi.fn()
	const cleanup = vi.fn()
	const renderer = createSceneRenderer<Node>({
		create: (name) => ({ name, props: {}, children: [] }),
		update: (node, props) => {
			node.props = props
		},
		children: (node, children) => {
			node.children = children
		},
		destroy,
	})
	const Shape = sceneComponent<{ x: number; ref?: (node: Node | null) => void }>(
		`shape`,
	)
	const ref = vi.fn()
	let setups = 0
	function Row(props: { x: number }) {
		setups++
		onMount(mount)
		onCleanup(cleanup)
		return <Shape x={props.x} ref={ref} />
	}
	function App() {
		const read = useValue(rowsAtom)
		return (
			<>
				{read().map((row) => (
					<Row key={row.id} x={row.x} />
				))}
			</>
		)
	}
	const host: Node = { name: `host`, props: {}, children: [] }
	const root = renderer.render(() => <App />, host, { store: silo.store })
	const [a, b] = host.children
	expect(host.children.map((node) => node.props[`x`])).toEqual([1, 2])
	expect(mount).toHaveBeenCalledTimes(2)
	silo.setState(rowsAtom, [
		{ id: `b`, x: 20 },
		{ id: `a`, x: 10 },
	])
	root.flush()
	expect(host.children).toEqual([b, a])
	expect(b.props[`x`]).toBe(20)
	expect(setups).toBe(2)
	silo.setState(rowsAtom, [{ id: `a`, x: 30 }])
	root.flush()
	expect(destroy).toHaveBeenCalledWith(b)
	expect(cleanup).toHaveBeenCalledTimes(1)
	root.dispose()
	root.dispose()
	expect(host.children).toEqual([])
	expect(destroy).toHaveBeenCalledTimes(2)
	expect(cleanup).toHaveBeenCalledTimes(2)
	expect(ref.mock.calls.filter(([node]) => node === null)).toHaveLength(2)
})

it(`publishes scene refs before mount hooks and releases acquired nodes on failure`, () => {
	const destroyed = vi.fn()
	const renderer = createSceneRenderer<Node>({
		create: (name) => ({ name, props: {}, children: [] }),
		update() {},
		children: (node, children) => {
			node.children = children
		},
		destroy: destroyed,
	})
	const Shape = sceneComponent<{ ref?: (node: Node | null) => void }>(`shape`)
	const host: Node = { name: `host`, props: {}, children: [] }
	let ref: Node | null = null
	function App() {
		onMount(() => {
			expect(ref?.name).toBe(`shape`)
		})
		return (
			<Shape
				ref={(node) => {
					ref = node
				}}
			/>
		)
	}
	const root = renderer.render(() => <App />, host)
	root.dispose()
	expect(ref).toBeNull()
	expect(destroyed).toHaveBeenCalledTimes(1)
	expect(() =>
		renderer.render(
			() => (
				<>
					<Shape key="same" />
					<Shape key="same" />
				</>
			),
			host,
		),
	).toThrow(`duplicate scene key`)
	expect(destroyed).toHaveBeenCalledTimes(2)
	expect(() => {
		renderer.mount(() => null, host)
	}).toThrow(`requires an owner`)
})

it(`uses the root's frame clock and disposes it when drawing fails`, async () => {
	const { onSceneFrame } = await import(`../src/renderer.ts`)
	const { render } = await import(`../src/index.ts`)
	let tick = (_time: number) => {}
	const stop = vi.fn()
	const error = vi.fn()
	const capability = {
		namespace: `clock`,
		attach: () => ({ update() {}, dispose() {} }),
		scheduleFrame(run: (time: number) => void) {
			tick = run
			return stop
		},
	}
	const host = document.createElement(`div`)
	const draw = vi.fn(() => {
		throw new Error(`drawing failed`)
	})
	const root = render(
		() => {
			onMount(() => {
				onSceneFrame(draw)
			})
			return <div />
		},
		host,
		{ capabilities: [capability], onError: error },
	)
	tick(100)
	expect(error).toHaveBeenCalledWith(
		expect.objectContaining({ message: `drawing failed` }),
	)
	expect(stop).toHaveBeenCalledTimes(1)
	tick(200)
	expect(draw).toHaveBeenCalledTimes(1)
	root.dispose()
})
