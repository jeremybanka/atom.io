import { act, fireEvent, render } from "@testing-library/react"
import type { Loadable, TimelineToken } from "atom.io"
import {
	atom,
	atomFamily,
	getState,
	inspectTimeline,
	mutableAtom,
	mutableAtomFamily,
	redo,
	resetState,
	scopeFamily,
	selector,
	setState,
	Silo,
	timeline,
	undo,
} from "atom.io"
import {
	StoreProvider,
	useAtomicRef,
	useI,
	useJSON,
	useLoadable,
	useO,
	useSingleEffect,
	useTL,
} from "atom.io/react"
import { setTestLogLevel, takeSnapshot } from "atom.io/testing"
import { UList } from "atom.io/transceivers/u-list"
import { type FC, useEffect, useRef } from "react"

import * as Utils from "../../__util__/index.ts"

const { restore } = takeSnapshot()

beforeEach(() => {
	restore()
	setTestLogLevel(null)
	vitest.spyOn(Utils, `stdout`)
})
const doNothing = () => undefined

type TestGlobal = typeof globalThis & {
	env?: { NODE_ENV?: `development` | `production` | (string & {}) }
}
const testGlobal = globalThis as TestGlobal

const setNodeEnv = (value: `development` | `production`): void => {
	testGlobal.env = { ...testGlobal.env, NODE_ENV: value }
}

const restoreNodeEnv = (previousEnv: TestGlobal[`env`]): void => {
	if (previousEnv === undefined) {
		delete testGlobal.env
	} else {
		testGlobal.env = previousEnv
	}
}

