import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

type Point = { x: number; y: number }
const bounds = { x: 120, y: 90 }
const directions = [
	{ label: `Move up`, glyph: `↑`, axis: `y`, step: -1 },
	{ label: `Move left`, glyph: `←`, axis: `x`, step: -1 },
	{ label: `Move down`, glyph: `↓`, axis: `y`, step: 1 },
	{ label: `Move right`, glyph: `→`, axis: `x`, step: 1 },
] as const

const pointAtom = atom<Point>({ key: `point`, default: { x: 20, y: 20 } })
export default function PointEditor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	function move(axis: keyof Point, step: number): void {
		setPoint((point) => ({
			...point,
			[axis]: Math.max(0, Math.min(bounds[axis], point[axis] + step)),
		}))
	}
	return (
		<section>
			<svg
				class="drawing-surface"
				viewBox={`0 0 ${bounds.x} ${bounds.y}`}
				width="240"
				height="180"
				role="img"
				aria-label="Point position"
			>
				<circle cx={getPoint().x} cy={getPoint().y} r="2" fill="currentColor" />
			</svg>
			<footer class="direction-pad" role="group" aria-label="Move point">
				{directions.map(({ label, glyph, axis, step }) => (
					<button
						key={label}
						type="button"
						aria-label={label}
						onClick={() => move(axis, step)}
					>
						{glyph}
					</button>
				))}
			</footer>
		</section>
	)
}
