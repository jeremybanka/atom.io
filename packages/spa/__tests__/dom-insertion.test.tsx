import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { onCleanup, render, type SpaElement, useGetter } from "../src/index.ts"

it.each([0, 1, 3])(
	`inserts at position %i without moving existing keyed ranges`,
	(position) => {
		const silo = new Silo({
			name: `insertion`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const idsAtom = silo.atom<string[]>({ key: `ids`, default: [`a`, `b`, `c`] })
		const showAtom = silo.atom<boolean>({ key: `show`, default: false })
		const setups = vi.fn()
		const cleanups = vi.fn()
		function Row(props: { id: string }) {
			setups(props.id)
			onCleanup(() => {
				cleanups(props.id)
			})
			return (
				<li data-id={props.id}>
					<input value={props.id} />
					<span>{props.id}</span>
				</li>
			)
		}
		function App() {
			const getIds = useGetter(idsAtom)
			const getShow = useGetter(showAtom)
			return (
				<ul>
					{getShow() ? <li>conditional</li> : null}
					{getIds().map((id) => (
						<Row key={id} id={id} />
					))}
				</ul>
			)
		}
		const host = document.createElement(`main`)
		document.body.append(host)
		const root = render(() => <App />, host, { store: silo.store })
		const list = host.querySelector(`ul`)!
		const rows = [...host.querySelectorAll(`li`)]
		const input = rows[1].querySelector(`input`)!
		rows[1].scrollTop = 42
		input.focus()
		input.setSelectionRange(1, 1)
		const mutations = new MutationObserver(() => {})
		mutations.observe(list, { childList: true })
		const extracts = vi.spyOn(Range.prototype, `extractContents`)
		const unmoved = () => {
			expect(extracts).not.toHaveBeenCalled()
			const removed = mutations
				.takeRecords()
				.flatMap((record) => [...record.removedNodes])
			for (const row of rows) expect(removed).not.toContain(row)
			expect(document.activeElement).toBe(input)
			expect(input.selectionStart).toBe(1)
			expect(rows[1].scrollTop).toBe(42)
		}
		try {
			const ids = [`a`, `b`, `c`]
			ids.splice(position, 0, `extra`)
			silo.setState(idsAtom, ids)
			root.flush()
			expect(
				[...list.querySelectorAll(`li`)].map((row) => row.dataset[`id`]),
			).toEqual(ids)
			unmoved()
			for (const show of [true, false, true, false]) {
				silo.setState(showAtom, show)
				root.flush()
				unmoved()
			}
			silo.setState(idsAtom, [`a`, `b`, `c`])
			root.flush()
			unmoved()
			expect(setups).toHaveBeenCalledTimes(4)
			expect(cleanups).toHaveBeenCalledExactlyOnceWith(`extra`)
			silo.setState(idsAtom, [`c`, `b`, `a`])
			root.flush()
			expect([...list.querySelectorAll(`li`)]).toEqual([...rows].reverse())
			expect(document.activeElement).toBe(input)
			expect(setups).toHaveBeenCalledTimes(4)
		} finally {
			extracts.mockRestore()
			mutations.disconnect()
			root.dispose()
			host.remove()
		}
	},
)

it(`reorders reused JSX without refreshing unchanged subtrees and keeps their subscriptions live`, () => {
	const silo = new Silo({
		name: `reused-jsx`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const idsAtom = silo.atom<string[]>({ key: `ids`, default: [`a`, `b`] })
	const valueAtom = silo.atom<string>({ key: `value`, default: `before` })
	const reads = vi.fn()
	const mounts = vi.fn()
	const cleanups = vi.fn()
	function Row(props: { id: string }) {
		const getValue = useGetter(valueAtom)
		const label = () => {
			reads(props.id)
			return props.id
		}
		onCleanup(() => {
			cleanups(props.id)
		})
		return (
			<li
				data-id={props.id}
				ref={(node) => {
					if (node) mounts(node)
				}}
			>
				<span title={label()}>{getValue()}</span>
			</li>
		)
	}
	function App() {
		const getIds = useGetter(idsAtom)
		const cached = new Map<string, SpaElement>(
			[`a`, `b`].map((id) => {
				const node = <Row key={id} id={id} />
				Object.freeze(node.props)
				return [id, Object.freeze(node)]
			}),
		)
		return <ul>{getIds().map((id) => cached.get(id)!)}</ul>
	}
	const host = document.createElement(`main`)
	const root = render(() => <App />, host, { store: silo.store })
	try {
		const original = [...host.querySelectorAll(`li`)]
		const readCount = reads.mock.calls.length
		silo.setState(idsAtom, [`b`, `a`])
		root.flush()
		expect([...host.querySelectorAll(`li`)]).toEqual([...original].reverse())
		expect(reads).toHaveBeenCalledTimes(readCount)
		silo.setState(valueAtom, `after`)
		root.flush()
		expect(
			[...host.querySelectorAll(`span`)].map((node) => node.textContent),
		).toEqual([`after`, `after`])
		expect(reads).toHaveBeenCalledTimes(readCount)
		expect(mounts).toHaveBeenCalledTimes(2)
		expect(cleanups).not.toHaveBeenCalled()
	} finally {
		root.dispose()
	}
	expect(cleanups).toHaveBeenCalledTimes(2)
})

it.each([false, true])(
	`refreshes mutable JSX props when an atom publishes the same descriptor (outer frozen: %s)`,
	(freezeOuter) => {
		const silo = new Silo({
			name: `mutable-jsx`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const child: SpaElement = {
			type: `span`,
			props: { key: `one`, children: `before` },
		}
		if (freezeOuter) Object.freeze(child)
		const valuesAtom = silo.atom<SpaElement[]>({
			key: `values`,
			default: [child],
		})
		const host = document.createElement(`main`)
		const root = render(
			() => {
				const get = useGetter(valuesAtom)
				return () => get()
			},
			host,
			{ store: silo.store },
		)
		try {
			const original = host.querySelector(`span`)
			silo.setState(valuesAtom, (previous) => {
				child.props[`children`] = `after`
				return previous
			})
			root.flush()
			expect(host.querySelector(`span`)).toBe(original)
			expect(host.textContent).toBe(`after`)
		} finally {
			root.dispose()
		}
	},
)
