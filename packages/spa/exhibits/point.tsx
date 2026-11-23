import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
export default function PointEditor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	return (
		<section>
			<h2>Point</h2>
			<svg
				viewBox="0 0 100 100"
				width="120"
				height="120"
				role="img"
				aria-label="Point position"
			>
				<rect width="100" height="100" fill="white" stroke="gray" />
				<circle cx={getPoint().x} cy={getPoint().y} r="3" />
			</svg>
			<footer>
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
			</footer>
		</section>
	)
}
