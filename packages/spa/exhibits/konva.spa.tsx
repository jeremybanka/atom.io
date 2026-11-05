import type { VNode } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { Circle, Layer, Stage } from "@atom.io/spa/konva"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 100, y: 100 },
})
export function Editor(): VNode {
	const point = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	return (
		<Stage width={800} height={600}>
			<Layer>
				<Circle
					x={point().x}
					y={point().y}
					radius={25}
					fill="coral"
					draggable
					onDragEnd={(event) => {
						setPoint({ x: event.target.x(), y: event.target.y() })
					}}
				/>
			</Layer>
		</Stage>
	)
}
