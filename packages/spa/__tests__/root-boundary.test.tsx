import { atom, type Loadable, Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { createRenderer } from "../src/astro-server.ts"
import type { Capability } from "../src/index.ts"
import {
	hydrate,
	onCleanup,
	render,
	Root,
	useGetter,
	useId,
	useLoadable,
	useRef,
	useSetter,
	useStore,
} from "../src/index.ts"
import { jsx } from "../src/jsx-runtime.ts"
import { createPresence } from "../src/presence.ts"
import { createSceneRenderer } from "../src/renderer.ts"
import { renderToString } from "../src/server.ts"

function makeSilo(name: string) {
	return new Silo({ name, lifespan: `ephemeral`, isProduction: true })
}

it(`hydrates sibling boundaries and flushes both stores through one root`, () => {
	const shell = makeSilo(`shell`)
	const first = makeSilo(`first`)
	const second = makeSilo(`second`)
	const boundaryCountAtom = atom<number>({ key: `boundaryCount`, default: 0 })
	const boundaryElementAtom = atom<HTMLButtonElement | null>({
		key: `boundaryElement`,
		default: null,
	})
	const showAtom = shell.atom<boolean>({ key: `show`, default: true })
	const generationAtom = shell.atom<number>({ key: `generation`, default: 0 })
	shell.install([boundaryCountAtom, boundaryElementAtom])
	first.install([boundaryCountAtom, boundaryElementAtom])
	second.install([boundaryCountAtom, boundaryElementAtom])
	first.setState(boundaryCountAtom, 2)
	second.setState(boundaryCountAtom, 8)
	const cleanup = vi.fn()
	function Counter() {
		const store = useStore()
		const getCount = useGetter(boundaryCountAtom)
		const setCount = useSetter(boundaryCountAtom)
		const ref = useRef(boundaryElementAtom)
		const id = useId()
		onCleanup(() => cleanup(store))
		return (
			<button
				id={id}
				ref={ref}
				onClick={() => {
					setCount(getCount() + 1)
				}}
			>
				{getCount()}
			</button>
		)
	}
	function App() {
		const getShow = useGetter(showAtom)
		const getGeneration = useGetter(generationAtom)
		const child = <Counter />
		return (
			<main>
				<Counter />
				{getShow() && (
					<Root
						key={getGeneration()}
						store={getGeneration() ? second.store : first.store}
					>
						{child}
					</Root>
				)}
				<Root store={second.store} idPrefix="document">
					<Root>{child}</Root>
				</Root>
				<Root idPrefix="document">
					<Counter />
				</Root>
			</main>
		)
	}
	const host = document.createElement(`section`)
	const setup = () => <App />
	host.innerHTML = renderToString(setup, {
		store: shell.store,
		idPrefix: `shell`,
	})
	cleanup.mockClear()
	const buttons = [...host.querySelectorAll(`button`)]
	expect(buttons.map((button) => button.id)).toEqual([
		`shell-0`,
		`shell-1`,
		`document-2`,
		`document-3`,
	])
	const root = hydrate(setup, host, { store: shell.store })
	expect([...host.querySelector(`main`)!.children]).toEqual(buttons)
	expect(first.getState(boundaryElementAtom)).toBe(buttons[1])
	buttons[1].click()
	second.setState(boundaryCountAtom, 9)
	root.flush()
	expect(buttons.map((button) => button.textContent)).toEqual([
		`0`,
		`3`,
		`9`,
		`0`,
	])

	shell.setState(generationAtom, 1)
	root.flush()
	expect(first.getState(boundaryElementAtom)).toBeNull()
	expect(
		first.store.atoms.get(boundaryCountAtom.key)!.subject.subscribers.size,
	).toBe(0)
	expect(first.getState(boundaryCountAtom)).toBe(3)
	expect(host.querySelectorAll(`button`)[1]?.textContent).toBe(`9`)
	expect(cleanup).toHaveBeenCalledExactlyOnceWith(first.store)
	shell.setState(showAtom, false)
	root.flush()
	expect(host.querySelectorAll(`button`)).toHaveLength(3)
	root.dispose()
	for (const silo of [shell, first, second]) {
		expect(silo.getState(boundaryElementAtom)).toBeNull()
		expect(
			silo.store.atoms.get(boundaryCountAtom.key)!.subject.subscribers.size,
		).toBe(0)
	}
	expect(second.getState(boundaryCountAtom)).toBe(9)
})

it(`inherits the boundary store in scene mounts and standalone scene roots`, () => {
	const shell = makeSilo(`scene-shell`)
	const documentStore = makeSilo(`scene-document`)
	const sceneBoundaryCountAtom = atom<number>({
		key: `sceneBoundaryCount`,
		default: 0,
	})
	documentStore.install([sceneBoundaryCountAtom])
	const update = vi.fn()
	const scene = createSceneRenderer({
		create: (type) => ({ type }),
		update,
		children: () => {},
		destroy: () => {},
	})
	function Item() {
		const getCount = useGetter(sceneBoundaryCountAtom)
		return jsx(`item`, {
			get count() {
				return getCount()
			},
		})
	}
	function Scene() {
		scene.mount(() => <Item />, { type: `parent` })
		return null
	}
	const host = document.createElement(`section`)
	const root = render(
		() => (
			<Root store={documentStore.store}>
				<Scene />
			</Root>
		),
		host,
		{ store: shell.store },
	)
	const standalone = scene.render(
		() => (
			<Root store={documentStore.store}>
				<Item />
			</Root>
		),
		{ type: `parent` },
		{ store: shell.store },
	)
	documentStore.setState(sceneBoundaryCountAtom, 4)
	root.flush()
	standalone.flush()
	expect(
		update.mock.calls.filter(([, props]) => props.count === 4),
	).toHaveLength(2)
	root.dispose()
	standalone.dispose()
	expect(
		documentStore.store.atoms.get(sceneBoundaryCountAtom.key)!.subject
			.subscribers.size,
	).toBe(0)
})

it(`applies scoped capabilities and retires a boundary from its parent's collection`, async () => {
	const silo = makeSilo(`scoped-capability`)
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const beforeUpdate = vi.fn()
	const release = vi.fn()
	const exit = Promise.withResolvers<void>()
	const capability: Capability = {
		namespace: `local`,
		presence: createPresence,
		beforeUpdate,
		attach: () => ({
			update: () => {},
			dispose: release,
			exit: () => ({ finished: exit.promise, cancel: () => {} }),
		}),
	}
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				<Root capabilities={[capability]} />
				{getVisible() && (
					<Root capabilities={[capability]}>
						{jsx(`div`, { "local:exit": true })}
					</Root>
				)}
			</>
		)
	}
	const host = document.createElement(`section`)
	const root = render(() => <App />, host, { store: silo.store })
	silo.setState(visibleAtom, false)
	root.flush()
	expect(beforeUpdate).toHaveBeenCalledOnce()
	expect(host.querySelector(`div`)?.hasAttribute(`inert`)).toBe(true)
	exit.resolve()
	await exit.promise
	expect(host.querySelector(`div`)).toBeNull()
	expect(release).toHaveBeenCalledOnce()
	silo.setState(visibleAtom, true)
	root.flush()
	expect(beforeUpdate).toHaveBeenCalledTimes(2)
	root.dispose()
})

