import assert from "node:assert/strict"

import { floatingCapability } from "@atom.io/spa/floating"
import { jsx } from "@atom.io/spa/jsx-runtime"
import { Group, konvaRenderer } from "@atom.io/spa/konva"
import { motionCapability } from "@atom.io/spa/motion"
import {
	BoxGeometry,
	Mesh,
	MeshNormalMaterial,
	threeRenderer,
} from "@atom.io/spa/three"
import Konva from "konva"
import * as THREE from "three"

const capabilities = [motionCapability({ reducedMotion: `always` })]
assert.equal(floatingCapability().namespace, `floating`)
const scene = new THREE.Scene()
const root = threeRenderer.render(
	() =>
		jsx(Mesh, {
			"motion:animate": { position: [1, 2, 3] },
			children: [jsx(BoxGeometry, {}), jsx(MeshNormalMaterial, {})],
		}),
	scene,
	{ capabilities },
)
assert.deepEqual(scene.children[0].position.toArray(), [1, 2, 3])
root.dispose()
assert.equal(scene.children.length, 0)
const group = new Konva.Group()
const drawing = konvaRenderer.render(
	() => jsx(Group, { "motion:animate": { x: 20 } }),
	group,
	{ capabilities },
)
assert.equal(group.children[0].x(), 20)
drawing.dispose()
assert.equal(group.children.length, 0)
