import {
	findState,
	getState,
	runTransaction,
	setState,
	subscribe,
} from "atom.io"
import { beforeEach, describe, expect, test, vi } from "vitest"

import { parsePreactLogo } from "./preact-logo.ts"
import {
	materializeSvgOrder,
	readSvgRegister,
	reduceSvgRegister,
} from "./svg-convergence.ts"
import {
	activeDragAtom,
	beginSvgDrag,
	createSvgGestureClock,
	deletePathTransaction,
	deleteSubpathTransaction,
	dragPresenceAtoms,
	edgeAtoms,
	finishSvgDrag,
	insertPathTransaction,
	insertSubpathTransaction,
	nodeAtoms,
	pathDrawSelectors,
	pathOrderAtom,
	pointerCaptureAtom,
	previewSvgDrag,
	projectedNodeSelectors,
	reorderSubpathTransaction,
	replaceSvgDrawing,
	splitSubpathTransaction,
	structureViolationsSelector,
	subpathAtoms,
	subpathOrderAtoms,
	svgDragPresenceKey,
	svgOperationId,
	type SvgDrawingFixture,
} from "./svg-editor-state.ts"

const clock = createSvgGestureClock({
	actor: `test-actor`,
	initialLogicalTime: 10_000,
	session: `fixture`,
})

const drawing: SvgDrawingFixture = {
	paths: [
		{
			id: `path-a`,
			subpaths: [
				{ edge: { kind: `move` }, id: `a0`, node: { x: 0, y: 0 } },
				{ edge: { kind: `line` }, id: `a1`, node: { x: 10, y: 10 } },
				{
					edge: { c: { x: 12, y: 12 }, kind: `cubic`, s: { x: 18, y: 18 } },
					id: `a2`,
					node: { x: 20, y: 20 },
				},
				{ edge: { kind: `close` }, id: `a3`, node: null },
			],
		},
	],
}

beforeEach(() => {
	vi.spyOn(console, `error`).mockImplementation(() => {})
	vi.spyOn(console, `warn`).mockImplementation(() => {})
	finishSvgDrag({ commit: false })
	replaceSvgDrawing(drawing, clock.begin())
})

