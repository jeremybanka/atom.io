import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { hydrate, onCleanup, onMount, render, useGetter } from "../src/index.ts"
import { createSceneRenderer, sceneComponent } from "../src/renderer.ts"
import { renderToString } from "../src/server.ts"

type RowKey = readonly [number, string]

const storeConfig = { lifespan: `ephemeral`, isProduction: true } as const

it.each([`render`, `hydrate`] as const)(
	`pins a direct component's key through %s and replaces it when identity changes`,
	(mode) => {
		const silo = new Silo({ name: `identity`, ...storeConfig })
		const original: RowKey = [1, `a`]
		const selectionAtom = silo.atom<RowKey | null | undefined>({
			key: `selection`,
			default: original,
		})
		const labelAtom = silo.atom<string>({ key: `label`, default: `first` })
		const rowAtoms = silo.atomFamily<string, RowKey | null>({
			key: `row`,
			default: (key) => (key === null ? `null` : key.join(`:`)),
		})
		const setup = vi.fn()
		const mounted = vi.fn()
		const cleanup = vi.fn()
		function Row(props: { key: RowKey | null | undefined; title: string }) {
			const key = props.key
			const read =
				key === undefined ? () => `positional` : useGetter(rowAtoms, key)
			setup(key)
			onMount(() => mounted(props.key))
			onCleanup(() => cleanup(props.key))
			return (
				<li {...props} data-original={String(props.key === key)}>
					{read()}
				</li>
			)
		}
		const app = () => {
			const getSelection = useGetter(selectionAtom)
			const getLabel = useGetter(labelAtom)
			return <Row key={getSelection()} title={getLabel()} />
		}
		const host = document.createElement(`div`)
		const options = { store: silo.store }
		if (mode === `hydrate`) {
			host.innerHTML = renderToString(app, options)
			expect(setup.mock.calls[0][0]).toBe(original)
			expect(cleanup.mock.calls[0][0]).toBe(original)
			expect(mounted).not.toHaveBeenCalled()
			setup.mockClear()
			cleanup.mockClear()
		}
		const serverNode = host.firstElementChild
		const root = (mode === `hydrate` ? hydrate : render)(app, host, options)
		try {
			const first = host.firstElementChild!
			if (serverNode) expect(first).toBe(serverNode)
			expect(first.textContent).toBe(`1:a`)
			expect(first.hasAttribute(`key`)).toBe(false)
			expect(setup.mock.calls[0][0]).toBe(original)
			expect(mounted.mock.calls[0][0]).toBe(original)

			silo.setState(selectionAtom, [1, `a`])
			silo.setState(labelAtom, `updated`)
			root.flush()
			expect(host.firstElementChild).toBe(first)
			expect(first.getAttribute(`data-original`)).toBe(`true`)
			expect(first.getAttribute(`title`)).toBe(`updated`)
			expect(setup).toHaveBeenCalledTimes(1)

			silo.setState(selectionAtom, null)
			root.flush()
			const second = host.firstElementChild
			expect(second).not.toBe(first)
			expect(second?.textContent).toBe(`null`)
			expect(cleanup.mock.calls[0][0]).toBe(original)

			silo.setState(selectionAtom, undefined)
			root.flush()
			expect(host.firstElementChild).not.toBe(second)
			expect(host.textContent).toBe(`positional`)
			expect(cleanup.mock.calls).toEqual([[original], [null]])
			expect(mounted.mock.calls).toEqual([[original], [null], [undefined]])
		} finally {
			root.dispose()
		}
	},
)

