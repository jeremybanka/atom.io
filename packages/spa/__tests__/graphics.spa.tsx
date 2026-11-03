import { render, useValue } from "@atom.io/spa"
import { atom, setState } from "atom.io"

import { Layer, Rect, Stage } from "../../spa-konva/src/index.ts"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshBasicMaterial,
} from "../../spa-three/src/index.ts"

const sizeAtom = atom<number>({ key: `size`, default: 100 })
let rect: any
let mesh: any
let frames = 0
function App() {
	const read = useValue(sizeAtom)
	return (
		<>
			<Stage width={read()} height={100}>
				<Layer>
					<Rect
						width={50}
						height={50}
						fill="red"
						ref={(node) => {
							rect = node
						}}
					/>
				</Layer>
			</Stage>
			<Canvas
				width={read()}
				height={100}
				onFrame={() => {
					frames++
				}}
			>
				<Mesh
					position={[read() / 100 - 1, 0, 0]}
					ref={(node) => {
						mesh = node
					}}
				>
					<BoxGeometry />
					<MeshBasicMaterial color="red" />
				</Mesh>
			</Canvas>
		</>
	)
}
const root = render(() => <App />, document.body)
Object.assign(window, {
	graphics: {
		update() {
			setState(sizeAtom, 200)
			root.flush()
		},
		inspect() {
			return {
				frames,
				x: mesh?.position.x,
				rectWidth: rect?.width(),
				canvases: [...document.querySelectorAll(`canvas`)].map(
					(canvas) => canvas.width,
				),
			}
		},
		dispose() {
			root.dispose()
		},
	},
})
