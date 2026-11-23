import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import {
	AmbientLight,
	BoxGeometry,
	Canvas,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
} from "@atom.io/spa/three"
import { atom } from "atom.io"

const colorAtom = atom<string>({ key: `color`, default: `coral` })
export default function Scene(): SpaElement {
	const getColor = useGetter(colorAtom)
	return (
		<Canvas width={240} height={180} rendererOptions={{ alpha: true }}>
			<AmbientLight intensity={0.5} />
			<DirectionalLight position={[3, 3, 3]} />
			<Mesh rotation={[0.3, 0.5, 0]}>
				<BoxGeometry args={[1, 1, 1]} />
				<MeshStandardMaterial color={getColor()} />
			</Mesh>
		</Canvas>
	)
}