it(`reorders canonically keyed DOM siblings without replacing them`, () => {
	const silo = new Silo({ name: `rows`, ...storeConfig })
	const reverseAtom = silo.atom<boolean>({ key: `reverse`, default: false })
	function App() {
		const reversed = useGetter(reverseAtom)
		function rows() {
			const children = [
				<li key={[1, `a`]}>tuple a</li>,
				<li key={[1, `b`]}>tuple b</li>,
				<li key={1}>number</li>,
				<li key="1">string</li>,
				<li key={false}>boolean</li>,
				<li key={null}>null</li>,
			]
			return reversed() ? children.reverse() : children
		}
		return <ul>{rows()}</ul>
	}
	const host = document.createElement(`div`)
	const root = render(() => <App />, host, { store: silo.store })
	try {
		const before = [...host.querySelectorAll(`li`)]
		expect(before).toHaveLength(6)
		silo.setState(reverseAtom, true)
		root.flush()
		const after = [...host.querySelectorAll(`li`)]
		for (const [index, node] of before.reverse().entries())
			expect(after[index]).toBe(node)
	} finally {
		root.dispose()
	}
})

it(`tracks a key added by a spread on direct component output`, () => {
	const silo = new Silo({ name: `spread`, ...storeConfig })
	const attrsAtom = silo.atom<{ key?: null }>({ key: `attrs`, default: {} })
	const host = document.createElement(`div`)
	const cleanup = vi.fn()
	function Label(props: { key?: null }) {
		onCleanup(() => cleanup({ ...props }, props.key))
		return <span {...props} />
	}
	function App() {
		const getAttrs = useGetter(attrsAtom)
		return <Label {...getAttrs()} />
	}
	const root = render(() => <App />, host, { store: silo.store })
	try {
		const first = host.firstElementChild
		silo.setState(attrsAtom, { key: null })
		root.flush()
		expect(host.firstElementChild).not.toBe(first)
		expect(cleanup).toHaveBeenCalledWith({}, undefined)
	} finally {
		root.dispose()
	}
})

it(`rejects duplicate keys forwarded to siblings in DOM and server output`, () => {
	function Duplicate(props: { key: RowKey }) {
		const forwarded: { key?: RowKey } = props
		return [<li {...props} />, <li key={[2, `b`]} {...forwarded} />]
	}
	const app = () => <Duplicate key={[1, `a`]} />
	expect(() => render(app, document.createElement(`div`))).toThrow(
		`duplicate key`,
	)
	expect(() => renderToString(app)).toThrow(`duplicate key`)
})

it(`replaces a static scene component by key and preserves equal tuples`, () => {
	interface Node {
		children: Node[]
	}
	const renderer = createSceneRenderer<Node>({
		create: () => ({ children: [] }),
		update: () => {},
		children(parent, children) {
			parent.children = children
		},
		destroy: () => {},
	})
	const Group = sceneComponent<object>(`group`)
	const silo = new Silo({ name: `scene`, ...storeConfig })
	const original: RowKey = [1, `a`]
	const selectionAtom = silo.atom<RowKey | null>({
		key: `selection`,
		default: original,
	})
	const parent: Node = { children: [] }
	const lifecycle = vi.fn()
	function Leaf(props: { key: RowKey | null }) {
		lifecycle(`setup`, props.key)
		onMount(() => lifecycle(`mount`, props.key))
		onCleanup(() => lifecycle(`cleanup`, props.key))
		return <Group {...props} />
	}
	const root = renderer.render(
		() => {
			const getSelection = useGetter(selectionAtom)
			return <Leaf key={getSelection()} />
		},
		parent,
		{ store: silo.store },
	)
	try {
		const first = parent.children[0]
		silo.setState(selectionAtom, [1, `a`])
		root.flush()
		expect(parent.children).toHaveLength(1)
		expect(parent.children[0]).toBe(first)
		expect(lifecycle.mock.calls).toEqual([
			[`setup`, original],
			[`mount`, original],
		])

		silo.setState(selectionAtom, null)
		root.flush()
		expect(parent.children).toHaveLength(1)
		expect(parent.children[0]).not.toBe(first)
		expect(lifecycle).toHaveBeenCalledWith(`setup`, null)
		expect(lifecycle).toHaveBeenCalledWith(`mount`, null)
		expect(
			lifecycle.mock.calls.find(([event]) => event === `cleanup`)?.[1],
		).toBe(original)
	} finally {
		root.dispose()
	}
})
