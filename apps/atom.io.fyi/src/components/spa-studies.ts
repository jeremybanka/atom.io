import * as THREE from "three"

import {
	addDz2OrbitalLights,
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
} from "./dz2-orbital-three"
import { createSpaCloud } from "./spa-orbital-three"

export function mountSpaStudies(): () => void {
	const root = document.querySelector<HTMLElement>(`spa-lab`)
	const canvas = document.querySelector<HTMLCanvasElement>(`#orbital-canvas`)
	const status = document.querySelector<HTMLElement>(`#lab-status`)
	if (!root || !canvas || !status) return () => {}
	let renderer: THREE.WebGLRenderer
	try {
		renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
	} catch {
		status.textContent = `These studies need WebGL. Try a browser with hardware acceleration enabled.`
		return () => {}
	}
	renderer.setClearColor(0x000000, 0)
	renderer.autoClear = false
	const modelCloud = createSpaCloud()
	const { uniforms, scene: pointScene, camera: pointCamera } = modelCloud
	// Exaggerated for the mark: one quarter of the 2.05-unit display boundary.
	const protonGeometry = new THREE.SphereGeometry(2.05 / 4, 48, 32)
	const protonMaterial = new THREE.MeshStandardMaterial({
		color: 0xff2538,
		emissive: 0x660511,
		emissiveIntensity: 0.15,
		roughness: 0.38,
		depthWrite: true,
		transparent: false,
	})
	const proton: THREE.Mesh<THREE.SphereGeometry, THREE.Material> =
		new THREE.Mesh(protonGeometry, protonMaterial)
	// Opaque geometry fills the depth buffer before the transparent points:
	// front samples remain visible, while rear/interior samples are occluded.
	pointScene.add(proton)
	addDz2OrbitalLights(pointScene)
	const reference = new THREE.Scene()
	const referenceCamera = createDz2OrbitalCamera()
	const model = createDz2OrbitalModel()
	reference.add(model.orbital)
	addDz2OrbitalLights(reference)
	// Reuse the logo's actual toon material and light rig, keeping the proton red.
	const toonProtonMaterial = model.materials.lobe.clone()
	toonProtonMaterial.color.copy(protonMaterial.color)
	toonProtonMaterial.emissive.copy(protonMaterial.color)
	toonProtonMaterial.opacity = 1
	const views = [...root.querySelectorAll<HTMLElement>(`orbital-view`)]
	const abort = new AbortController()
	const { signal } = abort
	const reducedMotion = matchMedia(`(prefers-reduced-motion: reduce)`)
	let paused = reducedMotion.matches
	let dirty = true
	let disposed = false
	let frame = 0
	let previous = 0
	let elapsed = 0
	let width = 0
	let height = 0

	function draw(study: string, viewWidth: number, viewHeight: number): void {
		uniforms.uResolution.value.set(viewWidth, viewHeight)
		uniforms.uTime.value = elapsed
		if (study === `reference`) {
			referenceCamera.aspect = viewWidth / viewHeight
			referenceCamera.updateProjectionMatrix()
			model.orbital.rotation.y = 1.1 + elapsed * 0.12
			renderer.render(reference, referenceCamera)
		} else {
			uniforms.uNegative.value = study === `negative` ? 1 : 0
			proton.visible = study !== `negative`
			proton.material = study === `toon` ? toonProtonMaterial : protonMaterial
			modelCloud.update(
				viewWidth,
				viewHeight,
				uniforms.uPixelRatio.value,
				elapsed,
			)
			renderer.render(pointScene, pointCamera)
		}
	}

	function render(): void {
		const pixelRatio = Math.min(devicePixelRatio || 1, 1.5)
		if (
			width !== innerWidth ||
			height !== innerHeight ||
			renderer.getPixelRatio() !== pixelRatio
		) {
			width = innerWidth
			height = innerHeight
			renderer.setPixelRatio(pixelRatio)
			renderer.setSize(width, height, false)
		}
		uniforms.uPixelRatio.value = pixelRatio
		renderer.setScissorTest(false)
		renderer.clear()
		renderer.setScissorTest(true)
		for (const view of views) {
			const rect = view.getBoundingClientRect()
			if (rect.bottom <= 0 || rect.top >= height || !rect.width || !rect.height)
				continue
			renderer.setViewport(
				rect.left,
				height - rect.bottom,
				rect.width,
				rect.height,
			)
			renderer.setScissor(
				rect.left,
				height - rect.bottom,
				rect.width,
				rect.height,
			)
			draw(view.dataset.study ?? `points`, rect.width, rect.height)
		}
		renderer.setScissorTest(false)
		dirty = false
	}

	function animate(now: number): void {
		if (disposed) return
		frame = requestAnimationFrame(animate)
		if (document.hidden) {
			previous = now
			return
		}
		if (now - previous < 1000 / 30) return
		if (!paused) elapsed += Math.min((now - previous) / 1000, 0.1)
		previous = now
		if (dirty || !paused) render()
	}
	const invalidate = () => {
		dirty = true
	}
	addEventListener(`scroll`, invalidate, { passive: true, signal })
	addEventListener(`resize`, invalidate, { signal })
	const observer = new ResizeObserver(invalidate)
	for (const view of views) observer.observe(view)
	const motion = root.querySelector<HTMLButtonElement>(`#motion`)
	function updateMotion(): void {
		motion?.setAttribute(`aria-pressed`, String(paused))
		if (motion) motion.textContent = paused ? `Resume motion` : `Pause motion`
		dirty = true
	}
	motion?.addEventListener(
		`click`,
		() => {
			paused = !paused
			updateMotion()
		},
		{ signal },
	)
	reducedMotion.addEventListener(
		`change`,
		() => {
			paused = reducedMotion.matches
			updateMotion()
		},
		{ signal },
	)
	updateMotion()
	root.querySelector<HTMLSelectElement>(`#palette`)?.addEventListener(
		`change`,
		(event) => {
			const value = (event.currentTarget as HTMLSelectElement).value
			uniforms.uColor.value.set(
				value === `pink` ? `#ff3366` : value === `mono` ? `#b0b0b0` : `#0099ff`,
			)
			dirty = true
		},
		{ signal },
	)
	root.querySelector<HTMLSelectElement>(`#theme`)?.addEventListener(
		`change`,
		(event) => {
			const value = (event.currentTarget as HTMLSelectElement).value
			root.dataset.theme = value
			uniforms.uLight.value = value === `light` ? 1 : 0
			dirty = true
		},
		{ signal },
	)
	root.querySelector<HTMLInputElement>(`#density`)?.addEventListener(
		`input`,
		(event) => {
			const value = Number((event.currentTarget as HTMLInputElement).value)
			uniforms.uDensity.value = value
			const output = root.querySelector<HTMLOutputElement>(`#density-value`)
			if (output) output.value = `${value.toFixed(2)}×`
			dirty = true
		},
		{ signal },
	)

	function exportStudy(study: string): void {
		const requestedSize = Number(
			root?.querySelector<HTMLSelectElement>(`#export-size`)?.value ?? 1024,
		)
		const exportSize = [16, 32, 48, 512, 1024].includes(requestedSize)
			? requestedSize
			: 1024
		// Capture the canvas synchronously before the browser presents it. The
		// browser handles alpha/color conversion; readback from an sRGB render
		// target would require unpremultiplying in linear light, not sRGB.
		const size = renderer.getSize(new THREE.Vector2())
		const pixelRatio = renderer.getPixelRatio()
		try {
			renderer.setPixelRatio(1)
			renderer.setSize(exportSize, exportSize, false)
			renderer.setViewport(0, 0, exportSize, exportSize)
			renderer.setScissorTest(false)
			renderer.clear()
			uniforms.uPixelRatio.value = 1
			draw(study, exportSize, exportSize)
			const link = document.createElement(`a`)
			link.download = `spa-${study}.png`
			link.href = renderer.domElement.toDataURL(`image/png`)
			link.click()
			if (status)
				status.textContent = `Exported spa-${study}.png · ${exportSize} × ${exportSize} · transparent background`
		} finally {
			renderer.setPixelRatio(pixelRatio)
			renderer.setSize(size.x, size.y, false)
			render()
		}
	}

	for (const button of root.querySelectorAll<HTMLButtonElement>(
		`[data-export]`,
	)) {
		button.addEventListener(
			`click`,
			() => {
				try {
					exportStudy(button.dataset.export ?? `points`)
				} catch {
					status.textContent = `PNG export failed. Try reloading the page.`
				}
			},
			{ signal },
		)
	}
	canvas.addEventListener(
		`webglcontextlost`,
		(event) => {
			event.preventDefault()
			paused = true
			updateMotion()
			status.textContent = `The graphics context was interrupted. Reload to resume the studies.`
		},
		{ signal },
	)
	render()
	frame = requestAnimationFrame(animate)
	status.textContent = `Three centers / one shimmering cloud. Change the palette, compare at icon size, or export a favorite.`
	root.dataset.ready = `true`
	const dispose = () => {
		if (disposed) return
		disposed = true
		cancelAnimationFrame(frame)
		abort.abort()
		observer.disconnect()
		modelCloud.dispose()
		protonGeometry.dispose()
		protonMaterial.dispose()
		toonProtonMaterial.dispose()
		disposeDz2OrbitalModel(model)
		renderer.dispose()
	}
	addEventListener(
		`pagehide`,
		(event) => {
			if (!(event as PageTransitionEvent).persisted) dispose()
		},
		{ signal },
	)
	return dispose
}
