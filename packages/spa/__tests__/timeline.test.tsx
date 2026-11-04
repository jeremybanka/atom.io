import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import type { SpaRoot, TimelineControls } from "../src/index.ts"
import { render, useGetter, useTimeline } from "../src/index.ts"

const roots: SpaRoot[] = []
afterEach(() => {
	for (const root of roots.splice(0)) root.dispose()
	document.body.replaceChildren()
})

function fixture() {
	const silo = new Silo({
		name: `timeline`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const historyTimeline = silo.timeline({ key: `history`, scope: [countAtom] })
	silo.getState(countAtom)
	silo.clearTimeline(historyTimeline)
	const host = document.createElement(`section`)
	document.body.append(host)
	const mount = (setup: Parameters<typeof render>[0]) => {
		const root = render(setup, host, { store: silo.store })
		roots.push(root)
		return root
	}
	const subscribers = () =>
		silo.store.timelines.get(historyTimeline.key)!.subject.subscribers.size
	return { silo, countAtom, historyTimeline, host, mount, subscribers }
}

it(`supports destructured readers and commands with current, store-bound values`, () => {
	const { silo, countAtom, historyTimeline, host, mount, subscribers } =
		fixture()
	const setup = vi.fn()
	let history!: TimelineControls
	let snapshot = -1
	const root = mount(() => {
		setup()
		history = useTimeline(historyTimeline)
		const { getCursor, getLength, undo, redo } = history
		snapshot = getCursor()
		expect(subscribers()).toBe(0)
		return (
			<>
				<output>{`${getCursor()}/${getLength()}`}</output>
				<button onClick={undo}>Undo</button>
				<button onClick={redo}>Redo</button>
			</>
		)
	})
	expect(history).toBeTypeOf(`object`)
	expect(subscribers()).toBe(1)
	const { getCursor, getLength, clear } = history
	silo.setState(countAtom, 1)
	silo.setState(countAtom, 2)
	expect(getCursor()).toBe(2)
	expect(getLength()).toBe(2)
	expect(snapshot).toBe(0)
	root.flush()
	expect(host.querySelector(`output`)!.textContent).toBe(`2/2`)
	host.querySelectorAll(`button`)[0].click()
	root.flush()
	expect(host.querySelector(`output`)!.textContent).toBe(`1/2`)
	expect(silo.getState(countAtom)).toBe(1)
	host.querySelectorAll(`button`)[1].click()
	root.flush()
	expect(host.querySelector(`output`)!.textContent).toBe(`2/2`)
	expect(silo.getState(countAtom)).toBe(2)
	clear()
	root.flush()
	expect(host.querySelector(`output`)!.textContent).toBe(`0/0`)
	expect(setup).toHaveBeenCalledOnce()
	root.dispose()
	expect(subscribers()).toBe(0)
})

it(`captures transaction groups when readers are called and preserves diverged timelines`, () => {
	const { silo, countAtom, historyTimeline, mount, subscribers } = fixture()
	const otherAtom = silo.atom<number>({ key: `other`, default: 0 })
	const otherTimeline = silo.timeline({ key: `other`, scope: [otherAtom] })
	silo.getState(otherAtom)
	silo.clearTimeline(otherTimeline)
	const changeBothTransaction = silo.transaction<(value: number) => void>({
		key: `changeBoth`,
		do: ({ set }, value) => {
			set(countAtom, value)
			set(otherAtom, value)
		},
	})
	let history!: TimelineControls
	mount(() => {
		history = useTimeline(historyTimeline)
		return null
	})
	const { undo, redo } = history
	const { getTransaction: getUndoTransaction } = undo
	const { getTransaction: getRedoTransaction } = redo
	expect(getUndoTransaction()).toBeUndefined()
	expect(getRedoTransaction()).toBeUndefined()
	undo.getTransaction()?.()
	redo.getTransaction()?.()
	expect(silo.getState(countAtom)).toBe(0)
	const change = silo.runTransaction(changeBothTransaction)
	change(1)
	const undoFirst = getUndoTransaction()
	change(2)
	undoFirst?.()
	expect(silo.getState(countAtom)).toBe(2)
	expect(silo.getState(otherAtom)).toBe(2)
	const undoSecond = getUndoTransaction()
	expect(undoSecond).toBeTypeOf(`function`)
	undoSecond?.()
	expect(silo.getState(countAtom)).toBe(1)
	expect(silo.getState(otherAtom)).toBe(1)
	undoSecond?.()
	expect(silo.getState(countAtom)).toBe(1)
	expect(silo.getState(otherAtom)).toBe(1)
	undo.getTransaction()?.()
	expect(silo.getState(countAtom)).toBe(0)
	expect(silo.getState(otherAtom)).toBe(0)
	expect(getUndoTransaction()).toBeUndefined()
	const redoFirst = getRedoTransaction()
	expect(redoFirst).toBeTypeOf(`function`)
	redoFirst?.()
	expect(silo.getState(countAtom)).toBe(1)
	expect(silo.getState(otherAtom)).toBe(1)
	redoFirst?.()
	expect(silo.getState(countAtom)).toBe(1)
	expect(silo.getState(otherAtom)).toBe(1)
	redo.getTransaction()?.()
	expect(silo.getState(countAtom)).toBe(2)
	expect(silo.getState(otherAtom)).toBe(2)
	expect(getRedoTransaction()).toBeUndefined()
	const undoSecondAgain = getUndoTransaction()
	silo.setState(countAtom, 7)
	expect(getUndoTransaction()).toBeUndefined()
	undo.getTransaction()?.()
	expect(silo.getState(countAtom)).toBe(7)
	expect(silo.getState(otherAtom)).toBe(2)
	undoSecondAgain?.()
	expect(silo.getState(countAtom)).toBe(7)
	expect(silo.getState(otherAtom)).toBe(1)
	history.undo()
	expect(getUndoTransaction()).toBeTypeOf(`function`)
	expect(subscribers()).toBe(0)
})

it(`tracks transaction availability and releases conditional dependencies`, () => {
	const { silo, countAtom, historyTimeline, host, mount, subscribers } =
		fixture()
	const visibleAtom = silo.atom<boolean>({ key: `visible`, default: true })
	const changeTransaction = silo.transaction<() => void>({
		key: `change`,
		do: ({ set }) => {
			set(countAtom, 1)
		},
	})
	let history!: TimelineControls
	const root = mount(() => {
		const visible = useGetter(visibleAtom)
		history = useTimeline(historyTimeline)
		const { undo, redo } = history
		return (
			<output>
				{visible()
					? `${undo.getTransaction() !== undefined}/${redo.getTransaction() !== undefined}`
					: `hidden`}
			</output>
		)
	})
	expect(host.textContent).toBe(`false/false`)
	expect(subscribers()).toBe(1)
	silo.runTransaction(changeTransaction)()
	root.flush()
	expect(host.textContent).toBe(`true/false`)
	history.undo.getTransaction()?.()
	root.flush()
	expect(host.textContent).toBe(`false/true`)
	history.redo.getTransaction()?.()
	root.flush()
	expect(host.textContent).toBe(`true/false`)
	silo.setState(visibleAtom, false)
	root.flush()
	expect(host.textContent).toBe(`hidden`)
	expect(subscribers()).toBe(0)
})
