import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { Circle, Layer, Stage } from "@atom.io/spa/konva"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 100, y: 100 },
})
export default function Editor(): SpaElement {
	const getPoint = useGetter(pointAtom)
	const setPoint = useSetter(pointAtom)
	return (
		<Stage width={240} height={180}>
			<Layer>
				<Circle
					x={getPoint().x}
					y={getPoint().y}
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
