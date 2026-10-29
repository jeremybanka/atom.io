import { atom } from "atom.io"
import { setIntoStore } from "atom.io/internal"

import type { VNode } from "./runtime.ts"
import { project, useStore } from "./runtime.ts"

export const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 30 },
})

export function Point(): VNode {
	const store = useStore()
	return (
		<section>
			<svg viewBox="0 0 100 100">
				<circle
					cx={project(pointAtom, (point) => point.x)}
					cy={project(pointAtom, (point) => point.y)}
					r="4"
				/>
			</svg>
			<output>{project(pointAtom, ({ x, y }) => `(${x}, ${y})`)}</output>
			<button
				onClick={() => {
					setIntoStore(store, pointAtom, ({ x, y }) => ({ x: x + 1, y: y + 1 }))
				}}
			>
				Move diagonally
			</button>
		</section>
	)
}
