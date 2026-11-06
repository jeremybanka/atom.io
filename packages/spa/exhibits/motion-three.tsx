import type { VNode } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import {
	BoxGeometry,
	Canvas,
	Mesh,
	MeshNormalMaterial,
} from "@atom.io/spa/three"
import { atom } from "atom.io"

const targetXAtom = atom<number>({
	key: `targetX`,
	default: 1,
})
// Mount under a root with capabilities: [motionCapability()].
export function SpringCube(): VNode {
	const getTargetX = useGetter(targetXAtom)
	return (
		<Canvas>
			<Mesh
				motion:initial={{ position: [-1, 0, 0], scale: 0 }}
				motion:animate={{ position: [getTargetX(), 0, 0], scale: 1 }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.2 }}
				motion:whileTap={{ scale: 0.8 }}
				onPointerDown={(event) => {
					event.setPointerCapture()
				}}
			>
				<BoxGeometry />
				<MeshNormalMaterial />
			</Mesh>
		</Canvas>
	)
}
