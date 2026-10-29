import * as THREE from "three"

import {
	addDz2OrbitalLights,
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
} from "./dz2-orbital-three"

const POINT_COUNT = 64_000

// A steady projected sphere supports the silhouette where individual samples
// become too sparse to describe it. It is only drawn in the small previews.
const CLOUD_VERTEX = `
varying vec2 vUv;
void main() {
 vUv = uv;
 gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`
const CLOUD_FRAGMENT = `
uniform vec3 uColor;
uniform float uLight;
uniform float uNegative;
uniform float uDensity;
varying vec2 vUv;
void main() {
 float radius = length((vUv - .5) * 2.);
 if (radius >= 1. || (uNegative > .5 && radius < .25)) discard;
 float depth = sqrt(max(0., 1. - radius*radius));
 float alpha = (.1 + .12*depth) * (1. - smoothstep(.86, 1., radius));
 vec3 color = uLight > .5 ? uColor*.65 : uColor;
 gl_FragColor = vec4(color, alpha*uDensity);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`

const POINT_VERTEX = `
uniform float uPixelRatio;
uniform float uDensity;
uniform float uSize;
uniform float uTime;
uniform vec2 uResolution;
attribute vec3 shimmer;
varying float vDepth;
varying float vOpacity;
varying vec2 vViewPosition;
varying float vPointWorldSize;
void main() {
 vec4 mv = modelViewMatrix * vec4(position, 1.);
 gl_Position = projectionMatrix * mv;
 gl_PointSize = clamp(uSize * uPixelRatio * shimmer.z, 1., 16.);
 vViewPosition = mv.xy;
 vPointWorldSize = gl_PointSize * 5.4 / (uResolution.y * uPixelRatio);
 // A soft display boundary makes the spherical volume legible. It is not
 // a physical edge of the 1s orbital, whose density extends indefinitely.
 float envelope = 1. - smoothstep(1.55, 2.05, length(position));
 vDepth = clamp((mv.z + 5. + 2.05) / 4.1, 0., 1.);
 // Each sample has its own phase and period (roughly 2–6 s).
 // A second, slower wave keeps the shimmer from looking synchronized.
 float wave = .5 + .5*sin(uTime*shimmer.y + shimmer.x
   + .45*sin(uTime*.37 + shimmer.x*2.));
 float brightness = mix(.08, 1., smoothstep(.05, .95, wave));
 vOpacity = envelope * brightness * mix(.3, 1., vDepth) * uDensity;
}`
const POINT_FRAGMENT = `
uniform vec3 uColor;
uniform float uLight;
uniform float uNegative;
varying float vDepth;
varying float vOpacity;
varying vec2 vViewPosition;
varying float vPointWorldSize;
void main() {
 float r = length(gl_PointCoord-.5)*2.;
 if (r > 1.) discard;
 // Cut through foreground and background samples alike, leaving real alpha.
 vec2 viewPosition = vViewPosition + (gl_PointCoord - .5)
   * vec2(1., -1.) * vPointWorldSize;
 if (uNegative > .5 && length(viewPosition) < 2.05/4.) discard;
 vec3 color = mix(uColor,vec3(1.),vDepth*.12);
 if (uLight > .5) color = uColor*.65;
 gl_FragColor = vec4(color,(1.-smoothstep(.35,1.,r))*.85*vOpacity);
 #include <tonemapping_fragment>
 #include <colorspace_fragment>
}`

function createPointGeometry(): THREE.BufferGeometry {
	// r² exp(-2r/a) is a Gamma(shape=3, scale=a/2) radial distribution.
	// Fixed seed keeps palette, size, and density comparisons reproducible.
	let seed = 19
	const random = () => {
		seed = (Math.imul(1664525, seed) + 1013904223) >>> 0
		return (seed + 1) / 4294967297
	}
	const positions = new Float32Array(POINT_COUNT * 3)
	const shimmer = new Float32Array(POINT_COUNT * 3)
	for (let index = 0; index < POINT_COUNT; index++) {
		const radius = -0.375 * Math.log(random() * random() * random())
		const z = 2 * random() - 1
		const angle = random() * Math.PI * 2
		const planar = Math.sqrt(1 - z * z)
		positions.set(
			[
				radius * planar * Math.cos(angle),
				radius * planar * Math.sin(angle),
				radius * z,
			],
			index * 3,
		)
	}
	// Generate animation attributes separately so the original position seed
	// remains stable when we tune the shimmer.
	for (let index = 0; index < POINT_COUNT; index++) {
		shimmer.set(
			[random() * Math.PI * 2, 1.05 + random() * 2, 0.75 + random() * 0.65],
			index * 3,
		)
	}
	return new THREE.BufferGeometry()
		.setAttribute(`position`, new THREE.BufferAttribute(positions, 3))
		.setAttribute(`shimmer`, new THREE.BufferAttribute(shimmer, 3))
}

export function mountHydrogenStudies(): () => void {
	const root = document.querySelector<HTMLElement>(`hydrogen-lab`)
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
	const uniforms = {
		uColor: { value: new THREE.Color(`#0099ff`) },
		uDensity: { value: 1 },
		uTime: { value: 0 },
		uNegative: { value: 0 },
		uResolution: { value: new THREE.Vector2(300, 260) },
		uLight: { value: 0 },
		uPixelRatio: { value: 1 },
		uSize: { value: 1.7 },
	}
	const cloudGeometry = new THREE.PlaneGeometry(4.1, 4.1)
	const cloudMaterial = new THREE.ShaderMaterial({
		vertexShader: CLOUD_VERTEX,
		fragmentShader: CLOUD_FRAGMENT,
		uniforms,
		transparent: true,
		depthWrite: false,
	})
	const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial)
	cloud.position.z = -2.1
	cloud.renderOrder = -1
	const pointGeometry = createPointGeometry()
	const pointMaterial = new THREE.ShaderMaterial({
		vertexShader: POINT_VERTEX,
		fragmentShader: POINT_FRAGMENT,
		uniforms,
		transparent: true,
		depthWrite: false,
	})
	const points = new THREE.Points(pointGeometry, pointMaterial)
	const pointScene = new THREE.Scene()
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
	pointScene.add(proton, cloud, points)
	addDz2OrbitalLights(pointScene)
	const pointCamera = new THREE.OrthographicCamera(
		-2.7,
		2.7,
		2.7,
		-2.7,
		0.1,
		100,
	)
	pointCamera.position.z = 5
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
			cloud.visible = viewHeight < 60
			uniforms.uNegative.value = study === `negative` ? 1 : 0
			proton.visible = study !== `negative`
			proton.material = study === `toon` ? toonProtonMaterial : protonMaterial
			pointCamera.left = (-2.7 * viewWidth) / viewHeight
			pointCamera.right = (2.7 * viewWidth) / viewHeight
			pointCamera.updateProjectionMatrix()
			points.rotation.y = elapsed * 0.36 // Three times the original 0.12 rad/s.
			uniforms.uSize.value = viewHeight < 60 ? 0.85 : (1.6 * viewHeight) / 260
			pointGeometry.setDrawRange(
				0,
				viewHeight < 60
					? Math.max(256, Math.round(POINT_COUNT * (viewHeight / 260) ** 2))
					: POINT_COUNT,
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
			link.download = `hydrogen-${study}.png`
			link.href = renderer.domElement.toDataURL(`image/png`)
			link.click()
			if (status)
				status.textContent = `Exported hydrogen-${study}.png · ${exportSize} × ${exportSize} · transparent background`
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
		cloudGeometry.dispose()
		cloudMaterial.dispose()
		pointGeometry.dispose()
		pointMaterial.dispose()
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
