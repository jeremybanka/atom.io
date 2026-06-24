import * as THREE from "three"

export const DZ2_ORBITAL_FINAL_SPIN_RADIANS = 1.1
export const DZ2_ORBITAL_SETTLED_ROTATION_X = 1.4
export const DZ2_ORBITAL_SETTLED_ROTATION_Z = -1.4
export const DZ2_ORBITAL_Y_ROTATION_RADIANS_PER_SECOND = Math.PI / 4
export const DZ2_ORBITAL_LOBE_CENTER_OFFSET = 0.05

export const DZ2_ORBITAL_CAMERA = {
	fov: 34,
	near: 0.1,
	far: 100,
	position: [4.2, 2.4, 6.6],
	lookAt: [0, 0, 0],
} satisfies {
	fov: number
	near: number
	far: number
	position: [number, number, number]
	lookAt: [number, number, number]
}

export const DZ2_ORBITAL_LIGHTS = {
	core: {
		color: 0xffffff,
		intensity: 28,
		distance: 9,
		position: [1.8, 1.7, 3.5],
	},
	ambient: {
		color: 0x9fd6ff,
		intensity: 1.4,
	},
} satisfies {
	core: {
		color: number
		intensity: number
		distance: number
		position: [number, number, number]
	}
	ambient: {
		color: number
		intensity: number
	}
}

export type Dz2OrbitalMesh = THREE.Mesh<
	THREE.BufferGeometry,
	THREE.MeshToonMaterial
>

export type Dz2OrbitalModel = {
	orbital: THREE.Group
	meshes: Dz2OrbitalMesh[]
	materials: {
		lobe: THREE.MeshToonMaterial
		torus: THREE.MeshToonMaterial
	}
}

function makeLobeGeometry(direction: 1 | -1): THREE.LatheGeometry {
	const points: THREE.Vector2[] = []
	const height = 1.5
	const radius = 0.75
	for (let index = 0; index <= 44; index++) {
		const progress = index / 45
		const easedRadius =
			radius * Math.sin(Math.PI * progress) ** 0.58 * (0.5 + progress * 0.6)

		points.push(new THREE.Vector2(easedRadius, direction * progress * height))
	}

	for (let index = 440; index <= 450; index++) {
		const progress = index / 450
		const easedRadius =
			radius * Math.sin(Math.PI * progress) ** 0.58 * (0.5 + progress * 0.6)
		points.push(new THREE.Vector2(easedRadius, direction * progress * height))
	}

	const lastPoint = points[points.length - 1]
	const nextToLastPoint = points[points.length - 2]
	if (!lastPoint || !nextToLastPoint || !points[1]) {
		throw new Error(`Lobe geometry needs at least three profile points.`)
	}
	lastPoint.setY(nextToLastPoint.y)
	points[0].setY(points[1].y)
	return new THREE.LatheGeometry(points, 96)
}

export function createDz2OrbitalCamera(aspect = 1): THREE.PerspectiveCamera {
	const camera = new THREE.PerspectiveCamera(
		DZ2_ORBITAL_CAMERA.fov,
		aspect,
		DZ2_ORBITAL_CAMERA.near,
		DZ2_ORBITAL_CAMERA.far,
	)
	camera.position.set(...DZ2_ORBITAL_CAMERA.position)
	camera.lookAt(...DZ2_ORBITAL_CAMERA.lookAt)
	return camera
}

export function addDz2OrbitalLights(scene: THREE.Scene): void {
	const coreLight = new THREE.PointLight(
		DZ2_ORBITAL_LIGHTS.core.color,
		DZ2_ORBITAL_LIGHTS.core.intensity,
		DZ2_ORBITAL_LIGHTS.core.distance,
	)
	coreLight.position.set(...DZ2_ORBITAL_LIGHTS.core.position)
	scene.add(coreLight)
	scene.add(
		new THREE.AmbientLight(
			DZ2_ORBITAL_LIGHTS.ambient.color,
			DZ2_ORBITAL_LIGHTS.ambient.intensity,
		),
	)
}

export function setDz2OrbitalRotation(
	orbital: THREE.Object3D,
	y = DZ2_ORBITAL_FINAL_SPIN_RADIANS,
): void {
	orbital.rotation.set(
		DZ2_ORBITAL_SETTLED_ROTATION_X,
		y,
		DZ2_ORBITAL_SETTLED_ROTATION_Z,
	)
}

export function createDz2OrbitalModel(): Dz2OrbitalModel {
	const orbital = new THREE.Group()
	setDz2OrbitalRotation(orbital)

	const lobeMaterial = new THREE.MeshToonMaterial({
		color: 0xff3366,
		emissive: 0xff3366,
		emissiveIntensity: 0.22,
		opacity: 0.82,
		side: THREE.DoubleSide,
	})
	const torusMaterial = new THREE.MeshToonMaterial({
		color: 0x0099ff,
		emissive: 0x0099ff,
		emissiveIntensity: 0.17,
		opacity: 0.72,
		side: THREE.DoubleSide,
	})

	const topLobe: Dz2OrbitalMesh = new THREE.Mesh(
		makeLobeGeometry(1),
		lobeMaterial,
	)
	const bottomLobe: Dz2OrbitalMesh = new THREE.Mesh(
		makeLobeGeometry(-1),
		lobeMaterial,
	)
	topLobe.position.y = DZ2_ORBITAL_LOBE_CENTER_OFFSET
	bottomLobe.position.y = -DZ2_ORBITAL_LOBE_CENTER_OFFSET
	const torus: Dz2OrbitalMesh = new THREE.Mesh(
		new THREE.TorusGeometry(1.2, 0.3, 36, 144),
		torusMaterial,
	)
	torus.rotation.x = Math.PI / 2
	const meshes = [topLobe, bottomLobe, torus]
	orbital.add(...meshes)

	return {
		orbital,
		meshes,
		materials: {
			lobe: lobeMaterial,
			torus: torusMaterial,
		},
	}
}

export function disposeDz2OrbitalModel(model: Dz2OrbitalModel): void {
	for (const mesh of model.meshes) {
		mesh.geometry.dispose()
	}
	model.materials.lobe.dispose()
	model.materials.torus.dispose()
}
