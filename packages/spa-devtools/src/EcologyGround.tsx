/** @jsxImportSource @atom.io/spa */
import { onCleanup, type SpaElement } from "@atom.io/spa"
import { Mesh } from "@atom.io/spa/three"
import * as THREE from "three"

/** A quiet world-space floor, painted only when the ecology scene is dirty. */
export function EcologyGround(props: { height: number }): SpaElement {
	const geometry = new THREE.PlaneGeometry(320, 320)
	const material = new THREE.ShaderMaterial({
		transparent: true,
		depthWrite: false,
		depthTest: false,
		side: THREE.DoubleSide,
		vertexShader: `
			varying vec3 worldPoint;
			void main() {
				vec4 point = modelMatrix * vec4(position, 1.0);
				worldPoint = point.xyz;
				gl_Position = projectionMatrix * viewMatrix * point;
			}
		`,
		fragmentShader: `
			varying vec3 worldPoint;
			float grid(float spacing) {
				vec2 cell = worldPoint.xz / spacing;
				vec2 footprint = fwidth(cell);
				vec2 line = abs(fract(cell - 0.5) - 0.5) / max(footprint, vec2(0.0001));
				float coverage = 1.0 - min(min(line.x, line.y), 1.0);
				// Suppress subpixel cells before they turn into noise at the horizon.
				return coverage * (1.0 - smoothstep(0.25, 1.0, max(footprint.x, footprint.y)));
			}
			void main() {
				float distanceFade = 1.0 - smoothstep(20.0, 120.0, distance(worldPoint.xz, cameraPosition.xz));
				float edgeFade = 1.0 - smoothstep(40.0, 120.0, length(worldPoint.xz));
				float alpha = max(grid(2.0) * 0.13, grid(10.0) * 0.20) * distanceFade * edgeFade;
				if (alpha < 0.001) discard;
				gl_FragColor = vec4(vec3(0.25), alpha);
				#include <colorspace_fragment>
			}
		`,
	})
	onCleanup(() => {
		geometry.dispose()
		material.dispose()
	})
	return (
		// eslint-disable-next-line lasertag/render-tag-with-own-name -- Three.js components render scene objects rather than DOM tags.
		<Mesh
			name="ecology-ground"
			args={[geometry, material]}
			position={[0, -props.height / 2 - 2, 0]}
			rotation={[-Math.PI / 2, 0, 0]}
			ref={(mesh) => {
				if (mesh) mesh.renderOrder = -2
			}}
		/>
	)
}
