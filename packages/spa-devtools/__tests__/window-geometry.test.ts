import { expect, it } from "vitest"

import {
	clampRect,
	edgeTarget,
	readGeometry,
	RESIZE_EDGES,
	resizeRect,
	SNAP_TARGETS,
	snapRect,
} from "../src/window-geometry.ts"

const viewport = { width: 1200, height: 900 }
const free = { x: 100, y: 100, width: 500, height: 400 }
it(`clamps free rectangles and minimum dimensions even on tiny viewports`, () => {
	expect(readGeometry(null, viewport).free).toEqual({
		x: 700,
		y: 100,
		width: 500,
		height: 800,
	})
	expect(readGeometry(null, { width: 100, height: 80 }).free).toEqual({
		x: 0,
		y: 0,
		width: 100,
		height: 80,
	})
	expect(
		clampRect({ x: -50, y: 9000, width: 2000, height: 1 }, viewport),
	).toEqual({ x: 0, y: 740, width: 1200, height: 160 })
	expect(clampRect(free, { width: 200, height: 100 })).toEqual({
		x: 0,
		y: 0,
		width: 200,
		height: 100,
	})
})
it(`provides exact halves, thirds and full viewport without free-window minimums`, () => {
	const expected = [
		[0, 0, 600, 900],
		[600, 0, 600, 900],
		[0, 0, 400, 900],
		[400, 0, 400, 900],
		[800, 0, 400, 900],
		[0, 0, 1200, 450],
		[0, 450, 1200, 450],
		[0, 0, 1200, 900],
	]
	SNAP_TARGETS.forEach((target, index) => {
		const [x, y, width, height] = expected[index]
		expect(snapRect(target, viewport)).toEqual({ x, y, width, height })
	})
	expect(snapRect(`right-third`, { width: 90, height: 50 })).toEqual({
		x: 60,
		y: 0,
		width: 30,
		height: 50,
	})
})
it(`anchors each resized edge and clamps at both viewport boundaries and minimum sizes`, () => {
	for (const edge of RESIZE_EDGES) {
		for (const delta of [-10000, -20, 20, 10000]) {
			const next = resizeRect(free, edge, delta, delta, viewport)
			expect(next.x).toBeGreaterThanOrEqual(0)
			expect(next.y).toBeGreaterThanOrEqual(0)
			expect(next.width).toBeGreaterThanOrEqual(320)
			expect(next.height).toBeGreaterThanOrEqual(160)
			expect(next.x + next.width).toBeLessThanOrEqual(viewport.width)
			expect(next.y + next.height).toBeLessThanOrEqual(viewport.height)
			if (edge.includes(`w`))
				expect(next.x + next.width).toBe(free.x + free.width)
			if (edge.includes(`n`))
				expect(next.y + next.height).toBe(free.y + free.height)
		}
	}
	expect(
		resizeRect({ x: 0, y: 0, width: 100, height: 50 }, `se`, -1000, -1000, {
			width: 100,
			height: 50,
		}),
	).toEqual({ x: 0, y: 0, width: 100, height: 50 })
})
it(`maps edge drag zones and leaves the interior unsnapped`, () => {
	expect(edgeTarget(100, 0, viewport)).toBe(`full`)
	expect(edgeTarget(0, 100, viewport)).toBe(`left-half`)
	expect(edgeTarget(1200, 100, viewport)).toBe(`right-half`)
	expect(edgeTarget(100, 900, viewport)).toBe(`bottom-half`)
	expect(edgeTarget(400, 400, viewport)).toBeNull()
})
it(`rejects corrupt, non-finite and invalid persisted geometry and clamps stale positions`, () => {
	for (const value of [
		null,
		false,
		2,
		{},
		{ free: 3 },
		{ free: null },
		{ free: {} },
		{ free: { ...free, x: Infinity } },
		{ free: { ...free, y: `0` } },
		{ free: { ...free, width: 0 } },
		{ free: { ...free, height: -1 } },
	]) {
		expect(readGeometry(value, viewport)).toEqual({
			free: { x: 700, y: 100, width: 500, height: 800 },
			snap: null,
		})
	}
	expect(readGeometry({ free, snap: `full` }, viewport)).toEqual({
		free,
		snap: `full`,
	})
	expect(readGeometry({ free, snap: `obsolete` }, viewport)).toEqual({
		free,
		snap: null,
	})
	expect(
		readGeometry({ free: { ...free, x: 9999, y: -1 } }, viewport).free,
	).toEqual({ ...free, x: 700, y: 0 })
})
