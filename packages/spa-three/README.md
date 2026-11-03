# @atom.io/spa-three

Experimental Three.js bindings for SPA. Install this package alongside @atom.io/spa, atom.io, three, and @types/three. Use SPA's Vite plugin and JSX configuration; these components use the existing SPA JSX runtime.

Canvas renders a DOM canvas and creates a WebGL renderer after mounting. Atom reads in compiled JSX update native scene objects without rerunning component setup. Keyed children retain their native objects when reordered. Position, rotation, and scale accept tuples; scale also accepts a scalar. Material colors accept Three.js color representations.

```tsx
import { useValue } from "@atom.io/spa"
import {
	AmbientLight,
	BoxGeometry,
	Canvas,
	DirectionalLight,
	Mesh,
	MeshStandardMaterial,
} from "@atom.io/spa-three"
import { atom } from "atom.io"

const colorAtom = atom<string>({ key: `color`, default: `coral` })
export function Scene() {
	const color = useValue(colorAtom)
	return (
		<Canvas width={800} height={600}>
			<AmbientLight intensity={0.5} />
			<DirectionalLight position={[3, 3, 3]} />
			<Mesh rotation={[0.3, 0.5, 0]}>
				<BoxGeometry args={[1, 1, 1]} />
				<MeshStandardMaterial color={color()} />
			</Mesh>
		</Canvas>
	)
}

```

The initial components are Group, Mesh, PerspectiveCamera, AmbientLight, DirectionalLight, BoxGeometry, SphereGeometry, PlaneGeometry, MeshStandardMaterial, MeshBasicMaterial, and MeshNormalMaterial. Geometry and material children attach to their Mesh; each Mesh accepts one of each and should provide both. Constructor args are fixed for an instance: change its JSX key to replace a geometry or camera with different constructor arguments.

Canvas provides a default perspective camera at z = 5. Its optional camera prop borrows an external camera; a PerspectiveCamera child is an ordinary scene object and does not automatically become active. Canvas resizes its renderer and default camera from width and height props. It renders continuously, with an optional onFrame callback receiving scene, camera, renderer, delta seconds, and elapsed timestamp seconds. Pointer raycasting, event propagation, controls, asset loading, and drawing on demand are outside this initial API.

Refs receive native objects and null on cleanup. Owned geometry and material nodes are disposed when removed. Textures supplied through material properties and the external camera remain borrowed; callers manage their lifetimes. Canvas stops its animation loop and disposes the WebGL renderer on removal. SSR produces an empty canvas; WebGL work starts on mounting or hydration and uses the owning SPA store.

The exported threeRenderer supports rendering into a borrowed Three.js parent without creating a WebGL renderer. Its target must be dedicated to the renderer's children; disposing its root removes owned objects and disposes owned resources.
