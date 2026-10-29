import { atom } from "atom.io"
import type { VNode } from "hydrogen"
import { useId, useRef, useSetter, useValue } from "hydrogen"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
const circleAtom = atom<SVGCircleElement | null>({
	key: `circle`,
	default: null,
})

export function PointEditor(): VNode {
	const point = useValue(pointAtom)
	const setPoint = useSetter(pointAtom)
	const circle = useRef(circleAtom)
	const id = useId()
	return (
		<section aria-labelledby={id}>
			<h2 id={id}>Point</h2>
			<svg viewBox="0 0 100 100">
				<circle ref={circle} cx={point().x} cy={point().y} r="3" />
			</svg>
			<output>
				{point().x}, {point().y}
			</output>
			<button
				onClick={() => {
					setPoint(({ x, y }) => ({ x: x + 1, y }))
				}}
			>
				Move right
			</button>
		</section>
	)
}
