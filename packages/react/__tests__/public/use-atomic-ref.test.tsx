import { StoreProvider, useAtomicRef } from "@atom.io/react"
import { cleanup, render } from "@testing-library/react"
import { atom, atomFamily, disposeState, getState, Silo } from "atom.io"
import { IMPLICIT, seekInStore } from "atom.io/internal"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { useRef } from "react"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
})

afterEach(cleanup)

it.each([`atom`, `family`] as const)(
	`tracks conditional and replaced hosts without republishing unchanged nodes (%s)`,
	(overload) => {
		const published = vi.fn()
		const nodeAtom = atom<HTMLDivElement | null>({
			key: `node`,
			default: null,
			effects: [
				({ onSet }) => {
					onSet(published)
				},
			],
		})
		const nodeAtoms = atomFamily<HTMLDivElement | null, string>({
			key: `node`,
			default: null,
			effects: () => [
				({ onSet }) => {
					onSet(published)
				},
			],
		})
		const useNodeRef =
			overload === `atom`
				? () => useAtomicRef(nodeAtom, useRef)
				: () => useAtomicRef(nodeAtoms, `view`, useRef)
		function View({
			visible,
			hostKey = `first`,
		}: {
			visible: boolean
			hostKey?: string
		}) {
			const ref = useNodeRef()
			return visible ? <div key={hostKey} ref={ref} /> : null
		}
		const read = () =>
			overload === `atom` ? getState(nodeAtom) : getState(nodeAtoms, `view`)
		const view = render(<View visible={false} />)
		expect(read()).toBeNull()
		view.rerender(<View visible />)
		const first = view.container.firstChild
		expect(read()).toBe(first)
		published.mockClear()
		view.rerender(<View visible />)
		expect(published).not.toHaveBeenCalled()
		view.rerender(<View visible hostKey="second" />)
		const second = view.container.firstChild
		expect(second).not.toBe(first)
		expect(read()).toBe(second)
		view.rerender(<View visible={false} />)
		expect(read()).toBeNull()
		view.rerender(<View visible />)
		expect(read()).toBe(view.container.firstChild)
		view.unmount()
		expect(read()).toBeNull()
	},
)

it(`does not recreate a family member disposed before unmount`, () => {
	const initialize = vi.fn()
	const dispose = vi.fn()
	const nodeAtoms = atomFamily<HTMLDivElement | null, string>({
		key: `node`,
		default: null,
		effects: () => [
			() => {
				initialize()
				return dispose
			},
		],
	})
	function View() {
		const ref = useAtomicRef(nodeAtoms, `view`, useRef)
		return <div ref={ref} />
	}
	const view = render(<View />)
	expect(initialize).toHaveBeenCalledTimes(1)
	disposeState(nodeAtoms, `view`)
	expect(seekInStore(IMPLICIT.STORE, nodeAtoms, `view`)).toBeUndefined()
	view.unmount()
	expect(seekInStore(IMPLICIT.STORE, nodeAtoms, `view`)).toBeUndefined()
	expect(initialize).toHaveBeenCalledTimes(1)
	expect(dispose).toHaveBeenCalledTimes(1)
})

it(`releases and reacquires a resource during StrictMode replay`, () => {
	const transitions: (HTMLDivElement | null)[] = []
	let active = 0
	const nodeAtom = atom<HTMLDivElement | null>({
		key: `node`,
		default: null,
		effects: [
			({ onSet }) => {
				onSet(({ oldValue, newValue }) => {
					if (oldValue) --active
					if (newValue) ++active
					transitions.push(newValue)
				})
			},
		],
	})
	function View() {
		const ref = useAtomicRef(nodeAtom, useRef)
		return <div ref={ref} />
	}
	const view = render(<View />, { reactStrictMode: true })
	const node = view.container.firstChild
	expect(transitions).toEqual([node, null, node])
	expect(active).toBe(1)
	view.rerender(<View />)
	expect(transitions).toEqual([node, null, node])
	view.unmount()
	expect(transitions).toEqual([node, null, node, null])
	expect(active).toBe(0)
})

it(`clears the old store before publishing into a replacement provider`, () => {
	const first = new Silo({
		name: `first`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const second = new Silo({
		name: `second`,
		lifespan: `ephemeral`,
		isProduction: false,
	})
	const options = { key: `node`, default: null }
	const nodeAtom = first.atom<HTMLDivElement | null>(options)
	second.atom<HTMLDivElement | null>(options)
	function View() {
		const ref = useAtomicRef(nodeAtom, useRef)
		return <div ref={ref} />
	}
	const view = render(
		<StoreProvider store={first.store}>
			<View />
		</StoreProvider>,
	)
	const node = view.container.firstChild
	expect(first.getState(nodeAtom)).toBe(node)
	view.rerender(
		<StoreProvider store={second.store}>
			<View />
		</StoreProvider>,
	)
	expect(first.getState(nodeAtom)).toBeNull()
	expect(second.getState(nodeAtom)).toBe(node)
	view.unmount()
	expect(second.getState(nodeAtom)).toBeNull()
})