describe(`regular atom`, () => {
	const setters: unknown[] = []
	const scenario = () => {
		const letterAtom = atom<string>({
			key: `letter`,
			default: `A`,
		})
		const Letter: FC = () => {
			const setLetter = useI(letterAtom)
			const letter = useO(letterAtom)
			setters.push(setLetter)
			return (
				<>
					<div data-testid={letter}>{letter}</div>
					<button
						type="button"
						onClick={() => {
							setLetter(`B`)
						}}
						data-testid="changeStateButton"
					/>
				</>
			)
		}
		const utils = render(
			<StoreProvider>
				<Utils.Observer node={letterAtom} onChange={doNothing} />
				<Letter />
			</StoreProvider>,
		)
		return { ...utils }
	}

	it(`accepts user input with externally managed state`, () => {
		const { getByTestId } = scenario()
		const changeStateButton = getByTestId(`changeStateButton`)
		fireEvent.click(changeStateButton)
		const option = getByTestId(`B`)
		assert(option)
		expect(setters.length).toBe(2)
		expect(setters[0]).toBe(setters[1])
	})
})
describe(`mutable atom`, () => {
	const setters: unknown[] = []
	const scenario = () => {
		const lettersAtom = mutableAtom<UList<string>>({
			key: `letters`,
			class: UList,
		})
		const Letter: FC = () => {
			const setLetter = useI(lettersAtom)
			const letters = useO(lettersAtom)
			setters.push(setLetter)
			const includesA = letters.has(`A`) ? `yes` : `no`
			return (
				<>
					<div data-testid={includesA} />
					<button
						type="button"
						onClick={() => {
							setLetter((self) => self.add(`A`))
						}}
						data-testid="changeStateButton"
					/>
				</>
			)
		}
		const utils = render(
			<StoreProvider>
				<Utils.Observer node={lettersAtom} onChange={doNothing} />
				<Letter />
			</StoreProvider>,
		)
		return { ...utils }
	}

	it(`accepts user input with externally managed state`, () => {
		const { getByTestId } = scenario()
		const changeStateButton = getByTestId(`changeStateButton`)
		fireEvent.click(changeStateButton)
		const option = getByTestId(`yes`)
		assert(option)
		expect(setters.length).toBe(2)
		expect(setters[0]).toBe(setters[1])
	})
})
describe(`useJSON`, () => {
	it(`reads the json value of a mutable atom`, () => {
		const numbersAtom = mutableAtom<UList<number>>({
			key: `numbers`,
			class: UList,
		})
		const Numbers: FC = () => {
			const numbers = useJSON(numbersAtom)
			const setNumbers = useI(numbersAtom)
			return (
				<>
					<div data-testid="numbers">{JSON.stringify(numbers)}</div>
					<button
						type="button"
						data-testid="addNumber"
						onClick={() => {
							setNumbers((current) => current.add(1).add(2))
						}}
					/>
				</>
			)
		}
		const { getByTestId } = render(
			<StoreProvider>
				<Numbers />
			</StoreProvider>,
		)

		expect(getByTestId(`numbers`).textContent).toBe(`[]`)
		fireEvent.click(getByTestId(`addNumber`))
		expect(getByTestId(`numbers`).textContent).toBe(`[1,2]`)
	})

	it(`reads the json value of a mutable atom family member`, () => {
		const numberAtoms = mutableAtomFamily<UList<number>, string>({
			key: `number`,
			class: UList,
		})
		const Numbers: FC = () => {
			const numbers = useJSON(numberAtoms, `family`)
			const setNumbers = useI(numberAtoms, `family`)
			return (
				<>
					<div data-testid="numbers">{JSON.stringify(numbers)}</div>
					<button
						type="button"
						data-testid="addNumber"
						onClick={() => {
							setNumbers((current) => current.add(3).add(4))
						}}
					/>
				</>
			)
		}
		const { getByTestId } = render(
			<StoreProvider>
				<Numbers />
			</StoreProvider>,
		)

		expect(getByTestId(`numbers`).textContent).toBe(`[]`)
		fireEvent.click(getByTestId(`addNumber`))
		expect(getByTestId(`numbers`).textContent).toBe(`[3,4]`)
	})
})
describe(`timeline`, () => {
	const setters: unknown[] = []
	const scenario = () => {
		const letterAtom = atom<string>({
			key: `letter`,
			default: `A`,
		})
		const letterTL = timeline({
			key: `letterTL`,
			scope: [letterAtom],
		})
		const Letter: FC = () => {
			const setLetter = useI(letterAtom)
			const letter = useO(letterAtom)
			const letterTimeline = useTL(letterTL)
			setters.push(setLetter)
			return (
				<>
					<div data-testid={letter}>{letter}</div>
					<div data-testid="timelineAt">{letterTimeline.at}</div>
					<div data-testid="timelineLength">{letterTimeline.length}</div>
					<button
						type="button"
						onClick={() => {
							setLetter(`B`)
						}}
						data-testid="changeStateButtonB"
					/>
					<button
						type="button"
						onClick={() => {
							setLetter(`C`)
						}}
						data-testid="changeStateButtonC"
					/>
					<button
						type="button"
						onClick={() => {
							letterTimeline.undo()
						}}
						data-testid="undoButton"
					/>
					<button
						type="button"
						onClick={() => {
							letterTimeline.redo()
						}}
						data-testid="redoButton"
					/>
					<button
						type="button"
						onClick={() => {
							letterTimeline.clear()
						}}
						data-testid="clearButton"
					/>
				</>
			)
		}
		const utils = render(
			<StoreProvider>
				<Utils.Observer node={letterAtom} onChange={doNothing} />
				<Letter />
			</StoreProvider>,
		)
		return { ...utils, letterTL }
	}

	it(`displays metadata`, () => {
		const { getByTestId, letterTL } = scenario()
		const changeStateButtonB = getByTestId(`changeStateButtonB`)
		const changeStateButtonC = getByTestId(`changeStateButtonC`)
		fireEvent.click(changeStateButtonB)
		const option = getByTestId(`B`)
		assert(option)
		const timelineAt = getByTestId(`timelineAt`)
		expect(timelineAt.textContent).toEqual(`1`)
		const timelineLength = getByTestId(`timelineLength`)
		expect(timelineLength.textContent).toEqual(`1`)
		fireEvent.click(changeStateButtonC)
		const option2 = getByTestId(`C`)
		assert(option2)
		expect(timelineAt.textContent).toEqual(`2`)
		act(() => {
			undo(letterTL)
		})
		expect(timelineAt.textContent).toEqual(`1`)
		expect(timelineLength.textContent).toEqual(`2`)
		act(() => {
			redo(letterTL)
		})
		expect(timelineAt.textContent).toEqual(`2`)
		expect(timelineLength.textContent).toEqual(`2`)
		const undoButton = getByTestId(`undoButton`)
		fireEvent.click(undoButton)
		expect(timelineAt.textContent).toEqual(`1`)
		expect(timelineLength.textContent).toEqual(`2`)
		const redoButton = getByTestId(`redoButton`)
		fireEvent.click(redoButton)
		expect(timelineAt.textContent).toEqual(`2`)
		expect(timelineLength.textContent).toEqual(`2`)
	})
	it(`clears metadata and captures new history`, () => {
		const { getByTestId } = scenario()
		const changeStateButtonB = getByTestId(`changeStateButtonB`)
		const changeStateButtonC = getByTestId(`changeStateButtonC`)
		const clearButton = getByTestId(`clearButton`)
		const timelineAt = getByTestId(`timelineAt`)
		const timelineLength = getByTestId(`timelineLength`)

		fireEvent.click(changeStateButtonB)
		fireEvent.click(changeStateButtonC)
		expect(timelineAt.textContent).toEqual(`2`)
		expect(timelineLength.textContent).toEqual(`2`)

		fireEvent.click(clearButton)
		expect(timelineAt.textContent).toEqual(`0`)
		expect(timelineLength.textContent).toEqual(`0`)

		fireEvent.click(changeStateButtonB)
		expect(timelineAt.textContent).toEqual(`1`)
		expect(timelineLength.textContent).toEqual(`1`)
	})
	it(`uses the provider store for all controls`, () => {
		const implicit = (() => {
			const letterAtom = atom<string>({
				key: `letter`,
				default: `implicit-a`,
			})
			const letterTL = timeline({
				key: `letterTL`,
				scope: [letterAtom],
			})
			setState(letterAtom, `implicit-b`)
			return { letterAtom, letterTL }
		})()

		const silo = new Silo({
			name: `use-tl-provider-store`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const siloState = (() => {
			const letterAtom = silo.atom<string>({
				key: `letter`,
				default: `silo-a`,
			})
			const letterTL = silo.timeline({
				key: `letterTL`,
				scope: [letterAtom],
			})
			silo.setState(letterAtom, `silo-b`)
			return { letterAtom, letterTL }
		})()

		const Letter: FC = () => {
			const letter = useO(siloState.letterAtom)
			const letterTimeline = useTL(siloState.letterTL)
			return (
				<>
					<div data-testid="letter">{letter}</div>
					<div data-testid="timelineAt">{letterTimeline.at}</div>
					<div data-testid="timelineLength">{letterTimeline.length}</div>
					<button
						type="button"
						data-testid="undoButton"
						onClick={letterTimeline.undo}
					/>
					<button
						type="button"
						data-testid="redoButton"
						onClick={letterTimeline.redo}
					/>
					<button
						type="button"
						data-testid="clearButton"
						onClick={letterTimeline.clear}
					/>
				</>
			)
		}

		const { getByTestId } = render(
			<StoreProvider store={silo.store}>
				<Letter />
			</StoreProvider>,
		)

		fireEvent.click(getByTestId(`undoButton`))
		expect(getByTestId(`letter`).textContent).toBe(`silo-a`)
		expect(getByTestId(`timelineAt`).textContent).toBe(`0`)
		expect(silo.getState(siloState.letterAtom)).toBe(`silo-a`)
		expect(getState(implicit.letterAtom)).toBe(`implicit-b`)
		expect(inspectTimeline(implicit.letterTL)).toEqual({ at: 1, length: 1 })

		fireEvent.click(getByTestId(`redoButton`))
		expect(getByTestId(`letter`).textContent).toBe(`silo-b`)
		expect(getByTestId(`timelineAt`).textContent).toBe(`1`)
		expect(silo.getState(siloState.letterAtom)).toBe(`silo-b`)
		expect(getState(implicit.letterAtom)).toBe(`implicit-b`)
		expect(inspectTimeline(implicit.letterTL)).toEqual({ at: 1, length: 1 })

		fireEvent.click(getByTestId(`clearButton`))
		expect(getByTestId(`timelineAt`).textContent).toBe(`0`)
		expect(getByTestId(`timelineLength`).textContent).toBe(`0`)
		expect(getState(implicit.letterAtom)).toBe(`implicit-b`)
		expect(inspectTimeline(implicit.letterTL)).toEqual({ at: 1, length: 1 })
	})
	it(`switches keyed timeline-family members in the provider store`, () => {
		const silo = new Silo({
			name: `use-tl-family-provider-store`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const countAtoms = silo.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = silo.timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})

		const Count: FC<{ countKey: string }> = ({ countKey }) => {
			const count = useO(countAtoms, countKey)
			const setCount = useI(countAtoms, countKey)
			const history = useTL(countHistories, countKey)
			return (
				<>
					<div data-testid="count">{count}</div>
					<div data-testid="timelineAt">{history.at}</div>
					<button
						type="button"
						data-testid="increment"
						onClick={() => {
							setCount((current) => current + 1)
						}}
					/>
					<button type="button" data-testid="undo" onClick={history.undo} />
				</>
			)
		}
		const view = (countKey: string) => (
			<StoreProvider store={silo.store}>
				<Count countKey={countKey} />
			</StoreProvider>
		)
		const { getByTestId, rerender } = render(view(`a`))

		fireEvent.click(getByTestId(`increment`))
		expect(getByTestId(`count`).textContent).toBe(`1`)
		expect(getByTestId(`timelineAt`).textContent).toBe(`1`)

		rerender(view(`b`))
		expect(getByTestId(`count`).textContent).toBe(`0`)
		expect(getByTestId(`timelineAt`).textContent).toBe(`0`)
		fireEvent.click(getByTestId(`increment`))

		rerender(view(`a`))
		expect(getByTestId(`count`).textContent).toBe(`1`)
		expect(getByTestId(`timelineAt`).textContent).toBe(`1`)
		fireEvent.click(getByTestId(`undo`))
		expect(getByTestId(`count`).textContent).toBe(`0`)
		expect(silo.getState(countAtoms, `b`)).toBe(1)
	})
	it(`offers coordinated transaction travel at a timeline-family head`, () => {
		const silo = new Silo({
			name: `use-tl-transaction-head`,
			lifespan: `ephemeral`,
			isProduction: false,
		})
		const countAtoms = silo.atomFamily<number, string>({
			key: `count`,
			default: 0,
		})
		const countHistories = silo.timelineFamily<string>({
			key: `countHistory`,
			scope: [scopeFamily(countAtoms, { timelineKey: (countKey) => countKey })],
		})
		const setBothCountsTX = silo.transaction<(value: number) => void>({
			key: `setBothCounts`,
			do: ({ set }, value) => {
				set(countAtoms, `a`, value)
				set(countAtoms, `b`, value)
			},
		})
		silo.getState(countAtoms, `a`)
		silo.getState(countAtoms, `b`)
		silo.findTimeline(countHistories, `a`)
		silo.findTimeline(countHistories, `b`)
		silo.clearTimeline(countHistories, `a`)
		silo.clearTimeline(countHistories, `b`)

		const Editor: FC = () => {
			const countB = useO(countAtoms, `b`)
			const historyB = useTL(countHistories, `b`)
			return (
				<>
					<div data-testid="countB">{countB}</div>
					<div data-testid="canUndoTransaction">
						{String(historyB.undoTransaction !== undefined)}
					</div>
					<div data-testid="canRedoTransaction">
						{String(historyB.redoTransaction !== undefined)}
					</div>
					<button
						type="button"
						data-testid="batch"
						onClick={() => {
							silo.runTransaction(setBothCountsTX)(1)
						}}
					/>
					<button
						type="button"
						data-testid="divergeA"
						onClick={() => {
							silo.setState(countAtoms, `a`, 2)
						}}
					/>
					<button
						type="button"
						data-testid="undoTransaction"
						onClick={() => historyB.undoTransaction?.()}
					/>
					<button
						type="button"
						data-testid="redoTransaction"
						onClick={() => historyB.redoTransaction?.()}
					/>
				</>
			)
		}
		const { getByTestId } = render(
			<StoreProvider store={silo.store}>
				<Editor />
			</StoreProvider>,
		)

		expect(getByTestId(`canUndoTransaction`).textContent).toBe(`false`)
		fireEvent.click(getByTestId(`batch`))
		expect(getByTestId(`canUndoTransaction`).textContent).toBe(`true`)
		fireEvent.click(getByTestId(`divergeA`))
		fireEvent.click(getByTestId(`undoTransaction`))
		expect(silo.getState(countAtoms, `a`)).toBe(2)
		expect(getByTestId(`countB`).textContent).toBe(`0`)
		expect(getByTestId(`canUndoTransaction`).textContent).toBe(`false`)
		expect(getByTestId(`canRedoTransaction`).textContent).toBe(`true`)

		fireEvent.click(getByTestId(`redoTransaction`))
		expect(silo.getState(countAtoms, `a`)).toBe(2)
		expect(getByTestId(`countB`).textContent).toBe(`1`)
		expect(getByTestId(`canUndoTransaction`).textContent).toBe(`true`)
		expect(getByTestId(`canRedoTransaction`).textContent).toBe(`false`)
	})
})

describe(`useSingleEffect`, () => {
	function SingleEffectProbe({
		deps,
		effect,
	}: {
		deps: unknown[]
		effect: () => (() => void) | undefined | void
	}) {
		useSingleEffect(effect, deps)
		return <div data-testid="mounted" />
	}

	it(`runs each dependency change once in development StrictMode`, () => {
		const previousEnv = testGlobal.env
		try {
			setNodeEnv(`development`)
			const effect = vitest.fn(() => undefined)

			const { rerender } = render(
				<SingleEffectProbe effect={effect} deps={[`a`]} />,
				{ reactStrictMode: true },
			)

			expect(effect).toHaveBeenCalledTimes(1)
			rerender(<SingleEffectProbe effect={effect} deps={[`a`]} />)
			expect(effect).toHaveBeenCalledTimes(1)
			rerender(<SingleEffectProbe effect={effect} deps={[`b`]} />)
			expect(effect).toHaveBeenCalledTimes(2)
		} finally {
			restoreNodeEnv(previousEnv)
		}
	})

	it(`cleans up once per dependency change in development StrictMode`, () => {
		const previousEnv = testGlobal.env
		try {
			setNodeEnv(`development`)
			const cleanupFn = vitest.fn()
			const effect = vitest.fn(() => cleanupFn)

			const { rerender } = render(
				<SingleEffectProbe effect={effect} deps={[`a`]} />,
				{ reactStrictMode: true },
			)

			expect(effect).toHaveBeenCalledTimes(1)
			expect(cleanupFn).not.toHaveBeenCalled()
			rerender(<SingleEffectProbe effect={effect} deps={[`a`]} />)
			expect(effect).toHaveBeenCalledTimes(1)
			expect(cleanupFn).not.toHaveBeenCalled()
			rerender(<SingleEffectProbe effect={effect} deps={[`b`]} />)
			expect(cleanupFn).toHaveBeenCalledTimes(1)
			expect(effect).toHaveBeenCalledTimes(2)
		} finally {
			restoreNodeEnv(previousEnv)
		}
	})

	it(`uses regular effect behavior outside development`, () => {
		const previousEnv = testGlobal.env
		try {
			setNodeEnv(`production`)
			const cleanupFn = vitest.fn()
			const effect = vitest.fn(() => cleanupFn)

			const { rerender, unmount } = render(
				<SingleEffectProbe effect={effect} deps={[`a`]} />,
			)

			expect(effect).toHaveBeenCalledTimes(1)
			rerender(<SingleEffectProbe effect={effect} deps={[`b`]} />)
			expect(cleanupFn).toHaveBeenCalledTimes(1)
			expect(effect).toHaveBeenCalledTimes(2)
			unmount()
			expect(cleanupFn).toHaveBeenCalledTimes(2)
		} finally {
			restoreNodeEnv(previousEnv)
		}
	})
})
describe(`timeline (dynamic)`, () => {
	const scenario = () => {
		const letterAtom = atom<string>({
			key: `letter`,
			default: `A`,
		})
		const numberAtom = atom<number>({
			key: `number`,
			default: 1,
		})
		const letterTL = timeline({
			key: `letterTL`,
			scope: [letterAtom],
		})
		const numberTL = timeline({
			key: `numberTL`,
			scope: [numberAtom],
		})
		const whichTimelineAtom = atom<string>({
			key: `whichTimeline`,
			default: `letter`,
		})
		const timelineSelector = selector<TimelineToken<unknown>>({
			key: `timeline`,
			get: ({ get }) => {
				const whichTimeline = get(whichTimelineAtom)
				return whichTimeline === `letter` ? letterTL : numberTL
			},
		})
		const Letter: FC = () => {
			const setLetter = useI(letterAtom)
			const setNumber = useI(numberAtom)
			const setWhichTimeline = useI(whichTimelineAtom)
			const letter = useO(letterAtom)
			const number = useO(numberAtom)
			const tl = useTL(useO(timelineSelector))
			return (
				<>
					<div data-testid={letter}>{letter}</div>
					<div data-testid={number}>{number}</div>
					<div data-testid="timelineAt">{tl.at}</div>
					<div data-testid="timelineLength">{tl.length}</div>
					<button
						type="button"
						onClick={() => {
							setLetter(`B`)
						}}
						data-testid="changeLetterButtonB"
					/>
					<button
						type="button"
						onClick={() => {
							setNumber(2)
						}}
						data-testid="changeNumberButton2"
					/>
					<button
						type="button"
						onClick={() => {
							setWhichTimeline((current) =>
								current === `number` ? `letter` : `number`,
							)
						}}
						data-testid="changeTimelineButton"
					/>
					<button
						type="button"
						onClick={() => {
							tl.undo()
						}}
						data-testid="undoButton"
					/>
					<button
						type="button"
						onClick={() => {
							tl.redo()
						}}
						data-testid="redoButton"
					/>
				</>
			)
		}
		const utils = render(
			<StoreProvider>
				<Utils.Observer node={letterAtom} onChange={doNothing} />
				<Letter />
			</StoreProvider>,
		)
		return { ...utils, letterTL }
	}

	it(`displays metadata`, () => {
		const { getByTestId, letterTL } = scenario()
		const changeLetterButtonB = getByTestId(`changeLetterButtonB`)
		const changeNumberButton2 = getByTestId(`changeNumberButton2`)
		const changeTimelineButton = getByTestId(`changeTimelineButton`)
		const timelineAt = getByTestId(`timelineAt`)
		const timelineLength = getByTestId(`timelineLength`)
		fireEvent.click(changeLetterButtonB)
		const option = getByTestId(`B`)
		assert(option)
		expect(timelineAt.textContent).toEqual(`1`)
		expect(timelineLength.textContent).toEqual(`1`)
		fireEvent.click(changeTimelineButton)
		expect(timelineAt.textContent).toEqual(`0`)
		expect(timelineLength.textContent).toEqual(`0`)
		fireEvent.click(changeNumberButton2)
		const option2 = getByTestId(`2`)
		assert(option2)
		expect(timelineAt.textContent).toEqual(`1`)
		expect(timelineLength.textContent).toEqual(`1`)
		act(() => {
			undo(letterTL)
		})
		fireEvent.click(changeTimelineButton)
		expect(timelineAt.textContent).toEqual(`0`)
		expect(timelineLength.textContent).toEqual(`1`)
	})
})

describe(`useLoadable`, () => {
	test(`standalone, without a fallback`, async () => {
		let loadLetter = (_: string): void => {
			throw new Error(`loadLetter not attached`)
		}

		const letterAtom = atom<Loadable<string>>({
			key: `letter`,
			default: () =>
				new Promise((resolve) => {
					loadLetter = (letter: string) => {
						resolve(letter)
					}
				}),
		})

		const Letter: FC = () => {
			const letter = useLoadable(letterAtom)
			if (letter === `LOADING`) {
				return (
					<div data-testid="loading">
						<div>Loading...</div>
					</div>
				)
			}
			return (
				<div data-testid="not-loading">
					<div data-testid={letter.value}>{letter.value}</div>
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		await act(async () => {
			loadLetter(`A`)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`A`))
	})
	test(`standalone, with a fallback`, async () => {
		let loadLetter = (_: string): void => {
			throw new Error(`loadLetter not attached`)
		}

		const letterAtom = atom<Loadable<string>>({
			key: `letter`,
			default: () =>
				new Promise((resolve) => {
					loadLetter = (letter: string) => {
						resolve(letter)
					}
				}),
		})

		const Letter: FC = () => {
			const letter = useLoadable(letterAtom, `Z`)
			return (
				<div data-testid={letter.loading ? `loading` : `not-loading`}>
					<div data-testid={letter.value}>{letter.value}</div>
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		assert(utils.getByTestId(`Z`))
		await act(async () => {
			loadLetter(`A`)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`A`))
	})

	test(`family, without a fallback`, async () => {
		const loadIndex: Record<number, () => void> = {}

		const indexAtoms = atomFamily<Loadable<number[]>, number>({
			key: `index`,
			default: (key) =>
				new Promise((resolve) => {
					loadIndex[key] = () => {
						resolve([1, 2, 3])
					}
				}),
		})

		const Letter: FC = () => {
			const ids = useLoadable(indexAtoms, 0)
			if (ids === `LOADING`) {
				return (
					<div data-testid="loading">
						<div>Loading...</div>
					</div>
				)
			}
			return (
				<div data-testid="not-loading">
					{ids.value.map((id) => (
						<div key={id} data-testid={id}>
							{id}
						</div>
					))}
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		await act(async () => {
			loadIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))
	})
	test(`family, with a fallback`, async () => {
		const loadIndex: Record<number, () => void> = {}

		const indexAtoms = atomFamily<Loadable<number[]>, number>({
			key: `index`,
			default: (key) =>
				new Promise((resolve) => {
					loadIndex[key] = () => {
						resolve([1, 2, 3])
					}
				}),
		})

		const Letter: FC = () => {
			const ids = useLoadable(indexAtoms, 0, [4, 5, 6])
			return (
				<div data-testid={ids.loading ? `loading` : `not-loading`}>
					{ids.value.map((id) => (
						<div key={id} data-testid={id}>
							{id}
						</div>
					))}
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		await act(async () => {
			loadIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))
	})

	test(`family, without a fallback, with an error`, async () => {
		const loadIndex: Record<number, () => void> = {}
		const failIndex: Record<number, () => void> = {}
		let throwImmediately = false
		let resolveImmediately = false

		const indexAtoms = atomFamily<Loadable<number[]>, number, Error>({
			key: `index`,
			default: (key) => {
				if (resolveImmediately) {
					return [1, 2, 3]
				}
				if (throwImmediately) {
					throw new Error(`💥`)
				}
				return new Promise((resolve, reject) => {
					loadIndex[key] = () => {
						resolve([1, 2, 3])
					}
					failIndex[key] = () => {
						reject(new Error(`💥`))
					}
				})
			},
			catch: [Error],
		})

		const Letter: FC = () => {
			const ids = useLoadable(indexAtoms, 0)
			if (ids === `LOADING`) {
				return (
					<div data-testid="loading">
						<div>Loading...</div>
					</div>
				)
			}
			if (ids.value instanceof Error) {
				return (
					<div data-testid={ids.loading ? `reloading` : `not-loading`}>
						<div data-testid="error">
							<div>Error...</div>
						</div>
					</div>
				)
			}
			return (
				<div data-testid={ids.loading ? `reloading` : `not-loading`}>
					{ids.value.map((id) => (
						<div key={id} data-testid={id}>
							{id}
						</div>
					))}
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		await act(async () => {
			failIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})

		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`error`))

		act(() => {
			resetState(indexAtoms, 0)
		})
		assert(utils.getByTestId(`reloading`))

		await act(async () => {
			loadIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})

		assert(utils.getByTestId(`not-loading`))
		expect(() => utils.getByTestId(`error`)).toThrowError()
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))

		throwImmediately = true
		act(() => {
			resetState(indexAtoms, 0)
		})

		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`error`))

		resolveImmediately = true
		act(() => {
			resetState(indexAtoms, 0)
		})

		assert(utils.getByTestId(`not-loading`))
		expect(() => utils.getByTestId(`error`)).toThrowError()
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))
	})

	test(`family, with a fallback, with an error`, async () => {
		const loadIndex: Record<number, () => void> = {}
		const failIndex: Record<number, () => void> = {}
		let throwImmediately = false
		let resolveImmediately = false

		const indexAtoms = atomFamily<Loadable<number[]>, number, Error>({
			key: `index`,
			default: (key) => {
				if (resolveImmediately) {
					return [1, 2, 3]
				}
				if (throwImmediately) {
					throw new Error(`💥`)
				}
				return new Promise((resolve, reject) => {
					loadIndex[key] = () => {
						resolve([1, 2, 3])
					}
					failIndex[key] = () => {
						reject(new Error(`💥`))
					}
				})
			},
			catch: [Error],
		})

		const Letter: FC = () => {
			const ids = useLoadable(indexAtoms, 0, [4, 5, 6])
			return (
				<div data-testid={ids.loading ? `loading` : `not-loading`}>
					{ids.error ? <div data-testid="error">{ids.error.message}</div> : null}
					{ids.value.map((id) => (
						<div key={id} data-testid={id}>
							{id}
						</div>
					))}
				</div>
			)
		}
		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		await act(async () => {
			failIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})

		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`error`))
		assert(utils.getByTestId(`4`))
		assert(utils.getByTestId(`5`))
		assert(utils.getByTestId(`6`))

		act(() => {
			resetState(indexAtoms, 0)
		})
		assert(utils.getByTestId(`loading`))
		assert(utils.getByTestId(`4`))
		assert(utils.getByTestId(`5`))
		assert(utils.getByTestId(`6`))

		await act(async () => {
			loadIndex[0]()
			await new Promise((resolve) => setImmediate(resolve))
		})

		assert(utils.getByTestId(`not-loading`))
		expect(() => utils.getByTestId(`error`)).toThrowError()
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))

		throwImmediately = true
		act(() => {
			resetState(indexAtoms, 0)
		})

		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`error`))
		assert(utils.getByTestId(`4`))
		assert(utils.getByTestId(`5`))
		assert(utils.getByTestId(`6`))

		resolveImmediately = true
		act(() => {
			resetState(indexAtoms, 0)
		})

		assert(utils.getByTestId(`not-loading`))
		expect(() => utils.getByTestId(`error`)).toThrowError()
		assert(utils.getByTestId(`1`))
		assert(utils.getByTestId(`2`))
		assert(utils.getByTestId(`3`))
	})

	test(`referential identity`, async () => {
		const uniqueRefs: unknown[] = []
		const promises: Promise<string>[] = []
		const loaders: ((letter: string) => void)[] = []
		function loadLetter(...params: string[]) {
			for (const letter of params) {
				loaders.shift()!(letter)
			}
		}

		const letterAtom = atom<Loadable<string>, Error>({
			key: `letter`,
			default: () => {
				const promise = new Promise<string>((resolve) => {
					loaders.push((letter: string) => {
						resolve(letter)
					})
				})
				promises.push(promise)
				return promise
			},
			catch: [Error],
		})

		const Letter: FC = () => {
			const letter = useLoadable(letterAtom)

			useEffect(() => {
				uniqueRefs.push(letter)
			}, [letter])

			if (letter === `LOADING`) {
				return (
					<div data-testid="loading">
						<div>Loading...</div>
					</div>
				)
			}
			return (
				<div data-testid={letter.loading ? `loading` : `not-loading`}>
					{letter.value instanceof Error ? (
						<div data-testid="error">{letter.value.message}</div>
					) : (
						<div data-testid={letter.value}>{letter.value}</div>
					)}
				</div>
			)
		}

		const utils = render(
			<StoreProvider>
				<Letter />
			</StoreProvider>,
		)
		assert(utils.getByTestId(`loading`))
		expect(uniqueRefs).toHaveLength(1)
		await act(async () => {
			loadLetter(`A`)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`A`))
		expect(uniqueRefs).toHaveLength(2)
		await act(async () => {
			resetState(letterAtom)
			resetState(letterAtom)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`loading`))
		assert(utils.getByTestId(`A`))

		expect(uniqueRefs).toHaveLength(3)
		await act(async () => {
			loadLetter(``, `C`)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`C`))
		expect(uniqueRefs).toHaveLength(4)
		await act(async () => {
			setState(letterAtom, `D`)
			await new Promise((resolve) => setImmediate(resolve))
		})
		assert(utils.getByTestId(`not-loading`))
		assert(utils.getByTestId(`D`))
		expect(uniqueRefs).toHaveLength(4)
	})
})

describe(`useAtomicRef`, () => {
	it(`makes an element available to use wherever`, () => {
		const buttonAtom = atom<HTMLButtonElement | null>({
			key: `button`,
			default: null,
		})
		function MyButton() {
			const ref = useAtomicRef(buttonAtom, useRef)
			return (
				<button
					type="button"
					ref={ref}
					onClick={() => {
						Utils.stdout(`hi`)
					}}
				>
					Click me
				</button>
			)
		}
		render(<MyButton />)

		getState(buttonAtom)?.click()

		expect(Utils.stdout).toHaveBeenCalledWith(`hi`)
	})
	it(`makes an element available to use wherever (family overload)`, () => {
		const buttonAtoms = atomFamily<HTMLButtonElement | null, string>({
			key: `button`,
			default: null,
		})
		function MyButton() {
			const ref = useAtomicRef(buttonAtoms, `myCoolButton`, useRef)
			return (
				<button
					type="button"
					ref={ref}
					onClick={() => {
						Utils.stdout(`hi`)
					}}
				>
					Click me
				</button>
			)
		}
		render(<MyButton />)

		getState(buttonAtoms, `myCoolButton`)?.click()

		expect(Utils.stdout).toHaveBeenCalledWith(`hi`)
	})
})
