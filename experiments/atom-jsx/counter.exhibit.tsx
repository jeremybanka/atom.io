import { atom, selector } from "atom.io"
import { setIntoStore } from "atom.io/internal"

import type { RenderRoot, VNode } from "./runtime.ts"
import { render, useStore } from "./runtime.ts"

export const countAtom = atom<number>({ key: `count`, default: 0 })
export const doubledSelector = selector<number>({
	key: `doubled`,
	get: ({ get }) => get(countAtom) * 2,
})

export const limitReachedSelector = selector<boolean>({
	key: `limitReached`,
	get: ({ get }) => get(countAtom) >= 10,
})

export function Counter(): VNode {
	const store = useStore()
	return (
		<section className="counter">
			<p>
				Count: <output>{countAtom}</output>
			</p>
			<p>Doubled: {doubledSelector}</p>
			<button
				type="button"
				disabled={limitReachedSelector}
				onClick={() => {
					setIntoStore(store, countAtom, (count) => count + 1)
				}}
			>
				Increment
			</button>
		</section>
	)
}

export function mountCounter(host: HTMLElement): RenderRoot {
	return render(<Counter />, host)
}