it(`keeps a single presence coordinator for the shared root`, () => {
	const capability: Capability = {
		namespace: `custom`,
		presence: createPresence,
		attach: () => ({ update: () => {}, dispose: () => {} }),
	}
	const host = document.createElement(`section`)
	expect(() =>
		render(
			() => (
				<Root
					capabilities={[
						{ ...capability, presence: (root) => createPresence(root) },
					]}
				/>
			),
			host,
			{ capabilities: [capability] },
		),
	).toThrow(`multiple presence coordinators`)
})

it(`reports scheduled errors to the nearest configured handler`, async () => {
	const silo = makeSilo(`scoped-error`)
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const outside = vi.fn()
	const inside = vi.fn()
	const error = new Error(`update failed`)
	function Counter() {
		const getCount = useGetter(countAtom)
		const read = () => {
			if (getCount()) throw error
			return 0
		}
		return <output>{read()}</output>
	}
	const host = document.createElement(`section`)
	function App() {
		const getCount = useGetter(countAtom)
		return (
			<Root onError={inside}>
				<Root>{getCount() ? <Counter /> : null}</Root>
			</Root>
		)
	}
	render(() => <App />, host, { store: silo.store, onError: outside })
	silo.setState(countAtom, 1)
	await Promise.resolve()
	expect(inside).toHaveBeenCalledExactlyOnceWith(error)
	expect(outside).not.toHaveBeenCalled()
	expect(host.childNodes).toHaveLength(0)
})

it(`reports cleanup errors to the boundary being removed by an outer update`, async () => {
	const silo = makeSilo(`scoped-cleanup-error`)
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const outside = vi.fn()
	const inside = vi.fn()
	const cleanup = vi.fn()
	const error = new Error(`cleanup failed`)
	function Child() {
		onCleanup(cleanup)
		onCleanup(() => {
			throw error
		})
		return <div />
	}
	function App() {
		const getVisible = useGetter(visibleAtom)
		return (
			<>
				{getVisible() && (
					<Root onError={inside}>
						<Child />
					</Root>
				)}
			</>
		)
	}
	const host = document.createElement(`section`)
	render(() => <App />, host, { store: silo.store, onError: outside })
	silo.setState(visibleAtom, false)
	await Promise.resolve()
	expect(inside).toHaveBeenCalledExactlyOnceWith(expect.any(AggregateError))
	expect(outside).not.toHaveBeenCalled()
	expect(cleanup).toHaveBeenCalledOnce()
	expect(host.childNodes).toHaveLength(0)
})

it(`awaits borrowed store reads for SSR without including them in the island's read list`, async () => {
	const documentStore = makeSilo(`island-document`)
	const islandTextAtom = documentStore.atom<Loadable<string>>({
		key: `islandText`,
		default: () => Promise.resolve(`document loaded`),
	})
	function Document() {
		const getText = useLoadable(islandTextAtom, `pending`)
		return <p>{getText().value}</p>
	}
	const result = await createRenderer(true).renderToStaticMarkup(
		() => (
			<Root store={documentStore.store}>
				<Document />
			</Root>
		),
		{},
		{},
	)
	expect(result.html).toContain(`document loaded`)
	expect(result.attrs?.[`data-spa-reads`]).toBeUndefined()
})
