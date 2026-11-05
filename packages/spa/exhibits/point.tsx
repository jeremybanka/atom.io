import type { VNode } from "@atom.io/spa"
import { useGetter, useId, useRef, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
const circleAtom = atom<SVGCircleElement | null>({
	key: `circle`,
	default: null,
})

export function PointEditor(): VNode {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	const circle = useRef(circleAtom)
	const id = useId()
	return (
		<section aria-labelledby={id}>
			<h2 id={id}>Point</h2>
			<svg viewBox="0 0 100 100">
				<circle ref={circle} cx={getPoint().x} cy={getPoint().y} r="3" />
			</svg>
			<output>
				{getPoint().x}, {getPoint().y}
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
