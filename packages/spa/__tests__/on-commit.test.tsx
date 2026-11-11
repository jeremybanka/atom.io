import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import type { Capability, SpaRoot } from "../src/index.ts"
import {
	onCommit,
	onMount,
	render,
	Root,
	useGetter,
	useSetter,
} from "../src/index.ts"
import { jsx } from "../src/jsx-runtime.ts"
import { createPresence } from "../src/presence.ts"
import { createSceneRenderer } from "../src/renderer.ts"
import { renderToString } from "../src/server.ts"

function makeSilo() {
	return new Silo({
		name: `onCommit`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
}

afterEach(() => {
	vi.unstubAllEnvs()
})

it(`observes refs, sibling DOM and restored controls, then flushes derived writes`, () => {
	const silo = makeSilo()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const sizeAtom = silo.atom<number>({ key: `size`, default: 0 })
	const noiseAtom = silo.atom<number>({ key: `noise`, default: 0 })
	const host = document.createElement(`main`)
	const snapshots: unknown[] = []
	const committedSizes: string[] = []
	const release = vi.fn()
	function Measure() {
		const getCount = useGetter(countAtom)
		const getNoise = useGetter(noiseAtom)
		const setSize = useSetter(sizeAtom)
		let element: HTMLParagraphElement | null = null
		onCommit(
			() => Math.floor(getCount()),
			(value, previous) => {
				getNoise()
				snapshots.push([
					value,
					previous,
					element!.textContent,
					host.querySelector(`aside`)!.textContent,
					host.querySelector(`select`)!.value,
				])
				setSize(element!.textContent.length)
				return () => release(value)
			},
		)
		return (
			<p
				ref={(node) => {
					element = node
				}}
			>
				{getCount()}
			</p>
		)
	}
	function Siblings() {
		const getCount = useGetter(countAtom)
		const getSize = useGetter(sizeAtom)
		onCommit(getSize, () => {
			committedSizes.push(host.querySelector(`output`)!.textContent)
		})
		return (
			<>
				<aside>count {getCount()}</aside>
				<select value="b">
					<option value="a">A</option>
					{getCount() > 0 && <option value="b">B</option>}
				</select>
				<output>{getSize()}</output>
			</>
		)
	}
	const root = render(
		() => (
			<>
				<Measure />
				<Siblings />
			</>
		),
		host,
		{ store: silo.store },
	)
	expect(snapshots).toEqual([[0, undefined, `0`, `count 0`, `a`]])
	silo.setState(countAtom, 12)
	root.flush()
	expect(snapshots.at(-1)).toEqual([12, 0, `12`, `count 12`, `b`])
	expect(host.querySelector(`output`)!.textContent).toBe(`2`)
	expect(committedSizes).toEqual([`0`, `1`, `2`])
	expect(release.mock.calls).toEqual([[0]])
	silo.setState(noiseAtom, 1)
	expect(silo.store.atoms.get(noiseAtom.key)!.subject.subscribers.size).toBe(0)
	silo.setState(countAtom, 12.5)
	root.flush()
	expect(snapshots).toHaveLength(2)
	root.dispose()
	expect(release.mock.calls).toEqual([[0], [12]])
})

it.each([true, false])(
	`measures the input after restoration when it is controlled (controlled=%s)`,
	async (controlled) => {
		const silo = makeSilo()
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const host = document.createElement(`main`)
		const snapshots: [number, string][] = []
		const edits: string[] = []
		let root: SpaRoot
		function App() {
			const getCount = useGetter(countAtom)
			const setCount = useSetter(countAtom)
			onCommit(getCount, (count) => {
				snapshots.push([count, host.querySelector(`input`)!.value])
			})
			return (
				<>
					<input
						value={controlled ? `saved` : undefined}
						defaultValue={controlled ? undefined : `saved`}
						onInput={(event) => {
							setCount(1)
							root.flush()
							edits.push(
								event.currentTarget.value,
								host.querySelector(`output`)!.textContent,
							)
						}}
					/>
					<output>{getCount()}</output>
				</>
			)
		}
		root = render(() => <App />, host, { store: silo.store })
		const input = host.querySelector(`input`)!
		try {
			input.value = `rejected`
			input.dispatchEvent(new InputEvent(`input`, { bubbles: true }))
			expect(edits).toEqual([`rejected`, `1`])
			expect(snapshots).toEqual(
				controlled
					? [[0, `saved`]]
					: [
							[0, `saved`],
							[1, `rejected`],
						],
			)

			await Promise.resolve()
			const value = controlled ? `saved` : `rejected`
			expect(input.value).toBe(value)
			expect(snapshots).toEqual([
				[0, `saved`],
				[1, value],
			])
		} finally {
			root.dispose()
		}
	},
)

it.each([true, false])(
	`runs after mounts and capability commits in child-first order (dev=%s)`,
	(dev) => {
		vi.stubEnv(`DEV`, dev)
		const calls: string[] = []
		const capability: Capability = {
			namespace: `probe`,
			attach: () => ({ update: () => {}, dispose: () => {} }),
			beforeUpdate: () => () => {
				calls.push(`capability`)
			},
		}
		const scopedCapability: Capability = {
			...capability,
			namespace: `scoped`,
			beforeUpdate: () => () => {
				calls.push(`scoped capability`)
			},
		}
		const callback = (label: string) => {
			onCommit(
				() => undefined,
				() => {
					calls.push(label)
				},
			)
		}
		function Child() {
			onMount(() => {
				calls.push(`mount`)
			})
			callback(`child`)
			return null
		}
		function Parent() {
			callback(`parent first`)
			callback(`parent second`)
			return <Child />
		}
		function Sibling() {
			callback(`sibling`)
			return null
		}
		const host = document.createElement(`main`)
		const root = render(
			() => (
				<>
					<Root capabilities={[scopedCapability]}>
						<Parent />
					</Root>
					<Sibling />
				</>
			),
			host,
			{ capabilities: [capability] },
		)
		expect(calls).toEqual([
			`mount`,
			`capability`,
			`scoped capability`,
			`child`,
			`parent first`,
			`parent second`,
			`sibling`,
		])
		root.dispose()
	},
)

it(`preserves sibling setup order when only a late descendant has pending work in the first branch`, () => {
	const silo = makeSilo()
	const shownAtom = silo.atom<boolean>({ key: `shown`, default: false })
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const parentAtom = silo.atom<number>({ key: `parent`, default: 0 })
	const calls: string[] = []
	function Child() {
		onCommit(useGetter(countAtom), () => {
			calls.push(`child`)
		})
		return null
	}
	function First() {
		const getShown = useGetter(shownAtom)
		onCommit(useGetter(parentAtom), () => {
			calls.push(`first`)
		})
		return <>{getShown() && <Child />}</>
	}
	function Second() {
		onCommit(useGetter(countAtom), () => {
			calls.push(`second`)
		})
		return null
	}
	const root = render(
		() => (
			<>
				<First />
				<Second />
			</>
		),
		document.createElement(`main`),
		{ store: silo.store },
	)
	try {
		silo.setState(shownAtom, true)
		root.flush()
		expect(calls.splice(0)).toEqual([`first`, `second`, `child`])

		silo.setState(countAtom, 1)
		root.flush()
		expect(calls.splice(0)).toEqual([`child`, `second`])

		silo.setState(parentAtom, 1)
		silo.setState(countAtom, 2)
		root.flush()
		expect(calls).toEqual([`child`, `first`, `second`])
	} finally {
		root.dispose()
	}
})

it(`flushes DOM writes inside onMount before running onCommit`, () => {
	const silo = makeSilo()
	const shownAtom = silo.atom<boolean>({ key: `shown`, default: false })
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const host = document.createElement(`main`)
	const calls: string[] = []
	let root: SpaRoot
	function Child() {
		const getCount = useGetter(countAtom)
		const setCount = useSetter(countAtom)
		onMount(() => {
			setCount(1)
			root.flush()
			calls.push(`mount ${host.querySelector(`output`)!.textContent}`)
		})
		onCommit(getCount, (count) => {
			calls.push(`commit ${count}`)
		})
		return <output>{getCount()}</output>
	}
	function App() {
		const getShown = useGetter(shownAtom)
		return <>{getShown() && <Child />}</>
	}
	root = render(() => <App />, host, { store: silo.store })
	silo.setState(shownAtom, true)
	root.flush()
	expect(calls).toEqual([`mount 1`, `commit 1`])
	root.dispose()
})

it(`does not apply while a scope is retained for exit and catches up on reentry`, () => {
	const silo = makeSilo()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const shownAtom = silo.atom<boolean>({ key: `shown`, default: true })
	const apply = vi.fn()
	const release = vi.fn()
	const capability: Capability = {
		namespace: `pending`,
		presence: createPresence,
		attach: () => ({
			update: () => {},
			dispose: () => {},
			exit: () => ({ finished: new Promise<void>(() => {}), cancel: () => {} }),
		}),
	}
	function Child() {
		onCommit(useGetter(countAtom), (value, previous) => {
			apply(value, previous)
			return release
		})
		return jsx(`input`, { value: `saved`, "pending:exit": true })
	}
	function App() {
		const shown = useGetter(shownAtom)
		return <>{shown() ? <Child key="child" /> : null}</>
	}
	const host = document.createElement(`main`)
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [capability],
	})
	const input = host.querySelector(`input`)!
	input.value = `edit`
	silo.setState(countAtom, 1)
	silo.setState(shownAtom, false)
	root.flush()
	expect(input.hasAttribute(`inert`)).toBe(true)
	expect(input.value).toBe(`edit`)
	expect(apply.mock.calls).toEqual([[0, undefined]])
	expect(release).not.toHaveBeenCalled()
	silo.setState(countAtom, 2)
	silo.setState(shownAtom, true)
	root.flush()
	expect(input.value).toBe(`saved`)
	expect(apply.mock.calls).toEqual([
		[0, undefined],
		[2, 0],
	])
	expect(release).toHaveBeenCalledOnce()
	root.dispose()
	expect(release).toHaveBeenCalledTimes(2)
})

