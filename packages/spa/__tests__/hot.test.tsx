import { atom, atomFamily, Silo, timeline } from "atom.io"
import { expect, it, vi } from "vitest"

import { createRoot, dispose, within } from "../src/core.ts"
import { refresh, registerComponent, trackRoot } from "../src/hot.ts"
import {
	hydrate,
	onCleanup,
	onMount,
	render,
	useGetter,
	useId,
	useRef,
	useSetter,
	useTimeline,
} from "../src/index.ts"
import { jsx } from "../src/jsx-runtime.ts"
import { createSceneRenderer } from "../src/renderer.ts"
import { renderToString } from "../src/server.ts"

it(`refreshes separate roots against their original stores, preserving families, history, IDs and subscriber counts`, () => {
	const first = new Silo({
		name: `hot-first`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const second = new Silo({
		name: `hot-second`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = atom<number>({ key: `count`, default: 0 })
	const memberAtoms = atomFamily<number, string>({
		key: `member`,
		default: 5,
	})
	const buttonAtom = atom<HTMLButtonElement | null>({
		key: `button`,
		default: null,
	})
	const historyTimeline = timeline({ key: `history`, scope: [countAtom] })
	first.install([countAtom, memberAtoms, buttonAtom, historyTimeline])
	second.install([countAtom, memberAtoms, buttonAtom, historyTimeline])
	second.setState(countAtom, 10)
	first.inspectTimeline(historyTimeline)
	const persistentSubscribers = first.store.atoms.get(countAtom.key)!.subject
		.subscribers.size
	const cleanup = vi.fn()
	const histories = new Map<string, ReturnType<typeof useTimeline>>()
	const implementation =
		(version: string, step: number) => (props: { label: string }) => {
			const getCount = useGetter(countAtom),
				setCount = useSetter(countAtom)
			const getMember = useGetter(memberAtoms, `keep`)
			const ref = useRef(buttonAtom),
				history = useTimeline(historyTimeline)
			const id = useId()
			histories.set(props.label, history)
			onCleanup(() => {
				cleanup(props.label)
			})
			return (
				<button
					id={id}
					ref={ref}
					onClick={() => {
						setCount((value) => value + step)
					}}
				>
					{version}:{props.label}:{getCount()}:{getMember()}:
					{history.getCursor()}
				</button>
			)
		}
	const App = registerComponent(`stores`, `default`, implementation(`old`, 1))
	const host = document.createElement(`main`)
	const a = render(() => <App label="a" />, host, { store: first.store })
	const divider = document.createElement(`hr`)
	host.append(divider)
	const b = render(() => <App label="b" />, host, { store: second.store })
	const old = [...host.querySelectorAll(`button`)]
	try {
		old[0].click()
		a.flush()
		first.setState(memberAtoms, `keep`, 9)
		a.flush()
		const cursors = [...histories.values()].map((history) => history.getCursor())
		const subscribers = [first, second].map(
			(silo) => silo.store.atoms.get(countAtom.key)!.subject.subscribers.size,
		)
		expect(
			registerComponent(`stores`, `default`, implementation(`new`, 2)),
		).toBe(App)
		refresh(`unrelated`)
		expect(cleanup).not.toHaveBeenCalled()
		refresh(`stores`)
		const buttons = [...host.querySelectorAll(`button`)]
		expect([...host.children]).toEqual([buttons[0], divider, buttons[1]])
		expect(buttons.map((button) => button.id)).toEqual(
			old.map((button) => button.id),
		)
		expect(buttons[0].textContent).toBe(`new:a:1:9:${cursors[0]}`)
		expect(buttons[1].textContent).toBe(`new:b:10:5:${cursors[1]}`)
		expect(cleanup.mock.calls).toEqual([[`a`], [`b`]])
		expect(
			[first, second].map(
				(silo) => silo.store.atoms.get(countAtom.key)!.subject.subscribers.size,
			),
		).toEqual(subscribers)
		expect(first.getState(buttonAtom)).toBe(buttons[0])
		old[0].click()
		a.flush()
		expect(first.getState(countAtom)).toBe(1)
		buttons[0].click()
		a.flush()
		expect(first.getState(countAtom)).toBe(3)
		histories.get(`a`)!.undo()
		a.flush()
		expect(first.getState(countAtom)).toBe(1)
	} finally {
		a.dispose()
		a.dispose()
		b.dispose()
	}
	refresh(`stores`)
	expect(first.getState(buttonAtom)).toBeNull()
	expect(first.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(
		persistentSubscribers,
	)
	expect(cleanup).toHaveBeenCalledTimes(4)
})

it(`retains an implicit store and refreshes hydrated roots without hydrating again`, () => {
	const hotCountAtom = atom<number>({ key: `hotCount`, default: 0 })
	const component = (version: string) => () => {
		const getHotCount = useGetter(hotCountAtom),
			setHotCount = useSetter(hotCountAtom)
		return (
			<button
				onClick={() => {
					setHotCount((value) => value + 1)
				}}
			>
				{version}:{getHotCount()}
			</button>
		)
	}
	const App = registerComponent(`hydrated`, `default`, component(`old`))
	const host = document.createElement(`main`)
	host.innerHTML = renderToString(() => <App />)
	const original = host.querySelector(`button`)
	const root = hydrate(() => <App />, host)
	try {
		expect(host.querySelector(`button`)).toBe(original)
		original!.click()
		root.flush()
		registerComponent(`hydrated`, `default`, component(`new`))
		refresh(`hydrated`)
		expect(host.textContent).toBe(`new:1`)
	} finally {
		root.dispose()
	}
	expect(host.childNodes).toHaveLength(0)
})

it(`tracks components mounted after setup and keeps later siblings in place`, () => {
	const silo = new Silo({
		name: `late`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const showAtom = silo.atom<boolean>({ key: `show`, default: false })
	const App = registerComponent(`late`, `App`, () => <span>old</span>)
	const host = document.createElement(`main`)
	const root = render(
		() => {
			const getShow = useGetter(showAtom)
			return <div>{getShow() && <App />}</div>
		},
		host,
		{ store: silo.store },
	)
	const sibling = document.createElement(`hr`)
	host.append(sibling)
	try {
		silo.setState(showAtom, true)
		root.flush()
		registerComponent(`late`, `App`, () => <span>new</span>)
		refresh(`late`)
		expect(host.textContent).toBe(`new`)
		expect(host.lastElementChild).toBe(sibling)
	} finally {
		root.dispose()
	}
})

it(`refreshes nested roots once when a parent replaces the child root`, () => {
	const childCleanup = vi.fn(),
		parentCleanup = vi.fn()
	const Child = registerComponent(`nested`, `Child`, () => {
		onCleanup(childCleanup)
		return <b>child</b>
	})
	const Parent = registerComponent(`nested`, `Parent`, () => {
		let host!: HTMLElement
		onCleanup(parentCleanup)
		onMount(() => {
			const child = render(() => <Child />, host)
			onCleanup(child.dispose)
		})
		return (
			<section
				ref={(element) => {
					if (element) host = element
				}}
			/>
		)
	})
	const host = document.createElement(`main`)
	const root = render(() => <Parent />, host)
	try {
		refresh(`nested`)
		expect(childCleanup).toHaveBeenCalledOnce()
		expect(parentCleanup).toHaveBeenCalledOnce()
		expect(host.textContent).toBe(`child`)
	} finally {
		root.dispose()
	}
	expect(childCleanup).toHaveBeenCalledTimes(2)
})

it(`shows failed hot setup without losing the store and recovers on the next edit`, () => {
	const silo = new Silo({
		name: `recovery`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 7 })
	const onError = vi.fn(),
		cleanup = vi.fn()
	const good = () => {
		const getCount = useGetter(countAtom)
		onCleanup(cleanup)
		return <p>{getCount()}</p>
	}
	const App = registerComponent(`recovery`, `default`, good)
	const host = document.createElement(`main`)
	const root = render(() => <App />, host, { store: silo.store, onError })
	try {
		registerComponent(`recovery`, `default`, () => {
			throw new Error(`broken edit`)
		})
		refresh(`recovery`)
		expect(cleanup).toHaveBeenCalledOnce()
		expect(host.querySelector(`[data-spa-hot-error]`)!.textContent).toContain(
			`broken edit`,
		)
		expect(onError).toHaveBeenCalledOnce()
		registerComponent(`recovery`, `default`, good)
		refresh(`recovery`)
		expect(host.textContent).toBe(`7`)
		expect(silo.store.atoms.get(countAtom.key)!.subject.subscribers.size).toBe(1)
	} finally {
		root.dispose()
	}
})

it(`refreshes standalone scene roots, reports failures without a DOM, and cleans old nodes`, () => {
	type SceneNode = { children: SceneNode[]; x?: number }
	const silo = new Silo({
		name: `hot-scene`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 3 })
	const destroyed = vi.fn(),
		onError = vi.fn()
	const renderer = createSceneRenderer<SceneNode>({
		create: () => ({ children: [] }),
		update(node, props) {
			node.x = props[`x`]
		},
		children(parent, children) {
			parent.children = children
		},
		destroy: destroyed,
	})
	const view = (scale: number) => () => {
		const getCount = useGetter(countAtom)
		return jsx(`group`, {
			get x() {
				return getCount() * scale
			},
		})
	}
	const App = registerComponent(`scene`, `default`, view(1))
	const parent: SceneNode = { children: [] }
	const root = renderer.render(() => <App />, parent, {
		store: silo.store,
		onError,
	})
	try {
		registerComponent(`scene`, `default`, view(2))
		refresh(`scene`)
		expect(parent.children[0].x).toBe(6)
		expect(destroyed).toHaveBeenCalledOnce()
		registerComponent(`scene`, `default`, () => {
			throw new Error(`scene edit`)
		})
		refresh(`scene`)
		expect(
			document.querySelector(`[data-spa-hot-error]`)!.textContent,
		).toContain(`scene edit`)
		vi.stubGlobal(`document`, undefined)
		try {
			refresh(`scene`)
		} finally {
			vi.unstubAllGlobals()
		}
		expect(onError).toHaveBeenCalledTimes(2)
		registerComponent(`scene`, `default`, view(3))
		refresh(`scene`)
		expect(parent.children[0].x).toBe(9)
	} finally {
		root.dispose()
	}
})

it(`keeps ordinary component calls usable outside a managed root and unregisters failed initial mounts`, () => {
	const App = registerComponent(`ordinary`, `default`, () => <p>ordinary</p>)
	expect(App().type).toBe(`p`)
	const root = createRoot()
	trackRoot(root)
	expect(within(root, App).type).toBe(`p`)
	dispose(root)
	const failed = registerComponent(`initial-failure`, `default`, () => {
		throw new Error(`initial`)
	})
	expect(() =>
		render(() => jsx(failed, {}), document.createElement(`main`)),
	).toThrow(`initial`)
	expect(() => {
		refresh(`initial-failure`)
	}).not.toThrow()
})

it(`recovers a view when its host content was removed externally`, () => {
	const App = registerComponent(`external`, `default`, () => <p>restored</p>)
	const host = document.createElement(`main`)
	const root = render(() => <App />, host)
	try {
		host.replaceChildren()
		refresh(`external`)
		expect(host.textContent).toBe(`restored`)
	} finally {
		root.dispose()
	}
})

it(`keeps standalone production scene rendering free of the hot manager`, () => {
	vi.stubEnv(`DEV`, false)
	try {
		type Node = { children: Node[] }
		const renderer = createSceneRenderer<Node>({
			create: () => ({ children: [] }),
			update() {},
			children(parent, children) {
				parent.children = children
			},
			destroy() {},
		})
		const parent: Node = { children: [] }
		const root = renderer.render(() => jsx(`group`, {}), parent)
		expect(parent.children).toHaveLength(1)
		root.dispose()
		expect(parent.children).toHaveLength(0)
	} finally {
		vi.unstubAllEnvs()
	}
})

it(`leaves the production hot entry inert`, async () => {
	vi.stubEnv(`DEV`, false)
	vi.resetModules()
	try {
		const production = await import(`../src/hot.ts`)
		const component = () => null
		expect(production.registerComponent(`prod`, `default`, component)).toBe(
			component,
		)
		production.refresh(`prod`)
		production.trackRoot({} as ReturnType<typeof createRoot>)
		const handle = { dispose() {}, flush() {} }
		const factory = vi.fn(() => handle)
		expect(production.hotRoot(factory, {})).toBe(handle)
		expect(factory).toHaveBeenCalledWith({}, null)
	} finally {
		vi.unstubAllEnvs()
	}
})
