import type * as Motion from "motion"
import { animate, type MotionValue } from "motion"
import { afterEach, expect, it, vi } from "vitest"

import type { GraphItem } from "../src/ecology-graph.ts"
import {
	animateEcologyEditorHeight,
	createEcologyMotion,
	createEdgeRoutingMotion,
} from "../src/ecology-motion.ts"

vi.mock(`motion`, async (actual) => ({
	...(await actual<typeof Motion>()),
	animate: vi.fn(),
}))
afterEach(() => vi.clearAllMocks())

const family = { id: `family:items`, x: 2, y: 3, z: 4 } as GraphItem
const member = {
	id: `state:items("a")`,
	familyLabel: `items`,
	familyId: `family:items`,
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

it(`animates the compact editor from its current height and releases the split on completion, resize and reduced motion`, () => {
	const body = document.createElement(`ecology-body`)
	const editor = document.createElement(`ecology-editor`)
	const content = document.createElement(`ecology-editor-content`)
	body.append(editor)
	editor.append(content)
	document.body.append(body)
	Object.defineProperty(body, `clientHeight`, { value: 400 })
	body.style.display = `grid`
	let naturalHeight = 80
	editor.getBoundingClientRect = () => new DOMRect(0, 0, 400, naturalHeight)
	let notify!: (node: Element) => void
	const observer = { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() }
	using observe = vi
		.spyOn(window, `ResizeObserver`)
		.mockImplementation(function (callback) {
			notify = (target) => {
				callback([{ target } as ResizeObserverEntry], observer)
			}
			return observer
		})
	const media = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	Object.defineProperty(media, `matches`, { value: false, writable: true })
	using matchMedia = vi.spyOn(window, `matchMedia`).mockReturnValue(media)
	const dispose = animateEcologyEditorHeight(editor, content)
	const pinned = () => editor.style.getPropertyValue(`--ecology-editor-height`)
	expect(observe).toHaveBeenCalledOnce()
	expect(matchMedia).toHaveBeenCalledWith(`(prefers-reduced-motion: reduce)`)
	expect(observer.observe.mock.calls).toEqual([[body], [content]])
	notify(content)
	body.style.display = `flex`
	notify(content)
	notify(content)
	expect(animate).not.toHaveBeenCalled()

	naturalHeight = 160
	notify(content)
	const height = progress()
	expect(pinned()).toBe(`80px`)
	height.set(110)
	notify(content)
	expect(pinned()).toBe(`110px`)
	expect(animate).toHaveBeenCalledOnce()
	naturalHeight = 65
	notify(content)
	expect(vi.mocked(animate).mock.lastCall?.slice(0, 2)).toEqual([height, 65])
	expect(pinned()).toBe(`110px`)
	const completion = vi.mocked(animate).mock.lastCall?.[2] as {
		onComplete(): void
	}
	completion.onComplete()
	expect(pinned()).toBe(``)

	naturalHeight = 140
	notify(content)
	expect(pinned()).toBe(`65px`)
	naturalHeight = 120
	notify(body)
	expect(pinned()).toBe(``)
	naturalHeight = 160
	notify(content)
	expect(pinned()).toBe(`120px`)
	Object.defineProperty(media, `matches`, { value: true })
	media.dispatchEvent(new Event(`change`))
	expect(pinned()).toBe(``)
	naturalHeight = 90
	notify(content)
	expect(pinned()).toBe(``)
	dispose()
	body.remove()
	expect(observer.disconnect).toHaveBeenCalledOnce()
})

it(`flies between clustered and expanded positions, preserving progress on rapid reversal and retaining stable settled endpoints`, () => {
	const f = fixture(),
		expanded = new Set([`family:items`])
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
	f.motion.sync([member], new Set([`family:items`]), 1)
	const value = progress()
	value.set(0.5)
	f.motion.sync([family], new Set(), 1)
	const edge = {
		id: `items-a:total`,
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
	f.motion.sync([member, other], new Set([`family:items`]), 2)
	expect(f.motion.entering(member.id)).toBe(false)
	expect(animate).not.toHaveBeenCalled()
	f.motion.sync([family], new Set([`family:items`]), 2)
	expect(f.motion.exiting(member.id)).toBe(false)
	f.motion.sync([member], new Set([`family:items`]), 2)
	expect(f.motion.entering(member.id)).toBe(false)
	f.motion.sync([family], new Set(), 3)
	expect(f.motion.position(member.id)).toBeUndefined()
	f.motion.sync([member], new Set([`family:items`]), 3)
	progress().set(0.3)
	f.motion.sync([member], new Set([`family:items`]), 4)
	expect(f.motion.position(member.id)).toBe(member)
	expect(f.motion.active).toBe(false)
	f.motion.dispose()
})

it(`respects reduced motion initially and finishes in-flight springs when the preference changes`, () => {
	const f = fixture(true),
		expanded = new Set([`family:items`])
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

it(`retargets an edge along the shortest turn and settles or releases its spring`, () => {
	const media = new EventTarget() as MediaQueryList
	Object.defineProperty(media, `matches`, { value: false, writable: true })
	const invalidate = vi.fn()
	const routes = createEdgeRoutingMotion(invalidate, media)
	const edge = {
		id: `a:b`,
		source: family.id,
		from: family,
		to: other,
		color: `red`,
		traced: false,
	}
	expect(routes.steer(edge.id, 3)).toBe(3)
	expect(animate).not.toHaveBeenCalled()
	expect(routes.steer(edge.id, 0)).toBe(3)
	const angle = progress()
	expect(vi.mocked(animate).mock.lastCall?.[1]).toBe(4)
	angle.set(3.4)
	expect(invalidate).toHaveBeenCalledOnce()
	media.dispatchEvent(new Event(`change`))
	expect(routes.angle(edge.id)).toBe(3.4)
	expect(routes.steer(edge.id, 0)).toBe(3.4)
	expect(animate).toHaveBeenCalledOnce()
	expect(routes.steer(edge.id, 3)).toBe(3.4)
	expect(vi.mocked(animate).mock.lastCall?.slice(0, 2)).toEqual([angle, 3])

	Object.defineProperty(media, `matches`, { value: true })
	media.dispatchEvent(new Event(`change`))
	expect(routes.angle(edge.id)).toBe(3)
	expect(routes.steer(edge.id, 1)).toBe(1)
	expect(routes.angle(edge.id)).toBe(1)
	const dropped = { ...edge, id: `new` }
	routes.steer(dropped.id, 2)
	routes.sync([edge])
	expect(routes.angle(dropped.id)).toBeUndefined()
	expect(routes.angle(edge.id)).toBe(1)
	const destroy = vi.spyOn(angle, `destroy`)
	routes.sync([])
	expect(destroy).toHaveBeenCalledOnce()
	expect(routes.steer(edge.id, 0)).toBe(0)
	routes.dispose()
	expect(routes.angle(edge.id)).toBeUndefined()
})