it.each([`cleanup`, `apply`])(
	`disposes exactly once when a %s callback removes the root`,
	(phase) => {
		const silo = makeSilo()
		const countAtom = silo.atom<number>({ key: `count`, default: 0 })
		const release = vi.fn()
		const apply = vi.fn()
		const later = vi.fn()
		let root: SpaRoot
		function App() {
			const getCount = useGetter(countAtom)
			onCommit(getCount, (value) => {
				apply(value)
				if (value) {
					root.flush()
					root.dispose()
				}
				return () => {
					release(value)
					if (phase === `cleanup` && getCount()) root.dispose()
				}
			})
			onCommit(getCount, (value) => {
				later(value)
			})
			return <output>{getCount()}</output>
		}
		const host = document.createElement(`main`)
		root = render(() => <App />, host, { store: silo.store })
		silo.setState(countAtom, 1)
		root.flush()
		const values = phase === `cleanup` ? [[0]] : [[0], [1]]
		expect(apply.mock.calls).toEqual(values)
		expect(release.mock.calls).toEqual(values)
		expect(later.mock.calls).toEqual([[0]])
		expect(host.childNodes).toHaveLength(0)
		root.dispose()
	},
)

it(`runs after scene host updates and skips all commit work on the server`, () => {
	const silo = makeSilo()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	interface Node {
		value: number
		children: Node[]
	}
	const parent: Node = { value: -1, children: [] }
	const scene = createSceneRenderer<Node>({
		create: () => ({ value: -1, children: [] }),
		update: (node, props) => {
			node.value = props[`value`]
		},
		children: (node, children) => {
			node.children = children
		},
		destroy: () => {},
	})
	const read = vi.fn()
	const apply = vi.fn()
	function Item() {
		const getCount = useGetter(countAtom)
		onCommit(
			() => {
				read()
				return getCount()
			},
			() => {
				apply(parent.children[0]?.value)
			},
		)
		return jsx(`item`, {
			get value() {
				return getCount()
			},
		})
	}
	renderToString(() => <Item />, { store: silo.store })
	expect(read).not.toHaveBeenCalled()
	expect(apply).not.toHaveBeenCalled()
	const root = scene.render(() => <Item />, parent, { store: silo.store })
	silo.setState(countAtom, 9)
	root.flush()
	expect(apply.mock.calls).toEqual([[0], [9]])
	root.dispose()
})

