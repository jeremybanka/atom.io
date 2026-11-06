import { render, useGetter } from "@atom.io/spa"
import { Group, Layer, Rect, Stage } from "@atom.io/spa/konva"
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
	const getSize = useGetter(sizeAtom)
	return (
		<>
			<sliding-panel
				id="motion-panel"
				style="display: block; width: 100px; height: 40px"
				motion:initial={{ x: 0 }}
				motion:animate={{ x: getSize() }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.1 }}
				motion:whileTap={{ scale: 0.9 }}
			>
				Motion panel
			</sliding-panel>
			<Stage width={getSize()} height={100}>
				<Layer>
					<Rect
						motion:initial={{ x: 0 }}
						motion:animate={{ x: getSize() / 10 }}
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
				width={getSize()}
				height={100}
				onFrame={(state) => {
					camera = state.camera
					frames++
				}}
			>
				<Mesh
					motion:animate={{ position: [getSize() / 100 - 1, 0, 0], scale: 1 }}
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

const presentAtom = atom<boolean>({ key: `present`, default: true })
let presenceRoot: ReturnType<typeof render>
let presenceMesh: any, presenceRect: any, presenceStage: any
let userFrames = 0,
	draws = 0,
	disposed = 0,
	clicks = 0
let originalPanel: Element | null, originalMesh: any, originalRect: any
function PresenceApp() {
	const getPresent = useGetter(presentAtom)
	return (
		<>
			{getPresent() && (
				<section
					id="presence-panel"
					key="panel"
					motion:exit={{ opacity: 0 }}
					motion:transition={{ duration: 0.4 }}
				>
					<button
						id="presence-button"
						onClick={() => {
							clicks++
						}}
					>
						active
					</button>
					<Stage
						width={100}
						height={100}
						ref={(node) => {
							presenceStage = node
						}}
					>
						<Layer>
							<Rect
								width={40}
								height={40}
								fill="blue"
								motion:exit={{ x: 80 }}
								motion:transition={{ duration: 0.4 }}
								ref={(node) => {
									presenceRect = node
								}}
							/>
						</Layer>
					</Stage>
					<Canvas
						width={100}
						height={100}
						onFrame={({ renderer }) => {
							userFrames++
							if (!draws) {
								const draw = renderer.render.bind(renderer)
								renderer.render = (...args) => {
									draws++
									draw(...args)
								}
							}
						}}
					>
						<Mesh
							motion:exit={{ position: [1, 0, 0] }}
							motion:transition={{ duration: 0.4 }}
							ref={(node) => {
								if (node) {
									presenceMesh = node
									node.geometry.addEventListener(`dispose`, () => {
										disposed++
									})
								}
							}}
						>
							<BoxGeometry />
							<MeshBasicMaterial color="blue" />
						</Mesh>
					</Canvas>
				</section>
			)}
		</>
	)
}
Object.assign(window, {
	presence: {
		start() {
			presenceRoot = render(() => <PresenceApp />, document.body, {
				capabilities: [motionCapability({ reducedMotion: `never` })],
			})
			originalPanel = document.querySelector(`#presence-panel`)
			originalMesh = presenceMesh
			originalRect = presenceRect
		},
		show(value: boolean) {
			setState(presentAtom, value)
			presenceRoot.flush()
		},
		inspect() {
			return {
				userFrames,
				draws,
				disposed,
				clicks,
				stageListening: presenceStage?.listening(),
				rectListening: presenceRect?.listening(),
				samePanel: document.querySelector(`#presence-panel`) === originalPanel,
				sameMesh: presenceMesh === originalMesh,
				sameRect: presenceRect === originalRect,
			}
		},
		dispose() {
			presenceRoot.dispose()
		},
	},
})

// Real native drags must end on logical removal, before retained nodes detach.
Object.assign(window, {
	konvaDrag(mode: `rect` | `group` | `stage`, initiallyDraggable = true) {
		const shownAtom = atom<boolean>({ key: `shown`, default: true })
		let stage: any, dragRect: any
		let dragMoves = 0,
			ends = 0
		function Drawing() {
			return (
				<Rect
					width={40}
					height={40}
					fill="blue"
					draggable={initiallyDraggable}
					motion:exit={{ opacity: 0 }}
					motion:transition={{ duration: 2 }}
					onDragMove={() => {
						dragMoves++
					}}
					onDragEnd={() => {
						ends++
					}}
					ref={(node) => {
						dragRect = node
					}}
				/>
			)
		}
		function DragApp() {
			const getShown = useGetter(shownAtom)
			const layer = () => (
				<Layer>
					{mode === `rect` ? (
						getShown() && <Drawing key="dragRect" />
					) : mode === `group` ? (
						getShown() && (
							<Group key="group">
								<Drawing />
							</Group>
						)
					) : (
						<Drawing />
					)}
				</Layer>
			)
			return (
				<>
					{(mode !== `stage` || getShown()) && (
						<Stage
							key="stage"
							width={200}
							height={200}
							draggable={mode === `stage`}
							ref={(node) => {
								stage = node
							}}
						>
							{layer()}
						</Stage>
					)}
				</>
			)
		}
		const dragRoot = render(() => <DragApp />, document.body, {
			capabilities: [motionCapability({ reducedMotion: `never` })],
		})
		const original = dragRect
		return {
			show(value: boolean) {
				setState(shownAtom, value)
				dragRoot.flush()
			},
			startRect() {
				dragRect.startDrag()
			},
			inspect() {
				return {
					x: dragRect.x(),
					stageX: stage.x(),
					dragging: dragRect.isDragging(),
					stageDragging: stage.isDragging(),
					draggable: dragRect.draggable(),
					stageDraggable: stage.draggable(),
					sameRect: dragRect === original,
					moves: dragMoves,
					ends,
				}
			},
			dispose() {
				dragRoot.dispose()
			},
		}
	},
})
