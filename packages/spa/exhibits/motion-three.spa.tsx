import { useValue } from "@atom.io/spa"
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
export function SpringCube() {
	const x = useValue(targetXAtom)
	return (
		<Canvas>
			<Mesh
				motion:initial={{ position: [-1, 0, 0], scale: 0 }}
				motion:animate={{ position: [x(), 0, 0], scale: 1 }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
			>
				<BoxGeometry />
				<MeshNormalMaterial />
			</Mesh>
		</Canvas>
	)
}
