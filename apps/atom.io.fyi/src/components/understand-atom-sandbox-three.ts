import * as THREE from "three"

export type LazinessCacheState = `empty` | `evicted` | `fresh`
export type LazinessActivity =
	| `idle`
	| `increment`
	| `read`
	| `subscribe`
	| `unsubscribe`

export type LazinessSceneState = {
	activity: LazinessActivity
	activityId: number
	cacheState: LazinessCacheState
	computeCount: number
	count: number
	doubled: null | number
	subscribed: boolean
}

export type UnderstandAtomLazinessScene = {
	dispose(): void
	update(state: LazinessSceneState): void
}

type TextLabel = {
	material: THREE.SpriteMaterial
	sprite: THREE.Sprite
	texture: THREE.CanvasTexture
}

type FlowNode = {
	box: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>
	group: THREE.Group
	label: TextLabel
	outline: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>
}

type Connection = THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>

type SceneTheme = {
	accentBlue: THREE.Color
	accentGold: THREE.Color
	accentRed: THREE.Color
	background: THREE.Color
	faint: THREE.Color
	foreground: string
	line: THREE.Color
	soft: string
}

const CAMERA_BASE_POSITION = new THREE.Vector3(4.6, 3.6, 5.4)
const CAMERA_BASE_TARGET = new THREE.Vector3(0, 0, 0)
const DRAWING_BUFFER_BUDGET = 4_000_000
const MAX_PIXEL_RATIO = 1.6
const PULSE_DURATION_MS = 850

function readCssValue(
	host: HTMLElement,
	name: string,
	fallback: string,
): string {
	const value = getComputedStyle(host).getPropertyValue(name).trim()
	return value || fallback
}

function readTheme(host: HTMLElement): SceneTheme {
	return {
		accentBlue: new THREE.Color(`#0099ff`),
		accentGold: new THREE.Color(`gold`),
		accentRed: new THREE.Color(readCssValue(host, `--brand-color`, `#cc0033`)),
		background: new THREE.Color(readCssValue(host, `--bg-soft-1`, `#171717`)),
		faint: new THREE.Color(readCssValue(host, `--fg-soft-3`, `#888888`)),
		foreground: readCssValue(host, `--fg-hard-1`, `#ffffff`),
		line: new THREE.Color(readCssValue(host, `--fg-soft-2`, `#aaaaaa`)),
		soft: readCssValue(host, `--fg-soft-1`, `#cccccc`),
	}
}

function getPixelRatio(width: number, height: number): number {
	const cappedPixelRatio = Math.min(
		window.devicePixelRatio || 1,
		MAX_PIXEL_RATIO,
	)
	const pixelRatioFromBudget = Math.sqrt(
		DRAWING_BUFFER_BUDGET / Math.max(width * height, 1),
	)
	return Math.min(cappedPixelRatio, pixelRatioFromBudget)
}

function makeTextTexture(
	title: string,
	detail: string,
	theme: SceneTheme,
): THREE.CanvasTexture {
	const canvas = document.createElement(`canvas`)
	canvas.width = 512
	canvas.height = 224
	const context = canvas.getContext(`2d`)
	if (!context) {
		throw new Error(`Unable to create sandbox label context.`)
	}

	context.clearRect(0, 0, canvas.width, canvas.height)
	context.textAlign = `center`
	context.textBaseline = `middle`
	context.fillStyle = theme.foreground
	context.font = `600 42px Uruz, system-ui, sans-serif`
	context.fillText(title, canvas.width / 2, 82)
	context.fillStyle = theme.soft
	context.font = `500 32px Theia, monospace`
	context.fillText(detail, canvas.width / 2, 142)

	const texture = new THREE.CanvasTexture(canvas)
	texture.colorSpace = THREE.SRGBColorSpace
	texture.needsUpdate = true
	return texture
}

function createTextLabel(
	title: string,
	detail: string,
	theme: SceneTheme,
): TextLabel {
	const texture = makeTextTexture(title, detail, theme)
	const material = new THREE.SpriteMaterial({
		depthWrite: false,
		map: texture,
		transparent: true,
	})
	const sprite = new THREE.Sprite(material)
	sprite.scale.set(1.55, 0.68, 1)
	return { material, sprite, texture }
}

function updateTextLabel(
	label: TextLabel,
	title: string,
	detail: string,
	theme: SceneTheme,
): void {
	label.texture.dispose()
	label.texture = makeTextTexture(title, detail, theme)
	label.material.map = label.texture
	label.material.needsUpdate = true
}

