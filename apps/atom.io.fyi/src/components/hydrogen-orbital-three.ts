import * as THREE from "three"

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

export function createHydrogenCloud() {
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
	const scene = new THREE.Scene()
	scene.add(cloud, points)
	const camera = new THREE.OrthographicCamera(-2.7, 2.7, 2.7, -2.7, 0.1, 100)
	camera.position.z = 5
	return {
		scene,
		camera,
		uniforms,
		update(width: number, height: number, pixelRatio: number, elapsed: number) {
			uniforms.uResolution.value.set(width, height)
			uniforms.uTime.value = elapsed
			uniforms.uPixelRatio.value = pixelRatio
			cloud.visible = height < 60
			camera.left = (-2.7 * width) / height
			camera.right = (2.7 * width) / height
			camera.updateProjectionMatrix()
			points.rotation.y = elapsed * 0.36
			uniforms.uSize.value = height < 60 ? 0.85 : (1.6 * height) / 260
			pointGeometry.setDrawRange(
				0,
				height < 60
					? Math.max(256, Math.round(POINT_COUNT * (height / 260) ** 2))
					: POINT_COUNT,
			)
		},
		dispose() {
			cloudGeometry.dispose()
			cloudMaterial.dispose()
			pointGeometry.dispose()
			pointMaterial.dispose()
		},
	}
}
