import { render } from "@atom.io/spa"
import { floatingCapability } from "@atom.io/spa/floating"
import { Circle, Layer, Stage } from "@atom.io/spa/konva"
import { layoutCapability } from "@atom.io/spa/layout"
import { motionCapability } from "@atom.io/spa/motion"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshNormalMaterial,
} from "@atom.io/spa/three"
import * as THREE from "three"

const capability = motionCapability()
render(
	() => (
		<sliding-panel
			motion:initial={{ opacity: 0 }}
			motion:animate={{ x: 100, opacity: 1 }}
			motion:exit={{ x: -20, opacity: 0 }}
			motion:transition={{ type: `spring`, stiffness: 180 }}
			motion:whileHover={{ scale: 1.1 }}
			motion:whileTap={{ scale: 0.9 }}
		/>
	),
	document.body,
	{ capabilities: [capability] },
)
const scene = (
	<Canvas>
		<Mesh
			motion:animate={{ position: [1, 0, 0], scale: 2 }}
			motion:exit={{ position: [0, 0, -2], scale: 0 }}
		>
			<BoxGeometry />
			<MeshNormalMaterial />
		</Mesh>
	</Canvas>
)
const drawing = (
	<Stage>
		<Layer>
			<Circle radius={20} motion:animate={{ x: 100 }} motion:exit={{ x: 0 }} />
		</Layer>
	</Stage>
)
// @ts-expect-error: Three.js motion targets preserve tuple dimensions.
const badVector = <Mesh motion:animate={{ position: [1, 2] }} />
// @ts-expect-error: DOM keyframes contain scalar values.
const badDOM = <sliding-panel motion:animate={{ x: [1, false, 3] }} />
// @ts-expect-error: Motion transition options are checked against the installed peer.
const badTransition = <sliding-panel motion:transition={{ stiffness: `fast` }} />
void [scene, drawing, badVector, badDOM, badTransition]

const input = (
	<Mesh
		onPointerDown={(event) => {
			event.currentTarget.geometry.computeBoundingBox()
			event.stopPropagation()
			event.preventDefault()
			event.setPointerCapture()
			event.releasePointerCapture()
			const native: PointerEvent = event.nativeEvent
			void native
			// @ts-expect-error: A mesh currentTarget is not a DOM element.
			event.currentTarget.style
		}}
	/>
)
void input

// @ts-expect-error: Exit targets have the same native tuple constraints as animate targets.
const badExit = <Mesh motion:exit={{ position: [1, 2] }} />
// @ts-expect-error: DOM exits require at least two keyframes.
const badDOMExit = <sliding-panel motion:exit={{ x: [1] }} />
void [badExit, badDOMExit]

const overlay = (
	<div
		floating:reference={document.createElement(`button`)}
		floating:placement="bottom-start"
		floating:strategy="fixed"
		floating:middleware={[]}
		floating:autoUpdate={{ animationFrame: true }}
		motion:animate={{ scale: 0.9, y: -4 }}
	/>
)
render(() => overlay, document.body, {
	capabilities: [floatingCapability(), capability],
})
// @ts-expect-error: Placements use Floating UI's placement union.
const badPlacement = <div floating:placement="somewhere" />
// @ts-expect-error: The floating overlay must be an HTML element, not a Three.js node.
const badSceneFloating = <Mesh floating:placement="bottom" />
// @ts-expect-error: References are DOM or virtual elements.
const badReference = <div floating:reference="anchor" />
void [badPlacement, badSceneFloating, badReference]

const customGeometry = new THREE.ExtrudeGeometry(new THREE.Shape(), {
	depth: 0.3,
	bevelEnabled: false,
})
const customMaterial = new THREE.MeshStandardMaterial()
const customMesh = <Mesh args={[customGeometry, customMaterial]} />
const multiMaterialMesh = <Mesh args={[customGeometry, [customMaterial]]} />
const defaultGeometryMesh = <Mesh args={[undefined, customMaterial]} />
const emptyMesh = <Mesh args={[]} />
// @ts-expect-error: Mesh geometry must be a Three BufferGeometry.
const badGeometry = <Mesh args={[`geometry`]} />
// @ts-expect-error: Mesh materials must be Three Material instances.
const badMaterial = <Mesh args={[customGeometry, [42]]} />
void [
	customMesh,
	multiMaterialMesh,
	defaultGeometryMesh,
	emptyMesh,
	badGeometry,
	badMaterial,
]

const sequence = (
	<sliding-panel
		motion:animate={{
			x: [`-1500%`, `2%`, `4%`, `1500%`],
			opacity: [null, 1, 0],
		}}
		motion:transition={{
			duration: 3,
			default: { ease: `linear` },
			properties: {
				x: { times: [0, 0.1, 0.77, 1], ease: [`circOut`, `linear`, `easeIn`] },
				opacity: { duration: 1 },
			},
		}}
	/>
)
// @ts-expect-error: Keyframe timing values are numeric.
const badTimes = <sliding-panel motion:transition={{ times: [`slow`] }} />
// @ts-expect-error: Each segment easing is a known easing or cubic-bezier tuple.
const badEase = <sliding-panel motion:transition={{ ease: [`linear`, `wat`] }} />
// @ts-expect-error: Initial DOM targets are scalar values.
const badInitial = <sliding-panel motion:initial={{ x: [0, 1] }} />
void [sequence, badTimes, badEase, badInitial]

const configuredCanvas = (
	<Canvas
		rendererOptions={{ alpha: true, powerPreference: `high-performance` }}
		dpr={[1, 2]}
		onCreated={({ renderer, scene: nativeScene, camera }) => {
			renderer.render(nativeScene, camera)
		}}
		onResize={({ width, dpr }) => {
			void [width, dpr]
		}}
	/>
)
// @ts-expect-error: Canvas supplies its own canvas to the renderer.
const badCanvasElement = <Canvas rendererOptions={{ canvas: undefined }} />
// @ts-expect-error: DPR accepts a number or a pair of clamp bounds.
const badDpr = <Canvas dpr={[1, 2, 3]} />
void [configuredCanvas, badCanvasElement, badDpr]

const projected = (
	<section
		layout:animate="position"
		layout:id="player"
		layout:group="match"
		layout:scroll
		layout:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
	/>
)
render(() => projected, document.body, { capabilities: [layoutCapability()] })
// @ts-expect-error: Layout animation modes are position, size, or boolean.
const badLayoutMode = <section layout:animate="everything" />
// @ts-expect-error: Layout projection requires HTML nodes, not scene objects.
const badSceneLayout = <Mesh layout:animate />
// @ts-expect-error: Shared layout identities are strings or numbers.
const badLayoutId = <section layout:id={{ id: 1 }} />
void [badLayoutMode, badSceneLayout, badLayoutId]