function createFlowNode({
	accent,
	detail,
	theme,
	title,
	x,
}: {
	accent: THREE.Color
	detail: string
	theme: SceneTheme
	title: string
	x: number
}): FlowNode {
	const group = new THREE.Group()
	group.position.set(x, 0, 0)

	const boxMaterial = new THREE.MeshStandardMaterial({
		color: theme.background.clone().lerp(accent, 0.16),
		emissive: accent,
		emissiveIntensity: 0.04,
		metalness: 0.05,
		roughness: 0.72,
		transparent: true,
		opacity: 0.94,
	})
	const box = new THREE.Mesh(
		new THREE.BoxGeometry(1.42, 0.18, 0.82),
		boxMaterial,
	)
	box.position.y = 0.12

	const outline = new THREE.LineSegments(
		new THREE.EdgesGeometry(box.geometry),
		new THREE.LineBasicMaterial({
			color: accent,
			transparent: true,
			opacity: 0.52,
		}),
	)
	outline.position.copy(box.position)

	const label = createTextLabel(title, detail, theme)
	label.sprite.position.set(0, 0.62, 0)

	group.add(box, outline, label.sprite)
	return { box, group, label, outline }
}

function createConnection(
	fromX: number,
	toX: number,
	theme: SceneTheme,
): Connection {
	const length = Math.abs(toX - fromX) - 1.32
	const material = new THREE.MeshStandardMaterial({
		color: theme.line,
		emissive: theme.line,
		emissiveIntensity: 0.02,
		roughness: 0.65,
		transparent: true,
		opacity: 0.24,
	})
	const connection = new THREE.Mesh(
		new THREE.CylinderGeometry(0.032, 0.032, length, 18),
		material,
	)
	connection.rotation.z = Math.PI / 2
	connection.position.set((fromX + toX) / 2, 0.18, 0)
	return connection
}

function cacheDetail(state: LazinessSceneState): string {
	if (state.cacheState === `empty`) {
		return `not read`
	}
	if (state.cacheState === `evicted`) {
		return `evicted`
	}
	return String(state.doubled ?? 0)
}

function readerDetail(state: LazinessSceneState): string {
	return state.subscribed ? `subscribed` : `on demand`
}

function shouldPulse(state: LazinessSceneState): boolean {
	return (
		state.activity === `read` ||
		state.activity === `subscribe` ||
		(state.activity === `increment` && state.subscribed)
	)
}

function setConnectionState(
	connection: Connection,
	active: boolean,
	theme: SceneTheme,
): void {
	connection.material.color.copy(active ? theme.accentBlue : theme.line)
	connection.material.emissive.copy(active ? theme.accentBlue : theme.line)
	connection.material.emissiveIntensity = active ? 0.2 : 0.02
	connection.material.opacity = active ? 0.72 : 0.22
}

function updateCameraRail(
	camera: THREE.OrthographicCamera,
	scrollElement: HTMLElement,
): void {
	const maxScroll = scrollElement.scrollWidth - scrollElement.clientWidth
	const scrollProgress =
		maxScroll > 0 ? scrollElement.scrollLeft / maxScroll : 0.5
	const railOffset = maxScroll > 0 ? (scrollProgress - 0.5) * 1.45 : 0
	const position = CAMERA_BASE_POSITION.clone()
	const target = CAMERA_BASE_TARGET.clone()
	position.x += railOffset
	target.x += railOffset
	camera.position.copy(position)
	camera.lookAt(target)
}

