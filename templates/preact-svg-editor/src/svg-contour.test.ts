import { describe, expect, test } from "vitest"

import {
	DEFAULT_SVG_CONTOUR_STATE,
	readSvgContour,
	reduceSvgContour,
	svgContourPath,
	svgContourSchema,
	type SvgContour,
} from "./svg-contour.ts"

const triangle = (offset = 0): SvgContour => ({
	nodes: [
		{ id: `a`, x: offset, y: 0 },
		{ id: `b`, x: 20 + offset, y: 0 },
		{ id: `c`, x: 10 + offset, y: 20 },
	],
})

function expectClosedContour(contour: SvgContour): void {
	expect(svgContourSchema.parse(contour)).toEqual(contour)
	const degrees = new Map(contour.nodes.map(({ id }) => [id, 0]))
	for (const [index, node] of contour.nodes.entries()) {
		const next = contour.nodes[(index + 1) % contour.nodes.length]
		degrees.set(node.id, degrees.get(node.id)! + 1)
		degrees.set(next.id, degrees.get(next.id)! + 1)
	}
	expect([...degrees.values()]).toEqual(contour.nodes.map(() => 2))
}

describe(`closed contour model`, () => {
	test(`branching, dangling, and curved edge states have no representation`, () => {
		expect(() =>
			svgContourSchema.parse({ nodes: triangle().nodes.slice(0, 2) }),
		).toThrow()
		expect(() =>
			svgContourSchema.parse({
				nodes: [triangle().nodes[0], triangle().nodes[0], triangle().nodes[2]],
			}),
		).toThrow(`duplicate node IDs`)
		expect(svgContourPath(triangle())).toBe(`M 0 0 L 20 0 L 10 20 Z`)
		expect(svgContourPath(triangle())).not.toMatch(/[CSQ]/u)
	})

	test(`overlapping participation and selective undo can expose only valid snapshots`, () => {
		const aliceId = `0000000000000001:alice:insert:00000000`
		const bobId = `0000000000000002:bob:participate:00000000`
		let state = reduceSvgContour(DEFAULT_SVG_CONTOUR_STATE, {
			actor: `alice`,
			id: aliceId,
			value: triangle(),
		})
		state = reduceSvgContour(state, {
			actor: `bob`,
			id: bobId,
			value: triangle(5),
		})
		state = reduceSvgContour(state, {
			actor: `alice`,
			id: `svg-history:alice-undo`,
			mode: `undo`,
			targetOperationIds: [aliceId],
			type: `history`,
		})

		const afterUndo = readSvgContour(state)
		expect(afterUndo).toEqual(triangle(5))
		expectClosedContour(afterUndo)

		state = reduceSvgContour(state, {
			actor: `bob`,
			id: `svg-history:bob-undo`,
			mode: `undo`,
			targetOperationIds: [bobId],
			type: `history`,
		})
		expectClosedContour(readSvgContour(state))
	})

	test(`invalid replacement operations fail before reduction`, () => {
		expect(() =>
			reduceSvgContour(DEFAULT_SVG_CONTOUR_STATE, {
				actor: `alice`,
				id: `0000000000000001:alice:bad:00000000`,
				value: { nodes: triangle().nodes.slice(0, 2) },
			}),
		).toThrow()
	})
})
