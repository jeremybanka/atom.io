#!/usr/bin/env node
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

import * as THREE from "three"

const FINAL_SPIN_RADIANS = 1.1
const SETTLED_ROTATION_X = 1.4
const SETTLED_ROTATION_Z = -1.4
const IMAGE_SIZE = 512
const SUPERSAMPLE = 2
const FAVICON_OUTPUT_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	`../public/favicon.png`,
)
const APP_ICON_OUTPUT_PATH = resolve(
	dirname(fileURLToPath(import.meta.url)),
	`../public/apple-icon.png`,
)
const APP_ICON_BACKGROUND: Rgb = [0xcc, 0xcc, 0xcc]
const APP_ICON_PADDING_RATIO = 0.16

type ProjectedVertex = {
	x: number
	y: number
	z: number
}

type Rgb = [number, number, number]
type Rgba = [number, number, number, number]

type Bounds = {
	x: number
	y: number
	width: number
	height: number
}

type ShadingMaterial = {
	color: THREE.Color
	emissive: THREE.Color
	emissiveIntensity: number
}

type RenderGeometryOptions = {
	camera: THREE.Camera
	cameraPosition: THREE.Vector3
	depthBuffer: Float32Array
	geometry: THREE.BufferGeometry
	image: Buffer
	material: ShadingMaterial
	matrix: THREE.Matrix4
	width: number
}

type PngOptions = {
	data: Buffer
	height: number
	width: number
}

const MATERIALS = {
	lobe: {
		color: new THREE.Color(0xff3366),
		emissive: new THREE.Color(0xff3366),
		emissiveIntensity: 0.22,
	},
	torus: {
		color: new THREE.Color(0x0099ff),
		emissive: new THREE.Color(0x0099ff),
		emissiveIntensity: 0.17,
	},
} satisfies Record<string, ShadingMaterial>

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

function projectVertex(
	vertex: THREE.Vector3,
	camera: THREE.Camera,
	width: number,
	height: number,
): ProjectedVertex {
	const projected = vertex.clone().project(camera)
	return {
		x: (projected.x * 0.5 + 0.5) * width,
		y: (0.5 - projected.y * 0.5) * height,
		z: projected.z,
	}
}

function edge(
	a: ProjectedVertex,
	b: ProjectedVertex,
	x: number,
	y: number,
): number {
	return (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x)
}

function shadeTriangle(
	a: THREE.Vector3,
	b: THREE.Vector3,
	c: THREE.Vector3,
	material: ShadingMaterial,
	cameraPosition: THREE.Vector3,
): Rgb {
	const center = a
		.clone()
		.add(b)
		.add(c)
		.multiplyScalar(1 / 3)
	const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
	const viewDirection = cameraPosition.clone().sub(center).normalize()

	if (normal.dot(viewDirection) < 0) {
		normal.multiplyScalar(-1)
	}

	const lightPosition = new THREE.Vector3(1.8, 1.7, 3.5)
	const lightDirection = lightPosition.clone().sub(center).normalize()
	const diffuse = Math.max(0, normal.dot(lightDirection))
	const rim = Math.max(0, 1 - Math.max(0, normal.dot(viewDirection)))
	const toonDiffuse = diffuse > 0.74 ? 1 : diffuse > 0.38 ? 0.72 : 0.48
	const brightness = Math.min(1.7, 0.46 + toonDiffuse * 0.8 + rim * 0.16)

	const color = material.color.clone().multiplyScalar(brightness)
	color.add(material.emissive.clone().multiplyScalar(material.emissiveIntensity))

	return [
		Math.min(255, Math.round(color.r * 255)),
		Math.min(255, Math.round(color.g * 255)),
		Math.min(255, Math.round(color.b * 255)),
	]
}

function drawTriangle(
	image: Buffer,
	depthBuffer: Float32Array,
	width: number,
	points: [ProjectedVertex, ProjectedVertex, ProjectedVertex],
	color: Rgb,
): void {
	const [a, b, c] = points
	const area = edge(a, b, c.x, c.y)
	if (area === 0) return

	const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)))
	const maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)))
	const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)))
	const maxY = Math.min(width - 1, Math.ceil(Math.max(a.y, b.y, c.y)))

	for (let y = minY; y <= maxY; y++) {
		for (let x = minX; x <= maxX; x++) {
			const sampleX = x + 0.5
			const sampleY = y + 0.5
			const w0 = edge(b, c, sampleX, sampleY) / area
			const w1 = edge(c, a, sampleX, sampleY) / area
			const w2 = edge(a, b, sampleX, sampleY) / area

			if (w0 < 0 || w1 < 0 || w2 < 0) continue

			const z = w0 * a.z + w1 * b.z + w2 * c.z
			const pixel = y * width + x
			if (z >= depthBuffer[pixel]) continue

			depthBuffer[pixel] = z
			const offset = pixel * 4
			image[offset] = color[0]
			image[offset + 1] = color[1]
			image[offset + 2] = color[2]
			image[offset + 3] = 255
		}
	}
}