export function createUnderstandAtomLazinessScene(
	host: HTMLElement,
	scrollElement: HTMLElement,
	initialState: LazinessSceneState,
	options: { reducedMotion: boolean },
): UnderstandAtomLazinessScene {
	const theme = readTheme(host)
	const renderer = new THREE.WebGLRenderer({
		alpha: true,
		antialias: true,
		powerPreference: `low-power`,
	})
	renderer.setClearColor(0x000000, 0)
	host.append(renderer.domElement)

	const scene = new THREE.Scene()
	const camera = new THREE.OrthographicCamera(-2.8, 2.8, 1.7, -1.7, 0.1, 100)
	updateCameraRail(camera, scrollElement)

	const countNode = createFlowNode({
		accent: theme.accentRed,
		detail: String(initialState.count),
		theme,
		title: `count`,
		x: -2.05,
	})
	const selectorNode = createFlowNode({
		accent: theme.accentBlue,
		detail: cacheDetail(initialState),
		theme,
		title: `doubled`,
		x: 0,
	})
	const readerNode = createFlowNode({
		accent: theme.accentGold,
		detail: readerDetail(initialState),
		theme,
		title: `reader`,
		x: 2.05,
	})
	const countToSelector = createConnection(-2.05, 0, theme)
	const selectorToReader = createConnection(0, 2.05, theme)

	const pulse = new THREE.Mesh(
		new THREE.SphereGeometry(0.095, 24, 16),
		new THREE.MeshBasicMaterial({
			color: theme.accentGold,
			transparent: true,
			opacity: 0,
		}),
	)
	pulse.position.set(-2.05, 0.42, 0)

	scene.add(
		countToSelector,
		selectorToReader,
		countNode.group,
		selectorNode.group,
		readerNode.group,
		pulse,
	)
	scene.add(new THREE.AmbientLight(0xffffff, 1.8))
	const keyLight = new THREE.DirectionalLight(0xffffff, 2.2)
	keyLight.position.set(2.5, 5, 4)
	scene.add(keyLight)

	let state = initialState
	let activeActivityId = state.activityId
	let activeActivityStartedAt = performance.now()
	let frameId = 0

	const resize = () => {
		const width = Math.max(host.clientWidth, 1)
		const height = Math.max(host.clientHeight, 1)
		const aspect = width / height
		const frustumHeight = 3.22
		camera.left = (-frustumHeight * aspect) / 2
		camera.right = (frustumHeight * aspect) / 2
		camera.top = frustumHeight / 2
		camera.bottom = -frustumHeight / 2
		camera.updateProjectionMatrix()
		renderer.setPixelRatio(getPixelRatio(width, height))
		renderer.setSize(width, height, false)
		updateCameraRail(camera, scrollElement)
		render()
	}

	const render = () => {
		renderer.render(scene, camera)
	}

	const updatePulse = (now: number) => {
		if (options.reducedMotion || !shouldPulse(state)) {
			pulse.material.opacity = 0
			return
		}

		const progress = Math.min(
			(now - activeActivityStartedAt) / PULSE_DURATION_MS,
			1,
		)
		if (progress >= 1) {
			pulse.material.opacity = 0
			return
		}

		const first = new THREE.Vector3(-1.34, 0.42, 0)
		const middle = new THREE.Vector3(0, 0.42, 0)
		const last = new THREE.Vector3(1.34, 0.42, 0)
		if (progress < 0.52) {
			pulse.position.lerpVectors(first, middle, progress / 0.52)
		} else {
			pulse.position.lerpVectors(middle, last, (progress - 0.52) / 0.48)
		}
		pulse.material.opacity = Math.sin(progress * Math.PI) * 0.88
	}

	const animate = (now: number) => {
		updatePulse(now)
		render()
		frameId = requestAnimationFrame(animate)
	}

	const updateMaterials = () => {
		const computing = shouldPulse(state)
		countNode.box.material.emissiveIntensity = computing ? 0.18 : 0.05
		selectorNode.box.material.emissiveIntensity =
			state.cacheState === `fresh`
				? 0.18
				: state.cacheState === `evicted`
					? 0.08
					: 0.03
		readerNode.box.material.emissiveIntensity = state.subscribed ? 0.18 : 0.04
		setConnectionState(
			countToSelector,
			state.subscribed || state.cacheState === `fresh`,
			theme,
		)
		setConnectionState(
			selectorToReader,
			state.subscribed || state.activity === `read`,
			theme,
		)
	}

	const updateLabels = () => {
		updateTextLabel(countNode.label, `count`, String(state.count), theme)
		updateTextLabel(selectorNode.label, `doubled`, cacheDetail(state), theme)
		updateTextLabel(readerNode.label, `reader`, readerDetail(state), theme)
	}

	const update = (nextState: LazinessSceneState) => {
		state = nextState
		if (activeActivityId !== state.activityId) {
			activeActivityId = state.activityId
			activeActivityStartedAt = performance.now()
		}
		updateLabels()
		updateMaterials()
		updatePulse(performance.now())
		render()
	}

	const handleScroll = () => {
		updateCameraRail(camera, scrollElement)
		render()
	}

	const resizeObserver = new ResizeObserver(resize)
	resizeObserver.observe(host)
	scrollElement.addEventListener(`scroll`, handleScroll)
	addEventListener(`resize`, resize)
	resize()
	update(initialState)
	if (!options.reducedMotion) {
		frameId = requestAnimationFrame(animate)
	}

	return {
		dispose() {
			cancelAnimationFrame(frameId)
			resizeObserver.disconnect()
			scrollElement.removeEventListener(`scroll`, handleScroll)
			removeEventListener(`resize`, resize)
			for (const node of [countNode, selectorNode, readerNode]) {
				node.box.geometry.dispose()
				node.box.material.dispose()
				node.outline.geometry.dispose()
				node.outline.material.dispose()
				node.label.texture.dispose()
				node.label.material.dispose()
			}
			countToSelector.geometry.dispose()
			countToSelector.material.dispose()
			selectorToReader.geometry.dispose()
			selectorToReader.material.dispose()
			pulse.geometry.dispose()
			pulse.material.dispose()
			renderer.dispose()
			renderer.domElement.remove()
		},
		update,
	}
}