describe(`SVG editor state`, () => {
	test(`gesture clocks reject ambiguous identities and invalid initial time`, () => {
		expect(() =>
			createSvgGestureClock({ actor: ``, session: `fixture` }),
		).toThrow(`identities must be nonempty`)
		expect(() =>
			createSvgGestureClock({
				actor: `actor`,
				initialLogicalTime: Number.NaN,
				session: `fixture`,
			}),
		).toThrow(`nonnegative integer`)
	})

	test(`imports a complete graph and derives SVG without a renderer registry`, () => {
		expect(getState(structureViolationsSelector)).toEqual([])
		expect(
			materializeSvgOrder(getState(pathOrderAtom)).map(({ value }) => value),
		).toEqual([`path-a`])
		expect(getState(pathDrawSelectors, `path-a`)).toBe(
			`M 0 0 L 10 10 C 12 12 18 18 20 20 Z`,
		)
	})

	test(`path and subpath lifecycle settles as complete transactions`, () => {
		const insertPathGesture = clock.begin()
		runTransaction(
			insertPathTransaction,
			insertPathGesture.id,
		)({
			gesture: insertPathGesture,
			index: 1,
			pathId: `path-b`,
		})
		const insertSubpathGesture = clock.begin()
		runTransaction(
			insertSubpathTransaction,
			insertSubpathGesture.id,
		)({
			edge: { kind: `move` },
			gesture: insertSubpathGesture,
			index: 0,
			node: { x: 100, y: 100 },
			pathId: `path-b`,
			subpathId: `b0`,
		})

		expect(getState(pathDrawSelectors, `path-b`)).toBe(`M 100 100`)
		expect(getState(structureViolationsSelector)).toEqual([])

		const deletePathGesture = clock.begin()
		runTransaction(
			deletePathTransaction,
			deletePathGesture.id,
		)({
			gesture: deletePathGesture,
			pathId: `path-b`,
		})
		expect(
			materializeSvgOrder(getState(pathOrderAtom)).map(({ value }) => value),
		).toEqual([`path-a`])
		expect(getState(structureViolationsSelector)).toEqual([])
	})

	test(`split, reorder, and delete preserve structural invariants atomically`, () => {
		const observedViolations: unknown[] = []
		const unsubscribe = subscribe(
			structureViolationsSelector,
			({ newValue }) => observedViolations.push(newValue),
			`structure-test`,
		)
		const splitGesture = clock.begin()
		runTransaction(
			splitSubpathTransaction,
			splitGesture.id,
		)({
			continuationEdge: { kind: `line` },
			gesture: splitGesture,
			inserted: {
				edge: { kind: `line` },
				node: { x: 5, y: 5 },
				subpathId: `split`,
			},
			pathId: `path-a`,
			targetSubpathId: `a1`,
		})
		expect(getState(structureViolationsSelector)).toEqual([])
		expect(
			materializeSvgOrder(getState(subpathOrderAtoms, `path-a`)).map(
				({ value }) => value,
			),
		).toEqual([`a0`, `split`, `a1`, `a2`, `a3`])

		const reorderGesture = clock.begin()
		runTransaction(
			reorderSubpathTransaction,
			reorderGesture.id,
		)({
			gesture: reorderGesture,
			index: 3,
			pathId: `path-a`,
			subpathId: `split`,
		})
		const deleteGesture = clock.begin()
		runTransaction(
			deleteSubpathTransaction,
			deleteGesture.id,
		)({
			gesture: deleteGesture,
			pathId: `path-a`,
			subpathId: `a1`,
		})

		expect(getState(structureViolationsSelector)).toEqual([])
		expect(
			materializeSvgOrder(getState(subpathOrderAtoms, `path-a`)).map(
				({ value }) => value,
			),
		).toEqual([`a0`, `a2`, `split`, `a3`])
		expect(
			observedViolations.every(
				(violations) => Array.isArray(violations) && violations.length === 0,
			),
		).toBe(true)
		unsubscribe()
	})

	test(`split rejects an incompatible continuation without partial settlement`, () => {
		const before = getState(pathDrawSelectors, `path-a`)
		const gesture = clock.begin()

		expect(() => {
			runTransaction(
				splitSubpathTransaction,
				gesture.id,
			)({
				continuationEdge: { kind: `close` },
				gesture,
				inserted: {
					edge: { kind: `line` },
					node: { x: 5, y: 5 },
					subpathId: `invalid-split`,
				},
				pathId: `path-a`,
				targetSubpathId: `a1`,
			})
		}).toThrow(`Only a close edge may have a null SVG node`)
		expect(getState(pathDrawSelectors, `path-a`)).toBe(before)
		expect(getState(structureViolationsSelector)).toEqual([])
	})

	test(`the invariant selector detects a mismatched subpath identity`, () => {
		const gesture = clock.begin()
		setState(
			subpathAtoms,
			`a1`,
			reduceSvgRegister(getState(subpathAtoms, `a1`), {
				id: svgOperationId(gesture, 0),
				value: { id: `another-subpath`, pathId: `path-a` },
			}),
		)

		expect(getState(structureViolationsSelector)).toContainEqual({
			code: `missing-subpath`,
			pathId: `path-a`,
			subpathId: `a1`,
		})
	})

	test(`a rejected import leaves the previous drawing intact`, () => {
		const before = getState(pathDrawSelectors, `path-a`)
		expect(() => {
			replaceSvgDrawing(
				{
					paths: [
						{
							id: `broken`,
							subpaths: [{ edge: { kind: `line` }, id: `bad`, node: null }],
						},
					],
				},
				clock.begin(),
			)
		}).toThrow(`Only a close edge`)
		expect(getState(pathDrawSelectors, `path-a`)).toBe(before)
		expect(getState(structureViolationsSelector)).toEqual([])
	})

	test(`drag previews stay ephemeral and settle once at pointer-up`, () => {
		const durableBefore = readSvgRegister(getState(nodeAtoms, `a1`))
		const durableUpdates = vi.fn()
		const unsubscribe = subscribe(
			findState(nodeAtoms, `a1`),
			durableUpdates,
			`durable-node-test`,
		)
		const gesture = clock.begin()
		const element = {} as Element
		beginSvgDrag({
			element,
			gesture,
			point: durableBefore!,
			pointerId: 7,
			target: { kind: `node`, subpathId: `a1` },
		})
		previewSvgDrag({ x: 30, y: 40 })
		previewSvgDrag({ x: 50, y: 60 })

		expect(readSvgRegister(getState(nodeAtoms, `a1`))).toEqual(durableBefore)
		expect(getState(projectedNodeSelectors, `a1`)).toEqual({ x: 50, y: 60 })
		expect(
			getState(dragPresenceAtoms, svgDragPresenceKey(gesture)),
		).toMatchObject({
			gestureId: gesture.id,
			sequence: 2,
			target: { kind: `node`, subpathId: `a1` },
		})
		expect(getState(pointerCaptureAtom)).toEqual({ element, pointerId: 7 })

		finishSvgDrag({ commit: true })

		expect(readSvgRegister(getState(nodeAtoms, `a1`))).toEqual({ x: 50, y: 60 })
		expect(durableUpdates).toHaveBeenCalledTimes(1)
		expect(getState(activeDragAtom)).toBeNull()
		expect(getState(dragPresenceAtoms, svgDragPresenceKey(gesture))).toBeNull()
		expect(getState(pointerCaptureAtom)).toBeNull()
		unsubscribe()
	})

	test(`canceling a drag drops presence without a durable write`, () => {
		const before = readSvgRegister(getState(edgeAtoms, `a2`))
		const gesture = clock.begin()
		beginSvgDrag({
			element: {} as Element,
			gesture,
			point: { x: 18, y: 18 },
			pointerId: 9,
			target: { control: `s`, kind: `edge-control`, subpathId: `a2` },
		})
		previewSvgDrag({ x: 90, y: 91 })
		finishSvgDrag({ commit: false })

		expect(readSvgRegister(getState(edgeAtoms, `a2`))).toEqual(before)
		expect(getState(dragPresenceAtoms, svgDragPresenceKey(gesture))).toBeNull()
	})

	test(`presence and cleanup distinguish concurrent sessions for one actor`, () => {
		const local = clock.begin()
		const peer = createSvgGestureClock({
			actor: local.actor,
			initialLogicalTime: local.logicalTime,
			session: `peer-session`,
		}).begin()
		setState(dragPresenceAtoms, svgDragPresenceKey(peer), {
			actor: peer.actor,
			gestureId: peer.id,
			point: { x: 70, y: 80 },
			sequence: 1,
			session: peer.session,
			target: { kind: `node`, subpathId: `a1` },
		})
		beginSvgDrag({
			element: {} as Element,
			gesture: local,
			point: { x: 10, y: 10 },
			pointerId: 10,
			target: { kind: `node`, subpathId: `a1` },
		})
		previewSvgDrag({ x: 30, y: 40 })
		finishSvgDrag({ commit: false })

		expect(getState(dragPresenceAtoms, svgDragPresenceKey(local))).toBeNull()
		expect(getState(dragPresenceAtoms, svgDragPresenceKey(peer))).toMatchObject({
			point: { x: 70, y: 80 },
			session: `peer-session`,
		})
		setState(dragPresenceAtoms, svgDragPresenceKey(peer), null)
	})

	test(`a rejected drag commit still releases local gesture state`, () => {
		const dragGesture = clock.begin()
		beginSvgDrag({
			element: {} as Element,
			gesture: dragGesture,
			point: { x: 10, y: 10 },
			pointerId: 11,
			target: { kind: `node`, subpathId: `a1` },
		})
		previewSvgDrag({ x: 30, y: 40 })
		const deleteGesture = clock.begin()
		runTransaction(
			deleteSubpathTransaction,
			deleteGesture.id,
		)({
			gesture: deleteGesture,
			pathId: `path-a`,
			subpathId: `a1`,
		})

		expect(() => {
			finishSvgDrag({ commit: true })
		}).toThrow(`Cannot move a missing or closing SVG node`)
		expect(getState(activeDragAtom)).toBeNull()
		expect(getState(pointerCaptureAtom)).toBeNull()
		expect(
			getState(dragPresenceAtoms, svgDragPresenceKey(dragGesture)),
		).toBeNull()
	})

	test(`the bundled parser expands repeated commands into complete members`, () => {
		const parsed = parsePreactLogo(
			`<svg><path d="m0 0l10 0 0 10z"></path></svg>`,
		)
		expect(parsed.paths[0].subpaths).toEqual([
			{ edge: { kind: `move` }, id: `subpath0`, node: { x: 0, y: 0 } },
			{ edge: { kind: `line` }, id: `subpath1`, node: { x: 10, y: 0 } },
			{ edge: { kind: `line` }, id: `subpath2`, node: { x: 10, y: 10 } },
			{ edge: { kind: `close` }, id: `subpath3`, node: null },
		])
		expect(() =>
			parsePreactLogo(`<svg><path d="M0 0H10 20"></path></svg>`),
		).toThrow(`Unsupported SVG path command H`)
		expect(() => parsePreactLogo(`<svg><path d="M0 0L"></path></svg>`)).toThrow(
			`SVG path command L is incomplete`,
		)
	})
})
