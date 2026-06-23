import type { VNode } from "preact"
import * as React from "react"
import * as THREE from "three"

import css from "./Dz2Orbital.module.css"

const FINAL_SPIN_RADIANS = 1.1
const MAX_PIXEL_RATIO = 1.25
const SETTLED_ROTATION_X = 1.4
const SETTLED_ROTATION_Z = -1.4
const Y_ROTATION_RADIANS_PER_SECOND = Math.PI / 4

export type Dz2OrbitalProps = {
	variant?: `mark` | `splash`
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

	points[points.length - 1].setY(points[points.length - 2].y)
	points[0].setY(points[1].y)
	return new THREE.LatheGeometry(points, 96)
}
export function Dz2Orbital({ variant = `splash` }: Dz2OrbitalProps): VNode {
	const hostRef = React.useRef<HTMLElement | null>(null)

	React.useEffect(() => {
		const host = hostRef.current
		if (!host) return
		const isMark = variant === `mark`

		const renderer = new THREE.WebGLRenderer({
			alpha: true,
			antialias: true,
			powerPreference: isMark ? `low-power` : `high-performance`,
		})
		renderer.setClearColor(0x000000, 0)
		renderer.setPixelRatio(
			isMark ? 1 : Math.min(devicePixelRatio, MAX_PIXEL_RATIO),
		)
		host.append(renderer.domElement)

		const scene = new THREE.Scene()
		const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
		camera.position.set(4.2, 2.4, 6.6)
		camera.lookAt(0, 0, 0)

		const orbital = new THREE.Group()
		orbital.rotation.set(SETTLED_ROTATION_X, 0, SETTLED_ROTATION_Z)
		scene.add(orbital)

		const lobeMaterial = new THREE.MeshToonMaterial({
			color: 0xff3366,
			emissive: 0x145c72,
			emissiveIntensity: 0.22,
			// shininess: 5,
			// specular: 0xffd6df,

			// transparent: true,
			opacity: 0.82,
			side: THREE.DoubleSide,
		})
		const torusMaterial = new THREE.MeshToonMaterial({
			color: 0x0099ff,
			emissive: 0x0000ff,
			// emissive: 0x6f3a00,
			emissiveIntensity: 0.17,
			// shininess: 1,
			// specular: 0xc4ffff,
			// transparent: true,
			opacity: 0.72,
			side: THREE.DoubleSide,
		})

		const topLobe = new THREE.Mesh(makeLobeGeometry(1), lobeMaterial)
		const bottomLobe = new THREE.Mesh(makeLobeGeometry(-1), lobeMaterial)
		const torus = new THREE.Mesh(
			new THREE.TorusGeometry(1.2, 0.3, 36, 144),
			torusMaterial,
		)
		torus.rotation.x = Math.PI / 2
		orbital.add(topLobe, bottomLobe, torus)

		const coreLight = new THREE.PointLight(0xffffff, 28, 9)
		coreLight.position.set(1.8, 1.7, 3.5)
		scene.add(coreLight)
		scene.add(new THREE.AmbientLight(0x9fd6ff, 1.4))

		const resize = () => {
			const width = isMark ? Math.max(host.clientWidth, 1) : innerWidth
			const height = isMark ? Math.max(host.clientHeight, 1) : innerHeight
			renderer.setSize(width, height, false)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			if (isMark) {
				orbital.scale.setScalar(1.25)
				orbital.position.set(0, 0, 0)
				orbital.rotation.set(
					SETTLED_ROTATION_X,
					FINAL_SPIN_RADIANS,
					SETTLED_ROTATION_Z,
				)
			} else {
				const narrow = innerWidth < 680
				orbital.scale.setScalar(narrow ? 0.52 : 0.72)
				orbital.position.set(0, narrow ? -0.08 : 0, 0)
			}
			renderer.render(scene, camera)
		}

		let frameId = 0
		const timer = new THREE.Timer()
		timer.connect(document)
		const animate = (timestamp?: DOMHighResTimeStamp) => {
			timer.update(timestamp)
			const elapsed = timer.getElapsed()
			orbital.rotation.y =
				FINAL_SPIN_RADIANS + elapsed * Y_ROTATION_RADIANS_PER_SECOND
			renderer.render(scene, camera)
			frameId = requestAnimationFrame(animate)
		}

		resize()
		addEventListener(`resize`, resize)
		animate()

		return () => {
			cancelAnimationFrame(frameId)
			removeEventListener(`resize`, resize)
			topLobe.geometry.dispose()
			bottomLobe.geometry.dispose()
			torus.geometry.dispose()
			lobeMaterial.dispose()
			torusMaterial.dispose()
			timer.dispose()
			renderer.dispose()
			renderer.domElement.remove()
		}
	}, [variant])

	return (
		<dz2-orbital
			ref={hostRef}
			class={css.class}
			data-variant={variant}
			aria-hidden="true"
		/>
	)
}
