import { render } from "@atom.io/spa"
import { floatingCapability } from "@atom.io/spa/floating"
import { Circle, Layer, Stage } from "@atom.io/spa/konva"
import { motionCapability } from "@atom.io/spa/motion"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshNormalMaterial,
} from "@atom.io/spa/three"

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
// @ts-expect-error: DOM motion targets are scalar CSS values, not scene tuples.
const badDOM = <sliding-panel motion:animate={{ x: [1, 2, 3] }} />
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
// @ts-expect-error: DOM exits accept scalar properties.
const badDOMExit = <sliding-panel motion:exit={{ x: [1, 2, 3] }} />
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
