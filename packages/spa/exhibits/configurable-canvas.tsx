import type { SpaElement } from "@atom.io/spa"
import { BoxGeometry, Canvas, Mesh, MeshBasicMaterial } from "@atom.io/spa/three"
import { ACESFilmicToneMapping, SRGBColorSpace } from "three"

export function BoardCanvas(): SpaElement {
	return (
		<Canvas
			width={800}
			height={600}
			dpr={[1, 2]}
			rendererOptions={{ alpha: true, powerPreference: `high-performance` }}
			onCreated={({ renderer, scene }) => {
				renderer.toneMapping = ACESFilmicToneMapping
				renderer.outputColorSpace = SRGBColorSpace
				scene.background = null
			}}
		>
			<Mesh>
				<BoxGeometry />
				<MeshBasicMaterial color="orange" />
			</Mesh>
		</Canvas>
	)
}