it(`identifies the component that keeps scheduling updates in development`, () => {
	const silo = makeSilo()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	function Feedback() {
		const getCount = useGetter(countAtom)
		const setCount = useSetter(countAtom)
		onCommit(getCount, (value) => {
			setCount(value + 1)
		})
		return null
	}
	function Observer() {
		onCommit(useGetter(countAtom), () => {})
		return null
	}
	const host = document.createElement(`main`)
	let failure: unknown
	try {
		render(
			() => (
				<>
					<Feedback />
					<Observer />
				</>
			),
			host,
			{ store: silo.store },
		)
	} catch (error) {
		failure = error
	}
	expect(failure).toMatchObject({
		message: `spa: onCommit update loop`,
		stack: expect.stringContaining(`Feedback`),
	})
	expect(host.childNodes).toHaveLength(0)
})

it(`identifies feedback when its observers are already queued`, () => {
	const silo = makeSilo()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const derivedAtom = silo.atom<number>({ key: `derived`, default: 0 })
	function Derived() {
		const getCount = useGetter(countAtom)
		const getDerived = useGetter(derivedAtom)
		const setDerived = useSetter(derivedAtom)
		onCommit(
			() => {
				getDerived()
				return getCount()
			},
			(count) => {
				setDerived(count + 1)
			},
		)
		return null
	}
	function Feedback() {
		const getCount = useGetter(countAtom)
		const getDerived = useGetter(derivedAtom)
		const setCount = useSetter(countAtom)
		onCommit(
			() => {
				getDerived()
				return getCount()
			},
			(count) => {
				setCount(count + 1)
			},
		)
		return null
	}
	const host = document.createElement(`main`)
	expect(() =>
		render(
			() => (
				<>
					<Derived />
					<Feedback />
				</>
			),
			host,
			{ store: silo.store },
		),
	).toThrow(
		expect.objectContaining({
			message: `spa: onCommit update loop`,
			stack: expect.stringContaining(`Feedback`),
		}),
	)
	expect(host.childNodes).toHaveLength(0)
})
