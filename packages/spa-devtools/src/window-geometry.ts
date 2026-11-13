export interface Rect {
	x: number
	y: number
	width: number
	height: number
}
export interface Viewport {
	width: number
	height: number
}
export const SNAP_TARGETS = [
	`left-half`,
	`right-half`,
	`left-third`,
	`center-third`,
	`right-third`,
	`top-half`,
	`bottom-half`,
	`full`,
] as const
export type SnapTarget = (typeof SNAP_TARGETS)[number]
export const RESIZE_EDGES = [`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`] as const
export type ResizeEdge = (typeof RESIZE_EDGES)[number]
export interface WindowGeometry {
	free: Rect
	snap: SnapTarget | null
}
const bound = (value: number, min: number, max: number) =>
	Math.max(min, Math.min(value, max))
export function clampRect(
	rect: Rect,
	viewport: Viewport,
	minWidth = 320,
	minHeight = 160,
): Rect {
	const width = bound(
		rect.width,
		Math.min(minWidth, viewport.width),
		viewport.width,
	)
	const height = bound(
		rect.height,
		Math.min(minHeight, viewport.height),
		viewport.height,
	)
	return {
		x: bound(rect.x, 0, viewport.width - width),
		y: bound(rect.y, 0, viewport.height - height),
		width,
		height,
	}
}
function defaultRect(viewport: Viewport): Rect {
	const width = Math.min(500, viewport.width)
	const height = Math.min(800, viewport.height)
	return {
		x: viewport.width - width,
		y: viewport.height - height,
		width,
		height,
	}
}
export function snapRect(target: SnapTarget, viewport: Viewport): Rect {
	const { width, height } = viewport
	switch (target) {
		case `left-half`:
			return { x: 0, y: 0, width: width / 2, height }
		case `right-half`:
			return { x: width / 2, y: 0, width: width / 2, height }
		case `left-third`:
			return { x: 0, y: 0, width: width / 3, height }
		case `center-third`:
			return { x: width / 3, y: 0, width: width / 3, height }
		case `right-third`:
			return { x: (width * 2) / 3, y: 0, width: width / 3, height }
		case `top-half`:
			return { x: 0, y: 0, width, height: height / 2 }
		case `bottom-half`:
			return { x: 0, y: height / 2, width, height: height / 2 }
		case `full`:
			return { x: 0, y: 0, width, height }
	}
}
export function resizeRect(
	rect: Rect,
	edge: ResizeEdge,
	dx: number,
	dy: number,
	viewport: Viewport,
): Rect {
	let left = rect.x,
		right = rect.x + rect.width,
		top = rect.y,
		bottom = rect.y + rect.height
	const minWidth = Math.min(320, viewport.width),
		minHeight = Math.min(160, viewport.height)
	if (edge.includes(`w`)) left = bound(left + dx, 0, right - minWidth)
	if (edge.includes(`e`))
		right = bound(right + dx, left + minWidth, viewport.width)
	if (edge.includes(`n`)) top = bound(top + dy, 0, bottom - minHeight)
	if (edge.includes(`s`))
		bottom = bound(bottom + dy, top + minHeight, viewport.height)
	return clampRect(
		{ x: left, y: top, width: right - left, height: bottom - top },
		viewport,
	)
}
export function edgeTarget(
	x: number,
	y: number,
	viewport: Viewport,
): SnapTarget | null {
	if (y <= 8) return `full`
	if (x <= 8) return `left-half`
	if (x >= viewport.width - 8) return `right-half`
	if (y >= viewport.height - 8) return `bottom-half`
	return null
}
export function readGeometry(
	value: unknown,
	viewport: Viewport,
): WindowGeometry {
	const fallback: WindowGeometry = { free: defaultRect(viewport), snap: null }
	if (!value || typeof value !== `object`) return fallback
	const { free, snap } = value as Partial<WindowGeometry>
	if (!free || typeof free !== `object`) return fallback
	if (
		![free.x, free.y, free.width, free.height].every(
			(part) => typeof part === `number` && Number.isFinite(part),
		) ||
		free.width <= 0 ||
		free.height <= 0
	)
		return fallback
	return {
		free: clampRect(free, viewport),
		snap: SNAP_TARGETS.includes(snap as SnapTarget)
			? (snap as SnapTarget)
			: null,
	}
}
