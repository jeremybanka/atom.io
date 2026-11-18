import * as THREE from "three"
import { expect, it, vi } from "vitest"

import {
	addDz2OrbitalLights,
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
	setDz2OrbitalRotation,
} from "../src/brand-model.ts"

it(`shares the canonical orbital geometry, camera and light rig with asset tools`, () => {
	const camera = createDz2OrbitalCamera(),
		wide = createDz2OrbitalCamera(2)
	expect(camera.position.toArray()).toEqual([4.2, 2.4, 6.6])
	expect([camera.fov, camera.aspect, wide.aspect]).toEqual([34, 1, 2])
	const model = createDz2OrbitalModel()
	const scene = new THREE.Scene()
	addDz2OrbitalLights(scene)
	expect(scene.children.map((light) => light.type)).toEqual([
		`PointLight`,
		`AmbientLight`,
	])
	expect(model.meshes.map((mesh) => mesh.geometry.type)).toEqual([
		`LatheGeometry`,
		`LatheGeometry`,
		`TorusGeometry`,
	])
	expect(model.orbital.children).toEqual(model.meshes)
	setDz2OrbitalRotation(model.orbital, 2)
	expect(model.orbital.rotation.y).toBe(2)
	const resources = [
		...model.meshes.map((mesh) => mesh.geometry),
		...Object.values(model.materials),
	].map((value) => vi.spyOn(value, `dispose`))
	disposeDz2OrbitalModel(model)
	for (const dispose of resources) expect(dispose).toHaveBeenCalledOnce()
})
