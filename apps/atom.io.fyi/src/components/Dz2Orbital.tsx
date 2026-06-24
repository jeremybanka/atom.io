import type { VNode } from "preact"
import * as React from "react"
import * as THREE from "three"

import {
	addDz2OrbitalLights,
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
	DZ2_ORBITAL_FINAL_SPIN_RADIANS,
	DZ2_ORBITAL_Y_ROTATION_RADIANS_PER_SECOND,
	setDz2OrbitalRotation,
} from "./dz2-orbital-three"
import css from "./Dz2Orbital.module.css"

const MAX_MARK_PIXEL_RATIO = 2
const MAX_SPLASH_PIXEL_RATIO = 1.35
const MAX_SPLASH_DRAWING_BUFFER_PIXELS = 16_000_000

function getDz2OrbitalPixelRatio(
	isMark: boolean,
	width: number,
	height: number,
): number {
	const cappedPixelRatio = Math.min(
		window.devicePixelRatio || 1,
		isMark ? MAX_MARK_PIXEL_RATIO : MAX_SPLASH_PIXEL_RATIO,
	)
	if (isMark) {
		return cappedPixelRatio
	}

	const pixelRatioFromBudget = Math.sqrt(
		MAX_SPLASH_DRAWING_BUFFER_PIXELS / (width * height),
	)
	return Math.min(cappedPixelRatio, pixelRatioFromBudget)
}

export type Dz2OrbitalProps = {
	variant?: `mark` | `splash`
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
		host.append(renderer.domElement)

		const scene = new THREE.Scene()
		const camera = createDz2OrbitalCamera()
		const model = createDz2OrbitalModel()
		scene.add(model.orbital)
		addDz2OrbitalLights(scene)

		const resize = () => {
			const width = Math.max(host.clientWidth, 1)
			const height = Math.max(host.clientHeight, 1)
			renderer.setPixelRatio(getDz2OrbitalPixelRatio(isMark, width, height))
			renderer.setSize(width, height, false)
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			if (isMark) {
				model.orbital.scale.setScalar(1.25)
				model.orbital.position.set(0, 0, 0)
				setDz2OrbitalRotation(model.orbital)
			} else {
				const narrow = innerWidth < 680
				model.orbital.scale.setScalar(narrow ? 0.52 : 0.72)
				model.orbital.position.set(0, narrow ? -0.08 : 0, 0)
			}
			renderer.render(scene, camera)
		}

		let frameId = 0
		const timer = new THREE.Timer()
		timer.connect(document)
		const animate = (timestamp?: DOMHighResTimeStamp) => {
			timer.update(timestamp)
			const elapsed = timer.getElapsed()
			model.orbital.rotation.y =
				DZ2_ORBITAL_FINAL_SPIN_RADIANS +
				elapsed * DZ2_ORBITAL_Y_ROTATION_RADIANS_PER_SECOND
			renderer.render(scene, camera)
			frameId = requestAnimationFrame(animate)
		}

		resize()
		const resizeObserver = new ResizeObserver(resize)
		resizeObserver.observe(host)
		addEventListener(`resize`, resize)
		animate()

		return () => {
			cancelAnimationFrame(frameId)
			resizeObserver.disconnect()
			removeEventListener(`resize`, resize)
			disposeDz2OrbitalModel(model)
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