function renderGeometry({
	camera,
	cameraPosition,
	depthBuffer,
	geometry,
	image,
	material,
	matrix,
	width,
}: RenderGeometryOptions): void {
	const position = geometry.getAttribute(`position`)
	const index = geometry.index
	const a = new THREE.Vector3()
	const b = new THREE.Vector3()
	const c = new THREE.Vector3()

	const triangleCount = index ? index.count / 3 : position.count / 3
	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const vertexIndex = triangle * 3
		a.fromBufferAttribute(
			position,
			index ? index.getX(vertexIndex) : vertexIndex,
		).applyMatrix4(matrix)
		b.fromBufferAttribute(
			position,
			index ? index.getX(vertexIndex + 1) : vertexIndex + 1,
		).applyMatrix4(matrix)
		c.fromBufferAttribute(
			position,
			index ? index.getX(vertexIndex + 2) : vertexIndex + 2,
		).applyMatrix4(matrix)

		const color = shadeTriangle(a, b, c, material, cameraPosition)
		drawTriangle(
			image,
			depthBuffer,
			width,
			[
				projectVertex(a, camera, width, width),
				projectVertex(b, camera, width, width),
				projectVertex(c, camera, width, width),
			],
			color,
		)
	}
}

function findAlphaBounds(image: Buffer, width: number, height: number): Bounds {
	let minX = width
	let minY = height
	let maxX = -1
	let maxY = -1

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const alpha = image[(y * width + x) * 4 + 3]
			if (alpha === 0) continue
			minX = Math.min(minX, x)
			minY = Math.min(minY, y)
			maxX = Math.max(maxX, x)
			maxY = Math.max(maxY, y)
		}
	}

	if (maxX === -1 || maxY === -1) {
		throw new Error(`Cannot crop an empty render.`)
	}

	return {
		x: minX,
		y: minY,
		width: maxX - minX + 1,
		height: maxY - minY + 1,
	}
}

function paddedSquareBounds(bounds: Bounds, paddingRatio: number): Bounds {
	const side = Math.max(bounds.width, bounds.height) * (1 + paddingRatio * 2)
	const centerX = bounds.x + bounds.width / 2
	const centerY = bounds.y + bounds.height / 2
	return {
		x: centerX - side / 2,
		y: centerY - side / 2,
		width: side,
		height: side,
	}
}

function samplePixel(
	image: Buffer,
	width: number,
	height: number,
	x: number,
	y: number,
): Rgba {
	const x0 = Math.floor(x)
	const y0 = Math.floor(y)
	const x1 = x0 + 1
	const y1 = y0 + 1
	const xFraction = x - x0
	const yFraction = y - y0
	const samples = [
		{ x: x0, y: y0, weight: (1 - xFraction) * (1 - yFraction) },
		{ x: x1, y: y0, weight: xFraction * (1 - yFraction) },
		{ x: x0, y: y1, weight: (1 - xFraction) * yFraction },
		{ x: x1, y: y1, weight: xFraction * yFraction },
	]

	let red = 0
	let green = 0
	let blue = 0
	let alpha = 0

	for (const sample of samples) {
		if (
			sample.weight <= 0 ||
			sample.x < 0 ||
			sample.x >= width ||
			sample.y < 0 ||
			sample.y >= height
		) {
			continue
		}

		const offset = (sample.y * width + sample.x) * 4
		const sampleAlpha = image[offset + 3] / 255
		const weightedAlpha = sampleAlpha * sample.weight
		red += (image[offset] / 255) * weightedAlpha
		green += (image[offset + 1] / 255) * weightedAlpha
		blue += (image[offset + 2] / 255) * weightedAlpha
		alpha += weightedAlpha
	}

	if (alpha <= 0) {
		return [0, 0, 0, 0]
	}

	return [
		Math.round((red / alpha) * 255),
		Math.round((green / alpha) * 255),
		Math.round((blue / alpha) * 255),
		Math.round(alpha * 255),
	]
}

function resampleCrop(
	image: Buffer,
	sourceWidth: number,
	sourceHeight: number,
	bounds: Bounds,
	targetWidth: number,
	targetHeight: number,
): Buffer {
	const target = Buffer.alloc(targetWidth * targetHeight * 4)
	for (let y = 0; y < targetHeight; y++) {
		for (let x = 0; x < targetWidth; x++) {
			const sourceX = bounds.x + ((x + 0.5) / targetWidth) * bounds.width - 0.5
			const sourceY = bounds.y + ((y + 0.5) / targetHeight) * bounds.height - 0.5
			const [red, green, blue, alpha] = samplePixel(
				image,
				sourceWidth,
				sourceHeight,
				sourceX,
				sourceY,
			)
			const targetOffset = (y * targetWidth + x) * 4
			target[targetOffset] = red
			target[targetOffset + 1] = green
			target[targetOffset + 2] = blue
			target[targetOffset + 3] = alpha
		}
	}
	return target
}

