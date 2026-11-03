import { render, useValue } from "@atom.io/spa"
import { Layer, Rect, Stage } from "@atom.io/spa/konva"
import { motionCapability } from "@atom.io/spa/motion"
import { BoxGeometry, Canvas, Mesh, MeshBasicMaterial } from "@atom.io/spa/three"
import { atom, setState } from "atom.io"

const sizeAtom = atom<number>({ key: `size`, default: 100 })
let rect: any
let mesh: any
let frames = 0
let camera: any
let downs = 0
let ups = 0
let moves = 0
function App() {
	const read = useValue(sizeAtom)
	return (
		<>
			<sliding-panel
				id="motion-panel"
				style="display: block; width: 100px; height: 40px"
				motion:initial={{ x: 0 }}
				motion:animate={{ x: read() }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.1 }}
				motion:whileTap={{ scale: 0.9 }}
			>
				Motion panel
			</sliding-panel>
			<Stage width={read()} height={100}>
				<Layer>
					<Rect
						motion:initial={{ x: 0 }}
						motion:animate={{ x: read() / 10 }}
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
				onFrame={(state) => {
					camera = state.camera
					frames++
				}}
			>
				<Mesh
					motion:animate={{ position: [read() / 100 - 1, 0, 0], scale: 1 }}
					motion:whileHover={{ scale: 1.2 }}
					motion:whileTap={{ scale: 0.8 }}
					onPointerDown={(event) => {
						downs++
						event.setPointerCapture()
					}}
					onPointerUp={() => {
						ups++
					}}
					onPointerMove={() => {
						moves++
					}}
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
const root = render(() => <App />, document.body, {
	capabilities: [motionCapability({ reducedMotion: `never` })],
})
Object.assign(window, {
	graphics: {
		point() {
			const point = mesh.getWorldPosition(mesh.position.clone()).project(camera)
			return { x: (point.x + 1) / 2, y: (1 - point.y) / 2 }
		},
		update() {
			setState(sizeAtom, 200)
			root.flush()
		},
		inspect() {
			return {
				frames,
				downs,
				ups,
				moves,
				scale: mesh?.scale.x,
				x: mesh?.position.x,
				rectWidth: rect?.width(),
				rectX: rect?.x(),
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
