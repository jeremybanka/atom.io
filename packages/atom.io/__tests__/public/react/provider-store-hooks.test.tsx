import { act, fireEvent, render } from "@testing-library/react"
import {
	atom,
	atomFamily,
	mutableAtom,
	selector,
	selectorFamily,
	Silo,
} from "atom.io"
import { StoreProvider, useI, useO, useTL } from "atom.io/react"
import { takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { useLayoutEffect } from "react"

const { restore } = takeSnapshot()

beforeEach(restore)

const createSilo = (name: string) =>
	new Silo({ name, lifespan: `ephemeral`, isProduction: false })

describe(`provider store changes`, () => {
	it(`moves timeline controls to the next store when history metadata matches`, () => {
		const createState = (name: string) => {
			const silo = createSilo(name)
			const countAtom = silo.atom<number>({ key: `count`, default: 0 })
			const countTimeline = silo.timeline({
				key: `count`,
				scope: [countAtom],
			})
			silo.setState(countAtom, 1)
			return { silo, countAtom, countTimeline }
		}
		const uno = createState(`uno`)
		const dos = createState(`dos`)

		const Controls = () => {
			const countTimeline = useTL(uno.countTimeline)
			return (
				<button type="button" data-testid="undo" onClick={countTimeline.undo} />
			)
		}
		const view = (store: typeof uno.silo.store) => (
			<StoreProvider store={store}>
				<Controls />
			</StoreProvider>
		)
		const { getByTestId, rerender } = render(view(uno.silo.store))

		rerender(view(dos.silo.store))
		fireEvent.click(getByTestId(`undo`))

		expect(uno.silo.getState(uno.countAtom)).toBe(1)
		expect(dos.silo.getState(dos.countAtom)).toBe(0)
	})

	it(`moves standalone atom observation, subscription, and writes to the next store`, () => {
		const letterAtom = atom<string>({ key: `letter`, default: `A` })
		const uno = createSilo(`uno`)
		const dos = createSilo(`dos`)
		uno.install([letterAtom])
		dos.install([letterAtom])
		dos.setState(letterAtom, `B`)

		const Letter = () => {
			const letter = useO(letterAtom)
			const setLetter = useI(letterAtom)
			return (
				<>
					<div data-testid="value">{letter}</div>
					<button
						type="button"
						data-testid="set"
						onClick={() => {
							setLetter(`written`)
						}}
					/>
				</>
			)
		}
		const { getByTestId, rerender } = render(
			<StoreProvider store={uno.store}>
				<Letter />
			</StoreProvider>,
		)

		expect(getByTestId(`value`).textContent).toBe(`A`)
		rerender(
			<StoreProvider store={dos.store}>
				<Letter />
			</StoreProvider>,
		)
		expect(getByTestId(`value`).textContent).toBe(`B`)

		act(() => {
			uno.setState(letterAtom, `stale`)
		})
		expect(getByTestId(`value`).textContent).toBe(`B`)
		act(() => {
			dos.setState(letterAtom, `current`)
		})
		expect(getByTestId(`value`).textContent).toBe(`current`)

		fireEvent.click(getByTestId(`set`))
		expect(uno.getState(letterAtom)).toBe(`stale`)
		expect(dos.getState(letterAtom)).toBe(`written`)
	})

	it(`moves standalone selector observation to the next store`, () => {
		const countAtom = atom<number>({ key: `count`, default: 1 })
		const doubledSelector = selector<number>({
			key: `doubled`,
			get: ({ get }) => get(countAtom) * 2,
		})
		const uno = createSilo(`uno`)
		const dos = createSilo(`dos`)
		uno.install([countAtom, doubledSelector])
		dos.install([countAtom, doubledSelector])
		dos.setState(countAtom, 2)

		const Doubled = () => <div data-testid="value">{useO(doubledSelector)}</div>
		const { getByTestId, rerender } = render(
			<StoreProvider store={uno.store}>
				<Doubled />
			</StoreProvider>,
		)

		expect(getByTestId(`value`).textContent).toBe(`2`)
		rerender(
			<StoreProvider store={dos.store}>
				<Doubled />
			</StoreProvider>,
		)
		expect(getByTestId(`value`).textContent).toBe(`4`)

		act(() => {
			uno.setState(countAtom, 3)
		})
		expect(getByTestId(`value`).textContent).toBe(`4`)
		act(() => {
			dos.setState(countAtom, 4)
		})
		expect(getByTestId(`value`).textContent).toBe(`8`)
	})

	it(`moves atom and selector family members to the next store`, () => {
		const countAtoms = atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const doubledSelectors = selectorFamily<number, string>({
			key: `doubled`,
			get:
				(key) =>
				({ get }) =>
					get(countAtoms, key) * 2,
		})
		const uno = createSilo(`uno`)
		const dos = createSilo(`dos`)
		uno.install([countAtoms, doubledSelectors])
		dos.install([countAtoms, doubledSelectors])
		uno.setState(countAtoms, `member`, 1)
		dos.setState(countAtoms, `member`, 2)

		const Count = () => {
			const count = useO(countAtoms, `member`)
			const doubled = useO(doubledSelectors, `member`)
			const setCount = useI(countAtoms, `member`)
			return (
				<>
					<div data-testid="value">{`${count}:${doubled}`}</div>
					<button
						type="button"
						data-testid="set"
						onClick={() => {
							setCount(3)
						}}
					/>
				</>
			)
		}
		const { getByTestId, rerender } = render(
			<StoreProvider store={uno.store}>
				<Count />
			</StoreProvider>,
		)

		expect(getByTestId(`value`).textContent).toBe(`1:2`)
		rerender(
			<StoreProvider store={dos.store}>
				<Count />
			</StoreProvider>,
		)
		expect(getByTestId(`value`).textContent).toBe(`2:4`)

		fireEvent.click(getByTestId(`set`))
		expect(uno.getState(countAtoms, `member`)).toBe(1)
		expect(dos.getState(countAtoms, `member`)).toBe(3)
		expect(getByTestId(`value`).textContent).toBe(`3:6`)
	})

	it(`moves mutable atom values and subscriptions to the next store`, () => {
		const lettersAtom = mutableAtom<UList<string>>({
			key: `letters`,
			class: UList,
		})
		const uno = createSilo(`uno`)
		const dos = createSilo(`dos`)
		uno.install([lettersAtom])
		dos.install([lettersAtom])
		uno.setState(lettersAtom, (letters) => letters.add(`A`))
		dos.setState(lettersAtom, (letters) => letters.add(`B`))

		const Letters = () => (
			<div data-testid="value">{Array.from(useO(lettersAtom)).join(``)}</div>
		)
		const UpdatePreviousStore = () => {
			useLayoutEffect(() => {
				uno.setState(lettersAtom, (letters) => letters.add(`C`))
			}, [])
			return null
		}
		const { getByTestId, rerender } = render(
			<StoreProvider store={uno.store}>
				<Letters />
			</StoreProvider>,
		)

		expect(getByTestId(`value`).textContent).toBe(`A`)
		rerender(
			<StoreProvider store={dos.store}>
				<Letters />
				<UpdatePreviousStore />
			</StoreProvider>,
		)
		expect(getByTestId(`value`).textContent).toBe(`B`)

		act(() => {
			dos.setState(lettersAtom, (letters) => letters.add(`D`))
		})
		expect(getByTestId(`value`).textContent).toBe(`BD`)
	})

	it(`moves held selector values and subscriptions to the next store`, () => {
		const uno = createSilo(`uno`)
		const dos = createSilo(`dos`)
		const createHeldState = (silo: Silo) => {
			const countAtom = silo.atom<number>({ key: `count`, default: 1 })
			const heldSelector = silo.selector<{ count: number }>({
				key: `held`,
				const: { count: 0 },
				get: ({ get }, value) => {
					value.count = get(countAtom)
				},
				set: ({ set }, value) => {
					set(countAtom, value.count)
				},
			})
			return { countAtom, heldSelector }
		}
		const unoState = createHeldState(uno)
		const dosState = createHeldState(dos)
		dos.setState(dosState.countAtom, 2)

		const Count = ({ token }: { token: typeof unoState.heldSelector }) => (
			<div data-testid="value">{useO(token).count}</div>
		)
		const { getByTestId, rerender } = render(
			<StoreProvider store={uno.store}>
				<Count token={unoState.heldSelector} />
			</StoreProvider>,
		)

		expect(getByTestId(`value`).textContent).toBe(`1`)
		rerender(
			<StoreProvider store={dos.store}>
				<Count token={dosState.heldSelector} />
			</StoreProvider>,
		)
		expect(getByTestId(`value`).textContent).toBe(`2`)

		act(() => {
			uno.setState(unoState.heldSelector, (value) => {
				value.count = 3
				return value
			})
		})
		expect(getByTestId(`value`).textContent).toBe(`2`)
		act(() => {
			dos.setState(dosState.heldSelector, (value) => {
				value.count = 4
				return value
			})
		})
		expect(getByTestId(`value`).textContent).toBe(`4`)
	})
})
