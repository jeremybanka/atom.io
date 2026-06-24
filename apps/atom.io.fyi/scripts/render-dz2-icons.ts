#!/usr/bin/env node
import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { deflateSync } from "node:zlib"

import * as THREE from "three"

import {
	createDz2OrbitalCamera,
	createDz2OrbitalModel,
	disposeDz2OrbitalModel,
	DZ2_ORBITAL_LIGHTS,
	setDz2OrbitalRotation,
} from "../src/components/dz2-orbital-three.ts"

const IMAGE_SIZE = 512
const SUPERSAMPLE = 3
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
const LIGHT_POSITION = new THREE.Vector3(...DZ2_ORBITAL_LIGHTS.core.position)

type ProjectedVertex = {
	x: number
	y: number
	z: number
}

type RasterVertex = ProjectedVertex & {
	color: Rgb
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

function shadeVertex(
	position: THREE.Vector3,
	normal: THREE.Vector3,
	material: ShadingMaterial,
	cameraPosition: THREE.Vector3,
): Rgb {
	const surfaceNormal = normal.clone().normalize()
	const viewDirection = cameraPosition.clone().sub(position).normalize()

	if (surfaceNormal.dot(viewDirection) < 0) {
		surfaceNormal.multiplyScalar(-1)
	}

	const lightDirection = LIGHT_POSITION.clone().sub(position).normalize()
	const halfVector = lightDirection.clone().add(viewDirection).normalize()
	const diffuse = Math.max(0, surfaceNormal.dot(lightDirection))
	const rim = Math.max(0, 1 - Math.max(0, surfaceNormal.dot(viewDirection))) ** 2
	const specular = Math.max(0, surfaceNormal.dot(halfVector)) ** 22
	const brightness = 0.78 + diffuse * 0.18 + rim * 0.04

	const color = material.color.clone().multiplyScalar(brightness)
	color.add(
		material.emissive.clone().multiplyScalar(material.emissiveIntensity * 0.08),
	)
	color.addScalar(specular * 0.16)
	color.convertLinearToSRGB()

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
	points: [RasterVertex, RasterVertex, RasterVertex],
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
			image[offset] = Math.round(
				a.color[0] * w0 + b.color[0] * w1 + c.color[0] * w2,
			)
			image[offset + 1] = Math.round(
				a.color[1] * w0 + b.color[1] * w1 + c.color[1] * w2,
			)
			image[offset + 2] = Math.round(
				a.color[2] * w0 + b.color[2] * w1 + c.color[2] * w2,
			)
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
	const normal = geometry.getAttribute(`normal`)
	const index = geometry.index
	const a = new THREE.Vector3()
	const b = new THREE.Vector3()
	const c = new THREE.Vector3()
	const normalA = new THREE.Vector3()
	const normalB = new THREE.Vector3()
	const normalC = new THREE.Vector3()
	const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix)

	const triangleCount = index ? index.count / 3 : position.count / 3
	for (let triangle = 0; triangle < triangleCount; triangle++) {
		const vertexIndex = triangle * 3
		const aIndex = index ? index.getX(vertexIndex) : vertexIndex
		const bIndex = index ? index.getX(vertexIndex + 1) : vertexIndex + 1
		const cIndex = index ? index.getX(vertexIndex + 2) : vertexIndex + 2
		a.fromBufferAttribute(position, aIndex).applyMatrix4(matrix)
		b.fromBufferAttribute(position, bIndex).applyMatrix4(matrix)
		c.fromBufferAttribute(position, cIndex).applyMatrix4(matrix)

		normalA.fromBufferAttribute(normal, aIndex).applyNormalMatrix(normalMatrix)
		normalB.fromBufferAttribute(normal, bIndex).applyNormalMatrix(normalMatrix)
		normalC.fromBufferAttribute(normal, cIndex).applyNormalMatrix(normalMatrix)

		drawTriangle(image, depthBuffer, width, [
			{
				...projectVertex(a, camera, width, width),
				color: shadeVertex(a, normalA, material, cameraPosition),
			},
			{
				...projectVertex(b, camera, width, width),
				color: shadeVertex(b, normalB, material, cameraPosition),
			},
			{
				...projectVertex(c, camera, width, width),
				color: shadeVertex(c, normalC, material, cameraPosition),
			},
		])
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

function squareBounds(bounds: Bounds, paddingRatio: number): Bounds {
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
const camera = createDz2OrbitalCamera()
camera.updateMatrixWorld()
camera.updateProjectionMatrix()

const model = createDz2OrbitalModel()
model.orbital.scale.setScalar(1.42)
setDz2OrbitalRotation(model.orbital)
model.orbital.updateMatrixWorld(true)

for (const mesh of model.meshes) {
	renderGeometry({
		camera,
		cameraPosition: camera.position,
		depthBuffer,
		geometry: mesh.geometry,
		image,
		material: mesh.material,
		matrix: mesh.matrixWorld,
		width: renderSize,
	})
}

const contentBounds = findAlphaBounds(image, renderSize, renderSize)
const favicon = resampleCrop(
	image,
	renderSize,
	renderSize,
	squareBounds(contentBounds, 0),
	IMAGE_SIZE,
	IMAGE_SIZE,
)
const appIcon = flattenToBackground(
	resampleCrop(
		image,
		renderSize,
		renderSize,
		squareBounds(contentBounds, APP_ICON_PADDING_RATIO),
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
disposeDz2OrbitalModel(model)
