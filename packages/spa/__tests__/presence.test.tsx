import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import type { Capability, Child } from "../src/index.ts"
import { onCleanup, onMount, render, useValue } from "../src/index.ts"
import type { ExitHandle } from "../src/presence.ts"
import { createPresence } from "../src/presence.ts"
import { createSceneRenderer, sceneComponent } from "../src/renderer.ts"

// eslint-disable-next-line quotes -- Module augmentation requires a string literal.
declare module "@atom.io/spa/jsx-runtime" {
	interface CapabilityAttributes<Kind extends string = string> {
		[`test:exit`]?: unknown
	}
}

const tick = async () => {
	await Promise.resolve()
	await Promise.resolve()
}
function fixture() {
	const silo = new Silo({
		name: `presence`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const itemsAtom = silo.atom<string[]>({ key: `items`, default: [`a`, `b`] })
	const labelAtom = silo.atom<string>({ key: `label`, default: `before` })
	const pending: {
		finish(): void
		cancel: ReturnType<typeof vi.fn>
		handle: ExitHandle
	}[] = []
	const capability: Capability = {
		namespace: `test`,
		presence: createPresence,
		attach() {
			let props: Record<string, unknown> = {}
			return {
				update(next) {
					props = next
				},
				dispose() {},
				exit(next) {
					if (!next[`exit`]) return undefined
					let finish!: () => void
					const finished = new Promise<void>((resolve) => {
						finish = resolve
					})
					const cancel = vi.fn(finish)
					const handle = { finished, cancel }
					pending.push({ finish, cancel, handle })
					return handle
				},
				resume() {
					void props
				},
			}
		},
	}
	return { silo, itemsAtom, labelAtom, pending, capability }
}
it(`retains DOM ranges, freezes observers and input, and revives the same keyed instance`, async () => {
	const f = fixture()
	const host = document.createElement(`div`)
	document.body.append(host)
	const cleanup = vi.fn(),
		mount = vi.fn(),
		click = vi.fn()
	function Row(props: { id: string }) {
		const label = useValue(f.labelAtom)
		onMount(mount)
		onCleanup(cleanup)
		return (
			<button data-id={props.id} test:exit={true} onClick={click}>
				{label()}
			</button>
		)
	}
	function App() {
		const items = useValue(f.itemsAtom)
		return (
			<>
				{items().map((id) => (
					<Row key={id} id={id} />
				))}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const a = host.querySelector(`[data-id=a]`) as HTMLButtonElement
	a.focus()
	expect(document.activeElement).toBe(a)
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	expect(a.isConnected).toBe(true)
	expect(a.hasAttribute(`inert`)).toBe(true)
	expect(a.getAttribute(`aria-hidden`)).toBe(`true`)
	expect(document.activeElement).not.toBe(a)
	a.click()
	expect(click).not.toHaveBeenCalled()
	expect(cleanup).not.toHaveBeenCalled()
	f.silo.setState(f.labelAtom, `during`)
	root.flush()
	expect(a.textContent).toBe(`before`)
	f.silo.setState(f.itemsAtom, [`b`, `a`])
	root.flush()
	expect(host.querySelector(`[data-id=a]`)).toBe(a)
	expect(a.hasAttribute(`inert`)).toBe(false)
	expect(a.textContent).toBe(`during`)
	a.click()
	expect(click).toHaveBeenCalledOnce()
	expect(click.mock.contexts[0]).toBe(a)
	expect(mount).toHaveBeenCalledTimes(2)
	f.pending[0].finish()
	await tick()
	expect(a.isConnected).toBe(true)
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	f.pending.at(-1)!.finish()
	await tick()
	expect(a.isConnected).toBe(false)
	expect(cleanup).toHaveBeenCalledTimes(1)
	root.dispose()
	host.remove()
})
it(`coordinates nested exits and lets re-entry preserve independently absent descendants`, async () => {
	const f = fixture()
	const parentAtom = f.silo.atom<boolean>({ key: `parent`, default: true })
	const childAtom = f.silo.atom<boolean>({ key: `child`, default: true })
	const host = document.createElement(`div`)
	function Child() {
		return <i test:exit={true}>child</i>
	}
	function Parent() {
		const child = useValue(childAtom)
		return <section test:exit={true}>{child() && <Child key="child" />}</section>
	}
	function App() {
		const parent = useValue(parentAtom)
		return <>{parent() && <Parent key="parent" />}</>
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const section = host.querySelector(`section`),
		child = host.querySelector(`i`)
	f.silo.setState(childAtom, false)
	root.flush()
	expect(f.pending).toHaveLength(1)
	f.silo.setState(parentAtom, false)
	root.flush()
	expect(f.pending).toHaveLength(2)
	f.pending[0].finish()
	await tick()
	expect(host.querySelector(`i`)).toBe(child)
	f.silo.setState(parentAtom, true)
	root.flush()
	await tick()
	expect(host.querySelector(`section`)).toBe(section)
	expect(host.querySelector(`i`)).toBeNull()
	root.dispose()
})
it(`keeps incompatible replacements separate and forces immediate root disposal`, async () => {
	const f = fixture()
	const typeAtom = f.silo.atom<number>({ key: `type`, default: 0 })
	const host = document.createElement(`div`)
	function A() {
		return <i test:exit={true}>A</i>
	}
	function B() {
		return <b test:exit={true}>B</b>
	}
	function App() {
		const type = useValue(typeAtom)
		return <>{type() === 0 ? <A key="same" /> : <B key="same" />}</>
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const first = host.querySelector(`i`)
	f.silo.setState(typeAtom, 1)
	root.flush()
	expect(host.querySelector(`i`)).toBe(first)
	expect(host.querySelector(`b`)).not.toBeNull()
	f.silo.setState(typeAtom, 0)
	root.flush()
	expect(host.querySelectorAll(`i`)).toHaveLength(2)
	root.dispose()
	expect(host.children).toHaveLength(0)
	for (const pending of f.pending) pending.finish()
	await tick()
	expect(host.children).toHaveLength(0)
})
it(`retains scene nodes and resources until completion and resumes native identity`, async () => {
	const f = fixture()
	type Node = { id: string; children: Node[]; enabled: boolean }
	const destroyed = vi.fn(),
		suspended = vi.fn(),
		restored = vi.fn()
	const renderer = createSceneRenderer<Node>({
		create: () => ({ id: `node`, children: [], enabled: true }),
		update() {},
		children(parent, children) {
			parent.children = children
		},
		destroy: destroyed,
		target(node) {
			return {
				kind: `scene`,
				node,
				suspend() {
					node.enabled = false
					suspended()
					return () => {
						node.enabled = true
						restored()
					}
				},
			}
		},
	})
	const Shape = sceneComponent<{
		children?: Child
		id?: string
		[key: string]: any
	}>(`shape`)
	function App() {
		const items = useValue(f.itemsAtom)
		return (
			<>
				{items().map((id) => (
					<Shape key={id} test:exit={true} />
				))}
			</>
		)
	}
	const host: Node = { id: `host`, children: [], enabled: true }
	const root = renderer.render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const a = host.children[0]
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	expect(host.children).toContain(a)
	expect(a.enabled).toBe(false)
	expect(destroyed).not.toHaveBeenCalled()
	f.silo.setState(f.itemsAtom, [`a`, `b`])
	root.flush()
	expect(host.children[0]).toBe(a)
	expect(a.enabled).toBe(true)
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	f.pending.at(-1)!.finish()
	await tick()
	expect(host.children).not.toContain(a)
	expect(destroyed).toHaveBeenCalledOnce()
	root.dispose()
	expect(suspended).toHaveBeenCalled()
	expect(restored).toHaveBeenCalled()
})

it(`waits for every nested participant, preserves properties, and removes non-exiting children immediately`, async () => {
	const f = fixture()
	const visibleAtom = f.silo.atom<boolean>({ key: `visible`, default: true })
	const host = document.createElement(`div`)
	function App() {
		const visible = useValue(visibleAtom)
		return (
			<>
				{visible() && (
					<section
						test:exit={true}
						aria-hidden="false"
						style="pointer-events: auto !important"
					>
						<i test:exit={true} />
						<b />
					</section>
				)}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const section = host.querySelector(`section`) as HTMLElement
	f.silo.setState(visibleAtom, false)
	root.flush()
	expect(f.pending).toHaveLength(2)
	f.pending[0].finish()
	await tick()
	expect(host.querySelector(`section`)).toBe(section)
	f.pending[1].finish()
	await tick()
	expect(host.children).toHaveLength(0)
	expect(section.getAttribute(`aria-hidden`)).toBe(`false`)
	expect(section.style.getPropertyValue(`pointer-events`)).toBe(`auto`)
	expect(section.style.getPropertyPriority(`pointer-events`)).toBe(`important`)
	root.dispose()
	const empty = render(() => <span />, host, { capabilities: [f.capability] })
	empty.dispose()
	expect(host.children).toHaveLength(0)
})
it(`captures the latest exit props at removal`, () => {
	const f = fixture()
	const visibleAtom = f.silo.atom<boolean>({ key: `visible`, default: true })
	const enabledAtom = f.silo.atom<boolean>({ key: `enabled`, default: false })
	const host = document.createElement(`div`)
	function App() {
		const visible = useValue(visibleAtom)
		const enabled = useValue(enabledAtom)
		return <>{visible() && <span key="a" test:exit={enabled()} />}</>
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	f.silo.setState(visibleAtom, false)
	f.silo.setState(enabledAtom, true)
	root.flush()
	expect(f.pending).toHaveLength(1)
	expect(host.querySelector(`span`)).not.toBeNull()
	root.dispose()
})
it(`guards public frame callbacks while infrastructure drawing continues`, async () => {
	const { onSceneFrame } = await import(`../src/renderer.ts`)
	const f = fixture()
	const showAtom = f.silo.atom<boolean>({ key: `show`, default: true })
	const callbacks: ((time: number) => void)[] = []
	const clock: Capability = {
		namespace: `clock`,
		attach: () => ({ update() {}, dispose() {} }),
		scheduleFrame(run) {
			callbacks.push(run)
			return () => {}
		},
	}
	const user = vi.fn(),
		draw = vi.fn()
	function Row() {
		onMount(() => {
			onSceneFrame(user)
			onSceneFrame(draw, true)
		})
		return <span test:exit={true} />
	}
	function App() {
		const show = useValue(showAtom)
		return <>{show() && <Row key="row" />}</>
	}
	const root = render(() => <App />, document.createElement(`div`), {
		store: f.silo.store,
		capabilities: [f.capability, clock],
	})
	for (const callback of callbacks) callback(1)
	f.silo.setState(showAtom, false)
	root.flush()
	for (const callback of callbacks) callback(2)
	expect(user).toHaveBeenCalledTimes(1)
	expect(draw).toHaveBeenCalledTimes(2)
	f.silo.setState(showAtom, true)
	root.flush()
	for (const callback of callbacks) callback(3)
	expect(user).toHaveBeenCalledTimes(2)
	root.dispose()
})

it(`allows a logically returning nested key to revive before releasing an adopted completed exit`, async () => {
	const f = fixture()
	const parentAtom = f.silo.atom<boolean>({ key: `parent`, default: true })
	const childAtom = f.silo.atom<boolean>({ key: `child`, default: true })
	const host = document.createElement(`div`)
	function Parent() {
		const child = useValue(childAtom)
		return (
			<section test:exit={true}>
				{child() && <i key="child" test:exit={true} />}
			</section>
		)
	}
	function App() {
		const parent = useValue(parentAtom)
		return <>{parent() && <Parent key="parent" />}</>
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const child = host.querySelector(`i`)
	f.silo.setState(childAtom, false)
	root.flush()
	f.silo.setState(parentAtom, false)
	root.flush()
	f.pending[0].finish()
	await tick()
	f.silo.setState(childAtom, true)
	f.silo.setState(parentAtom, true)
	root.flush()
	await tick()
	expect(host.querySelector(`i`)).toBe(child)
	root.dispose()
})

it(`keeps an incompatible returning key separate from its exiting generation`, () => {
	const f = fixture()
	const stateAtom = f.silo.atom<number>({ key: `state`, default: 0 })
	const host = document.createElement(`div`)
	function App() {
		const read = useValue(stateAtom)
		return (
			<>
				{read() === 0 ? (
					<i key="same" test:exit={true} />
				) : read() === 1 ? null : (
					<b key="same" test:exit={true} />
				)}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const old = host.querySelector(`i`)
	f.silo.setState(stateAtom, 1)
	root.flush()
	f.silo.setState(stateAtom, 2)
	root.flush()
	expect(host.querySelector(`i`)).toBe(old)
	expect(host.querySelector(`b`)).not.toBeNull()
	root.dispose()
})

it(`reports async exit failures, ignores cancelled rejection, and completes teardown despite errors`, async () => {
	const { createRoot, createScope, dispose } = await import(`../src/core.ts`)
	const { capabilityProps } = await import(`../src/capabilities.ts`)
	const errors = vi.fn()
	const plain: Capability = {
		namespace: `plain`,
		attach: () => ({ update() {}, dispose() {} }),
	}
	const root = createRoot({
		capabilities: [fixture().capability, plain],
		onError: errors,
	})
	const scope = createScope(root)
	const apply = capabilityProps(scope, { kind: `scene`, node: {} })
	apply({ [`plain:value`]: true })
	let resolve!: () => void, reject!: (error: unknown) => void
	const participant = {
		exit: () => ({
			finished: new Promise<void>((yes, no) => {
				resolve = yes
				reject = no
			}),
			cancel: vi.fn(),
		}),
		resume() {},
	}
	scope._exits = new Set([participant])
	root._presence!.remove(scope, () => {
		throw new Error(`completion failed`)
	})
	resolve()
	await tick()
	expect(errors).toHaveBeenCalledOnce()
	expect(root._dead).toBe(true)
	const cancelled = createRoot({ onError: errors })
	cancelled._presence = createPresence(cancelled)
	const child = createScope(cancelled)
	child._exits = new Set([participant])
	cancelled._presence.remove(child, () => {})
	cancelled._presence.resume(child)
	reject(new Error(`obsolete`))
	await tick()
	expect(errors).toHaveBeenCalledOnce()
	dispose(cancelled)
	const failed = createRoot({ onError: errors })
	failed._presence = createPresence(failed)
	const owned = createScope(failed)
	const cleanup = vi.fn()
	owned._cleanups.add(cleanup)
	owned._exits = new Set([
		{
			...participant,
			exit: () => ({
				finished: new Promise<void>((_, no) => {
					reject = no
				}),
				cancel() {
					throw new Error(`cancel failed`)
				},
			}),
		},
	])
	failed._presence.target(owned, {
		kind: `scene`,
		node: {},
		suspend: () => () => {
			throw new Error(`restore failed`)
		},
	})
	failed._presence.remove(owned, () => {})
	reject(new Error(`animation failed`))
	await tick()
	expect(cleanup).toHaveBeenCalledOnce()
	expect(errors).toHaveBeenCalledTimes(2)
	expect(failed._dead).toBe(true)
	const late = createRoot({ onError: errors })
	late._presence = createPresence(late)
	const ending = createScope(late)
	ending._exits = new Set([participant])
	late._presence.remove(ending, () => {
		dispose(late)
		throw new Error(`late completion failure`)
	})
	resolve()
	await tick()
	expect(errors).toHaveBeenCalledTimes(2)
	expect(() =>
		createRoot({
			capabilities: [
				fixture().capability,
				{ ...fixture().capability, namespace: `second` },
			],
		}),
	).toThrow(`multiple presence`)
})

it(`preserves several pending ranges and revives keys independently`, () => {
	const f = fixture()
	const host = document.createElement(`div`)
	function App() {
		const items = useValue(f.itemsAtom)
		return (
			<>
				{items().map((id) => (
					<i key={id} data-id={id} test:exit={true} />
				))}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	const [a, b] = host.querySelectorAll(`i`)
	f.silo.setState(f.itemsAtom, [])
	root.flush()
	expect([...host.querySelectorAll(`i`)]).toEqual([a, b])
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	expect([...host.querySelectorAll(`i`)]).toEqual([a, b])
	root.dispose()
})
it(`supplies snapshot props to direct capability adapters`, async () => {
	const { createRoot, createScope, dispose } = await import(`../src/core.ts`)
	const { capabilityProps } = await import(`../src/capabilities.ts`)
	const f = fixture()
	const root = createRoot({ capabilities: [f.capability] })
	const scope = createScope(root)
	const apply = capabilityProps(scope, { kind: `scene`, node: {} })
	apply({ [`test:exit`]: true })
	expect(root._presence!.remove(scope, () => {})).toBe(true)
	expect(f.pending).toHaveLength(1)
	dispose(root)
})
it(`does not reattach a scene whose cleanup disposes the root`, async () => {
	const f = fixture()
	const host: object[] = []
	const renderer = createSceneRenderer<object>({
		create: () => ({}),
		update() {},
		children(parent, nodes) {
			if (parent === host) host.splice(0, host.length, ...nodes)
		},
		destroy() {},
	})
	const Shape = sceneComponent<{ [key: string]: any }>(`shape`)
	let root!: ReturnType<typeof renderer.render>
	function Row() {
		onCleanup(() => {
			root.dispose()
		})
		return <Shape test:exit={true} />
	}
	function App() {
		const items = useValue(f.itemsAtom)
		return (
			<>
				{items().map((id) => (
					<Row key={id} />
				))}
			</>
		)
	}
	root = renderer.render(() => <App />, host, {
		capabilities: [f.capability],
		store: f.silo.store,
	})
	f.silo.setState(f.itemsAtom, [`b`])
	root.flush()
	f.pending[0].finish()
	await tick()
	expect(host).toHaveLength(0)
})

it(`keeps sibling order when exits start and finish in different updates`, async () => {
	const f = fixture()
	f.silo.setState(f.itemsAtom, [`a`, `b`, `c`])
	const host = document.createElement(`div`)
	function App() {
		const items = useValue(f.itemsAtom)
		return (
			<>
				{items().map((id) => (
					<i key={id} test:exit={true}>
						{id}
					</i>
				))}
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: f.silo.store,
		capabilities: [f.capability],
	})
	f.silo.setState(f.itemsAtom, [`b`, `c`])
	root.flush()
	f.silo.setState(f.itemsAtom, [`c`])
	root.flush()
	expect(host.textContent).toBe(`abc`)
	f.pending[0].finish()
	await tick()
	f.silo.setState(f.itemsAtom, [`c`, `d`])
	root.flush()
	expect(host.textContent).toBe(`bcd`)
	root.dispose()
})
