import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const bounds = { x: 120, y: 90 }
const axes = [`x`, `y`] as const
const directions = [
	{ label: `Move up`, glyph: `↑`, axis: `y`, step: -1 },
	{ label: `Move left`, glyph: `←`, axis: `x`, step: -1 },
	{ label: `Move down`, glyph: `↓`, axis: `y`, step: 1 },
	{ label: `Move right`, glyph: `→`, axis: `x`, step: 1 },
] as const

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 20, y: 20 },
})
export default function PointEditor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	function setCoordinate(axis: (typeof axes)[number], value: number): void {
		setPoint((point) => ({
			...point,
			[axis]: Math.max(0, Math.min(bounds[axis], value)),
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
			<footer class="point-controls">
				<div role="group" aria-label="Coordinates">
					{axes.map((axis) => (
						<label key={axis}>
							{axis.toUpperCase()}
							<input
								type="number"
								min={0}
								max={bounds[axis]}
								value={getPoint()[axis]}
								onChange={(event) => {
									const input = event.currentTarget
									const value = input.valueAsNumber
									if (Number.isFinite(value)) setCoordinate(axis, value)
									input.value = String(getPoint()[axis])
								}}
							/>
						</label>
					))}
				</div>
				<div class="direction-pad" role="group" aria-label="Move point">
					{directions.map(({ label, glyph, axis, step }) => (
						<button
							key={label}
							type="button"
							aria-label={label}
							onClick={() => setCoordinate(axis, getPoint()[axis] + step)}
						>
							{glyph}
						</button>
					))}
				</div>
			</footer>
		</section>
	)
}
