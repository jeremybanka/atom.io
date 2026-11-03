import { render } from "@atom.io/spa"
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
		<Mesh motion:animate={{ position: [1, 0, 0], scale: 2 }}>
			<BoxGeometry />
			<MeshNormalMaterial />
		</Mesh>
	</Canvas>
)
const drawing = (
	<Stage>
		<Layer>
			<Circle radius={20} motion:animate={{ x: 100 }} />
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
