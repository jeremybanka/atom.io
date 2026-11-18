import type * as Motion from "motion"
import { animate, type MotionValue } from "motion"
import { afterEach, expect, it, vi } from "vitest"

import type { GraphItem } from "../src/ecology-graph.ts"
import { createEcologyMotion } from "../src/ecology-motion.ts"

vi.mock(`motion`, async (actual) => ({
	...(await actual<typeof Motion>()),
	animate: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

const family = { id: `family:items`, x: 2, y: 3, z: 4 } as GraphItem
const member = {
	id: `state:items("a")`,
	familyLabel: `items`,
	cluster: { x: 2.1, y: 3, z: 4 },
	x: 12,
	y: 3,
	z: -6,
} as GraphItem
const other = { id: `state:total`, x: -8, y: -3, z: 4 } as GraphItem
function fixture(reduced = false) {
	let preference = reduced
	const media = new EventTarget() as MediaQueryList
	Object.defineProperty(media, `matches`, { get: () => preference })
	const removed = vi.spyOn(media, `removeEventListener`)
	const invalidate = vi.fn()
	const motion = createEcologyMotion(invalidate, { matchMedia: () => media })
	motion.sync([family], new Set(), 1)
	return {
		motion,
		invalidate,
		removed,
		reduce(value: boolean) {
			preference = value
			media.dispatchEvent(new Event(`change`))
		},
	}
}
const progress = () =>
	vi.mocked(animate).mock.calls.at(-1)![0] as MotionValue<number>

it(`flies between clustered and expanded positions, preserving progress on rapid reversal and retaining stable settled endpoints`, () => {
	const f = fixture(),
		expanded = new Set([`items`])
	f.motion.sync([family, member], expanded, 1)
	expect(f.motion.entering(member.id)).toBe(true)
	expect(f.motion.position(member.id)).toBe(member.cluster)
	expect(f.motion.active).toBe(true)
	const value = progress()
	value.set(0.4)
	const midway = f.motion.position(member.id)!
	expect(midway.x).toBeCloseTo(6.06)
	expect(midway.z).toBe(0)
	f.motion.sync([family], new Set(), 1)
	expect(progress()).toBe(value)
	expect(value.get()).toBe(0.4)
	expect(f.motion.exiting(member.id)).toBe(true)
	f.motion.sync([family, member], expanded, 1)
	expect(progress()).toBe(value)
	expect(value.get()).toBe(0.4)
	expect(f.motion.exiting(member.id)).toBe(false)
	value.set(1)
	expect(f.motion.position(member.id)).toBe(member)
	expect(f.motion.active).toBe(false)
	f.motion.sync([family, member], expanded, 1)
	f.motion.dispose()
	expect(f.removed).toHaveBeenCalledOnce()
})

it(`keeps arrows on moving member ports while using the collapsed family's SVG origin`, () => {
	const f = fixture()
	f.motion.sync([member], new Set([`items`]), 1)
	const value = progress()
	value.set(0.5)
	f.motion.sync([family], new Set(), 1)
	const edge = {
		source: family.id,
		from: member,
		to: other,
		fromCard: family,
		color: `red`,
		traced: true,
	}
	const moving = f.motion.edge(edge)
	expect(moving.from).toBe(f.motion.position(member.id))
	expect(moving.fromCard).toBe(moving.from)
	expect(moving.origin).toBe(family)
	expect(moving.to).toBe(other)
	expect(moving.toCard).toBe(other)
	value.set(0)
	expect(f.motion.edge(edge).fromCard).toBe(family)
	expect(f.motion.edge({ ...edge, fromCard: undefined }).origin).toBe(
		member.cluster,
	)
	expect(f.motion.point({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2, z: 3 })
	const bare = { x: 0, y: 1, z: 2 }
	expect(
		f.motion.edge({ ...edge, from: bare, fromCard: undefined }).fromCard,
	).toBe(bare)
	f.motion.release(member.id)
	expect(f.motion.position(member.id)).toBeUndefined()
	expect(f.motion.point(member)).toBe(member)
	expect(f.motion.entering(other.id)).toBe(false)
	expect(f.motion.exiting(other.id)).toBe(false)
	f.motion.dispose()
})

it(`snaps initial/restored captures and refreshes, and disposes members evicted by filtering without collapse exits`, () => {
	const f = fixture()
	f.motion.sync([member, other], new Set([`items`]), 2)
	expect(f.motion.entering(member.id)).toBe(false)
	expect(animate).not.toHaveBeenCalled()
	f.motion.sync([family], new Set([`items`]), 2)
	expect(f.motion.exiting(member.id)).toBe(false)
	f.motion.sync([member], new Set([`items`]), 2)
	expect(f.motion.entering(member.id)).toBe(false)
	f.motion.sync([family], new Set(), 3)
	expect(f.motion.position(member.id)).toBeUndefined()
	f.motion.sync([member], new Set([`items`]), 3)
	progress().set(0.3)
	f.motion.sync([member], new Set([`items`]), 4)
	expect(f.motion.position(member.id)).toBe(member)
	expect(f.motion.active).toBe(false)
	f.motion.dispose()
})

it(`respects reduced motion initially and finishes in-flight springs when the preference changes`, () => {
	const f = fixture(true),
		expanded = new Set([`items`])
	f.motion.sync([member], expanded, 1)
	expect(animate).not.toHaveBeenCalled()
	expect(f.motion.entering(member.id)).toBe(false)
	f.motion.sync([family], new Set(), 1)
	expect(f.motion.active).toBe(false)
	expect(f.motion.exiting(member.id)).toBe(false)
	f.motion.sync([member], expanded, 1)
	f.motion.release(member.id)
	f.reduce(false)
	f.motion.sync([family], new Set(), 1)
	f.motion.sync([member], expanded, 1)
	progress().set(0.3)
	f.reduce(true)
	expect(f.motion.position(member.id)).toBe(member)
	expect(f.motion.active).toBe(false)
	f.motion.release(`unknown`)
	f.motion.dispose()
})
