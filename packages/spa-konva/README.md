# @atom.io/spa-konva

Experimental Konva bindings for SPA. Install this package alongside @atom.io/spa, atom.io, and konva. Use SPA's Vite plugin and JSX configuration; these components use the existing SPA JSX runtime.

Stage renders a DOM container and creates its Konva stage after mounting. Layers, groups, and shapes form a reactive scene subtree. Atom reads in compiled JSX update attributes without rerunning component setup. Keyed children preserve native node identity when reordered. Refs receive native Konva nodes and null on cleanup; component removal destroys owned nodes and their listeners.

```tsx
import { useSetter, useValue } from "@atom.io/spa"
import { Circle, Layer, Stage } from "@atom.io/spa-konva"
import { atom } from "atom.io"

const pointAtom = atom<{ x: number; y: number }>({
	key: `point`,
	default: { x: 100, y: 100 },
})
export function Editor() {
	const point = useValue(pointAtom)
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
					onDragEnd={(event) =>
						setPoint({ x: event.target.x(), y: event.target.y() })
					}
				/>
			</Layer>
		</Stage>
	)
}

```

The initial components are Stage, Layer, Group, Rect, Circle, Ellipse, Line, Text, Image, Path, Star, and Transformer. Native Konva configuration attributes are accepted. Typed convenience events include onClick, onPointerDown, onDragMove, and onDragEnd. Konva handles hit testing, dragging, and automatic draw batching. Write drag results back into atoms to keep application state synchronized.

Stage is a browser boundary: SSR produces its empty container, and mounting or hydration creates the graphics resources. It uses the owning SPA root's store and lifetime. The exported konvaRenderer also supports rendering directly into a borrowed Konva container; disposing that root destroys only its owned children. Such a container must be dedicated to this renderer's children.
