import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import type { Loadable } from "atom.io"
import { Silo } from "atom.io"
import { useState } from "react"

function createPrimaryScenario() {
	const app = new Silo({
		name: `primary-devtools-story`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const countAtom = app.atom<number>({
		key: `count`,
		default: 0,
	})
	app.atom<string>({
		key: `name`,
		default: `John Doe`,
	})
	app.atom<string[]>({
		key: `list`,
		default: [`a`, `b`, `c`],
	})
	app.atom<Record<string, string>>({
		key: `dict`,
		default: { a: `b`, c: `d` },
	})
	app.atom<null>({
		key: `null`,
		default: null,
	})
	app.atom<boolean>({
		key: `isTrue`,
		default: true,
	})
	app.atom<Loadable<string>>({
		key: `loadable`,
		default: () =>
			new Promise((resolve) =>
				setTimeout(() => {
					resolve(`hello`)
				}, 1000),
			),
	})
	app.atom<Loadable<unknown>>({
		key: `future`,
		default: new Promise(() => {}),
	})

	const countAtoms = app.atomFamily<number, string>({
		key: `count`,
		default: 0,
	})
	app.findState(countAtoms, `A`)
	app.findState(countAtoms, `B`)
	app.findState(countAtoms, `C`)
	const userAtoms = app.atomFamily<
		{ name: { first: string; last: string }; stats: Record<string, number> },
		string
	>({
		key: `user`,
		default: {
			name: { first: `John`, last: `Doe` },
			stats: { a: 1, b: 2, c: 3 },
		},
	})
	app.findState(userAtoms, `A`)
	app.findState(userAtoms, `B`)
	app.findState(userAtoms, `C`)

	app.atom<[{ a: number }]>({
		key: `nestArray`,
		default: [{ a: 1 }],
	})
	app.atom<{ a: number[]; b: { num: number } }>({
		key: `nestObject`,
		default: {
			a: [1],
			b: { num: 2 },
		},
	})

	const selectionsAtom = app.atom<number[]>({
		key: `selections`,
		default: [1, 2, 3],
	})
	const evenSelectionsSelector = app.selector<number[]>({
		key: `evenSelections`,
		get: ({ get }) => get(selectionsAtom).filter((n) => n % 2 === 0),
	})
	app.selector<Record<string, number>>({
		key: `objSelector`,
		get: ({ get }) => {
			const selections = get(selectionsAtom)
			const evenSelections = get(evenSelectionsSelector)
			return {
				a: selections[0],
				b: evenSelections[0],
			}
		},
	})
	const myTransaction = app.transaction<(param: object) => object>({
		key: `my`,
		do: ({ set }) => {
			set(countAtom, 0)
			set(selectionsAtom, (prev) => [...prev, 4])
			return {
				a: 1,
				b: 2,
				c: { stuff: [1, 2, 3] },
			}
		},
	})

	return { app, run: () => app.runTransaction(myTransaction)({ thing: [`hi`] }) }
}

/** A fresh application store for every story mount and test execution. */
export function PrimaryDevtools(): React.JSX.Element {
	const [scenario] = useState(createPrimaryScenario)
	return (
		<StoreProvider store={scenario.app.store}>
			<button
				style={{ position: `absolute`, top: `10px`, right: `10px` }}
				type="button"
				onClick={scenario.run}
			>
				run
			</button>
			<AtomIODevtools />
		</StoreProvider>
	)
}