function flattenToBackground(image: Buffer, background: Rgb): Buffer {
	const flattened = Buffer.alloc(image.length)
	for (let offset = 0; offset < image.length; offset += 4) {
		const alpha = image[offset + 3] / 255
		flattened[offset] = Math.round(
			image[offset] * alpha + background[0] * (1 - alpha),
		)
		flattened[offset + 1] = Math.round(
			image[offset + 1] * alpha + background[1] * (1 - alpha),
		)
		flattened[offset + 2] = Math.round(
			image[offset + 2] * alpha + background[2] * (1 - alpha),
		)
		flattened[offset + 3] = 255
	}
	return flattened
}

const crcTable = new Uint32Array(256)
for (let index = 0; index < 256; index++) {
	let value = index
	for (let bit = 0; bit < 8; bit++) {
		value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
	}
	crcTable[index] = value >>> 0
}

function crc32(buffer: Buffer): number {
	let value = 0xffffffff
	for (const byte of buffer) {
		value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
	}
	return (value ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
	const typeBuffer = Buffer.from(type, `ascii`)
	const chunk = Buffer.alloc(8 + data.length + 4)
	chunk.writeUInt32BE(data.length, 0)
	typeBuffer.copy(chunk, 4)
	data.copy(chunk, 8)
	chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length)
	return chunk
}

function encodePng({ data, height, width }: PngOptions): Buffer {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(width, 0)
	ihdr.writeUInt32BE(height, 4)
	ihdr[8] = 8
	ihdr[9] = 6

	const scanlines = Buffer.alloc(height * (1 + width * 4))
	for (let y = 0; y < height; y++) {
		const rowStart = y * (1 + width * 4)
		scanlines[rowStart] = 0
		data.copy(scanlines, rowStart + 1, y * width * 4, (y + 1) * width * 4)
	}

	return Buffer.concat([
		signature,
		pngChunk(`IHDR`, ihdr),
		pngChunk(`IDAT`, deflateSync(scanlines, { level: 9 })),
		pngChunk(`IEND`, Buffer.alloc(0)),
	])
}

const renderSize = IMAGE_SIZE * SUPERSAMPLE
const image = Buffer.alloc(renderSize * renderSize * 4)
const depthBuffer = new Float32Array(renderSize * renderSize).fill(Infinity)
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100)
camera.position.set(4.2, 2.4, 6.6)
camera.lookAt(0, 0, 0)
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

const orbital = new THREE.Group()
orbital.scale.setScalar(1.42)
orbital.rotation.set(SETTLED_ROTATION_X, FINAL_SPIN_RADIANS, SETTLED_ROTATION_Z)
orbital.updateMatrixWorld(true)

const topLobe = makeLobeGeometry(1)
const bottomLobe = makeLobeGeometry(-1)
const torus = new THREE.TorusGeometry(1.2, 0.3, 36, 144)

const torusMatrix = new THREE.Matrix4().makeRotationX(Math.PI / 2)
const worldTorusMatrix = orbital.matrixWorld.clone().multiply(torusMatrix)

for (const geometry of [topLobe, bottomLobe]) {
	renderGeometry({
		camera,
		cameraPosition: camera.position,
		depthBuffer,
		geometry,
		image,
		material: MATERIALS.lobe,
		matrix: orbital.matrixWorld,
		width: renderSize,
	})
}

renderGeometry({
	camera,
	cameraPosition: camera.position,
	depthBuffer,
	geometry: torus,
	image,
	material: MATERIALS.torus,
	matrix: worldTorusMatrix,
	width: renderSize,
})

const contentBounds = findAlphaBounds(image, renderSize, renderSize)
const favicon = resampleCrop(
	image,
	renderSize,
	renderSize,
	contentBounds,
	IMAGE_SIZE,
	IMAGE_SIZE,
)
const appIcon = flattenToBackground(
	resampleCrop(
		image,
		renderSize,
		renderSize,
		paddedSquareBounds(contentBounds, APP_ICON_PADDING_RATIO),
		IMAGE_SIZE,
		IMAGE_SIZE,
	),
	APP_ICON_BACKGROUND,
)

writeFileSync(
	FAVICON_OUTPUT_PATH,
	encodePng({
		data: favicon,
		height: IMAGE_SIZE,
		width: IMAGE_SIZE,
	}),
)
writeFileSync(
	APP_ICON_OUTPUT_PATH,
	encodePng({
		data: appIcon,
		height: IMAGE_SIZE,
		width: IMAGE_SIZE,
	}),
)
