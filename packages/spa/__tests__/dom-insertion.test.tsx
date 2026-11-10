import { Silo } from "atom.io"
import { expect, it, vi } from "vitest"

import { onCleanup, render, useGetter } from "../src/index.ts"

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
