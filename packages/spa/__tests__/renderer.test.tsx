import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { onCleanup, onMount, useGetter } from "../src/index.ts"
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
		const getRows = useGetter(rowsAtom)
		return (
			<>
				{getRows().map((row) => (
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

it(`handles invalid children, keyed type replacement, array components, and owned mounts`, async () => {
	const { render } = await import(`../src/index.ts`)
	const renderer = createSceneRenderer<Node>({
		create: (name) => ({ name, props: {}, children: [] }),
		update() {},
		children(parent, children) {
			parent.children = children
		},
		destroy() {},
	})
	const parent: Node = { name: `parent`, props: {}, children: [] }
	for (const value of [`text`, {} as any, { type: `shape` } as any])
		expect(() => renderer.render(() => value, parent)).toThrow()
	const silo = new Silo({
		name: `replacement`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const activeAtom = silo.atom<boolean>({ key: `active`, default: false })
	const A = sceneComponent<{}>(`a`)
	const B = sceneComponent<{}>(`b`)
	function ArrayComponent() {
		return [<A />, <B />]
	}
	function App() {
		const getActive = useGetter(activeAtom)
		return (
			<>
				{getActive() ? <A key="same" /> : <B key="same" />}
				<ArrayComponent />
			</>
		)
	}
	const root = renderer.render(() => <App />, parent, { store: silo.store })
	expect(parent.children.map((node) => node.name)).toEqual([`b`, `a`, `b`])
	silo.setState(activeAtom, true)
	root.flush()
	expect(parent.children.map((node) => node.name)).toEqual([`a`, `a`, `b`])
	root.dispose()
	const host = document.createElement(`div`)
	const mounted = render(() => {
		onMount(() => {
			renderer.mount(() => <A />, parent)
		})
		return <div />
	}, host)
	expect(parent.children[0].name).toBe(`a`)
	mounted.dispose()
	expect(parent.children).toHaveLength(0)
	expect(() =>
		render(() => {
			onMount(() => {
				renderer.mount(() => `bad`, parent)
			})
			return <div />
		}, host),
	).toThrow(`must be nodes`)
})
it(`cancels browser frame subscriptions and ignores stale callbacks after removal`, async () => {
	const { onSceneFrame } = await import(`../src/renderer.ts`)
	const { render } = await import(`../src/index.ts`)
	let callback!: FrameRequestCallback
	const request = vi
		.spyOn(globalThis, `requestAnimationFrame`)
		.mockImplementation((run) => {
			callback = run
			return 7
		})
	const cancel = vi
		.spyOn(globalThis, `cancelAnimationFrame`)
		.mockImplementation(() => {})
	const host = document.createElement(`div`)
	const draw = vi.fn()
	try {
		const root = render(() => {
			onMount(() => {
				onSceneFrame(draw)
			})
			return <div />
		}, host)
		callback(100)
		expect(draw).toHaveBeenCalledOnce()
		expect(request).toHaveBeenCalledTimes(2)
		root.dispose()
		expect(cancel).toHaveBeenCalledWith(7)
		callback(200)
		expect(draw).toHaveBeenCalledOnce()
		const cap = (namespace: string) => ({
			namespace,
			attach: () => ({ update() {}, dispose() {} }),
			scheduleFrame: () => () => {},
		})
		expect(() =>
			render(
				() => {
					onMount(() => {
						onSceneFrame(draw)
					})
					return null
				},
				host,
				{ capabilities: [cap(`a`), cap(`b`)] },
			),
		).toThrow(`multiple frame clock`)
		let root2: ReturnType<typeof render>
		root2 = render(() => {
			onMount(() => {
				onSceneFrame(() => {
					root2.dispose()
				})
			})
			return null
		}, host)
		callback(300)
	} finally {
		request.mockRestore()
		cancel.mockRestore()
	}
})
it(`does not publish stale scene refs after a sibling removes their scope`, async () => {
	const core = await import(`../src/core.ts`)
	let victimScope!: NonNullable<typeof core.owner>
	const ref = vi.fn()
	const renderer = createSceneRenderer<Node>({
		create: (name) => ({ name, props: {}, children: [] }),
		update() {},
		children(parent, children) {
			parent.children = children
		},
		destroy() {},
	})
	const Shape = sceneComponent<{ ref: (node: Node | null) => void }>(`shape`)
	function Victim() {
		victimScope = core.owner!
		return <Shape ref={ref} />
	}
	const parent: Node = { name: `parent`, props: {}, children: [] }
	const root = renderer.render(
		() => (
			<>
				<Victim />
				<Shape
					ref={(node) => {
						if (node) core.dispose(victimScope)
					}}
				/>
			</>
		),
		parent,
	)
	expect(ref).not.toHaveBeenCalled()
	root.dispose()
})
