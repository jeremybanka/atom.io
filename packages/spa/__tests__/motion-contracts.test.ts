import { expect, it, vi } from "vitest"

import { motionCapability } from "../src/motion.ts"

const flush = async () => {
	await new Promise((resolve) => setTimeout(resolve, 50))
}
function scene(
	read: (key: string) => unknown = (key) => (key === `position` ? [0, 0, 0] : 0),
) {
	const values: Record<string, unknown> = {}
	const listeners = new Map<string, () => void>()
	const all: (() => void)[] = []
	const binding = motionCapability({ reducedMotion: `always` }).attach({
		kind: `three`,
		node: {},
		read,
		write(key, value) {
			values[key] = value
		},
		listen(type, run) {
			listeners.set(type, run)
			all.push(run)
			return () => {
				listeners.delete(type)
			}
		},
	})
	return { binding, values, listeners, all }
}
it(`composes scene gesture targets, retargets tuples, and restores base values`, () => {
	const f = scene()
	f.binding.update({
		initial: { position: [-1, 0, 0] },
		animate: { position: [1, 2, 3], x: 1 },
		whileHover: { x: 2 },
		whileTap: { x: 3 },
	})
	expect(f.values[`position`]).toEqual([1, 2, 3])
	f.listeners.get(`pointerenter`)!()
	expect(f.values[`x`]).toBe(2)
	f.listeners.get(`pointerdown`)!()
	expect(f.values[`x`]).toBe(3)
	f.listeners.get(`pointerup`)!()
	expect(f.values[`x`]).toBe(2)
	f.listeners.get(`pointercancel`)!()
	expect(f.values[`x`]).toBe(2)
	f.listeners.get(`pointerleave`)!()
	expect(f.values[`x`]).toBe(1)
	f.binding.update({ animate: { position: [1, 2, 3] }, whileTap: { x: 4 } })
	f.listeners.get(`pointerdown`)!()
	expect(f.values[`x`]).toBe(4)
	f.binding.update({})
	expect(f.values[`position`]).toEqual([0, 0, 0])
	expect(f.values[`x`]).toBe(0)
	f.binding.dispose()
	f.binding.dispose()
	for (const run of f.all) run()
	f.binding.update({ whileHover: { x: 2 } })
	expect(f.listeners.size).toBe(0)
})
it(`supports initial:false and scalar scale with tuple-valued native transforms`, () => {
	const f = scene(() => [1, 1, 1])
	f.binding.update({ initial: false, animate: { scale: 2 } })
	expect(f.values[`scale`]).toBe(2)
	f.binding.update({ animate: { scale: 3 } })
	expect(f.values[`scale`]).toBe(3)
	f.binding.dispose()
	expect(f.values[`scale`]).toEqual([1, 1, 1])
})
it(`uses sensible defaults for absent scene properties and validates changing target dimensions`, () => {
	const f = scene(() => undefined)
	f.binding.update({
		initial: false,
		animate: { x: 2, opacity: 0.2, scale: 2, color: `red` },
	})
	f.binding.dispose()
	expect(f.values).toEqual({ x: 0, opacity: 1, scale: 1, color: `red` })
	for (const read of [() => 0, () => [0, 0]]) {
		const g = scene(read)
		expect(() => {
			g.binding.update({ animate: { position: [1, 2, 3] } })
		}).toThrow(`matching numeric tuples`)
		g.binding.dispose()
	}
	const g = scene()
	g.binding.update({ animate: { position: [1, 2, 3] } })
	expect(() => {
		g.binding.update({ animate: { position: [1, 2] } })
	}).toThrow(`cannot change the shape`)
	g.binding.dispose()
	const h = scene()
	h.binding.update({ animate: { position: [1, 2, 3] } })
	expect(() => {
		h.binding.update({ whileHover: { position: [1, 2] } })
	}).toThrow(`cannot change the shape`)
	h.binding.dispose()
	const missing = motionCapability().attach({
		kind: `scene`,
		node: {},
		read: () => 0,
		write() {},
	})
	expect(() => {
		missing.update({ whileTap: { x: 1 } })
	}).toThrow(`event adapter`)
	missing.dispose()
	expect(() =>
		motionCapability().attach({ kind: `scene`, node: {}, read: () => 0 }),
	).toThrow(`does not support motion`)
})
it(`animates DOM styles and transforms, restores inline priorities, and cleans up gestures`, async () => {
	const element = document.createElement(`custom-panel`)
	element.style.setProperty(`background-color`, `red`, `important`)
	document.body.append(element)
	const binding = motionCapability({ reducedMotion: `always` }).attach({
		kind: `dom`,
		node: element,
	})
	const props = {
		initial: { opacity: 0, x: -10 },
		animate: { opacity: 1, x: 100, backgroundColor: `blue` },
		whileHover: { scale: 1.1 },
		whileTap: { scale: 0.9 },
	}
	try {
		binding.update(props)
		await flush()
		expect(element.style.transform).toContain(`100px`)
		expect(element.style.opacity).toBe(`1`)
		element.dispatchEvent(
			new PointerEvent(`pointerenter`, {
				pointerType: `mouse`,
				isPrimary: true,
			}),
		)
		await flush()
		expect(element.style.transform).toContain(`1.1`)
		element.dispatchEvent(
			new PointerEvent(`pointerdown`, {
				pointerType: `mouse`,
				isPrimary: true,
				button: 0,
			}),
		)
		await flush()
		expect(element.style.transform).toContain(`0.9`)
		window.dispatchEvent(
			new PointerEvent(`pointerup`, {
				pointerType: `mouse`,
				isPrimary: true,
				button: 0,
			}),
		)
		await flush()
		element.dispatchEvent(
			new PointerEvent(`pointerleave`, {
				pointerType: `mouse`,
				isPrimary: true,
			}),
		)
		await flush()
		binding.update({ animate: { x: 50, y: 20 }, whileHover: { scale: 1.2 } })
		await flush()
		expect(element.style.transform).toContain(`50px`)
		binding.update({ animate: { x: 50, y: 20 } })
		await flush()
		binding.dispose()
		binding.dispose()
		expect(element.style.getPropertyValue(`background-color`)).toBe(`red`)
		expect(element.style.getPropertyPriority(`background-color`)).toBe(
			`important`,
		)
		expect(element.style.transform).toBe(``)
	} finally {
		binding.dispose()
		element.remove()
	}
})
it(`rejects DOM tuple targets and preserves numeric/string default style values`, () => {
	const element = document.createElement(`div`)
	const binding = motionCapability({ reducedMotion: `always` }).attach({
		kind: `dom`,
		node: element,
	})
	expect(() => {
		binding.update({ initial: false, animate: { x: [1, 2] } })
	}).toThrow(`DOM targets must be scalar`)
	binding.dispose()
	const f = scene(() => ``)
	f.binding.update({ animate: { color: `red` } })
	expect(f.values[`color`]).toBe(`red`)
	f.binding.dispose()
})
it(`runs real tweens without reduced motion and schedules renderer drawing on Motion's clock`, async () => {
	const values = { x: 0 }
	const binding = motionCapability({ reducedMotion: `never` }).attach({
		kind: `scene`,
		node: values,
		read: () => values.x,
		write(_, value) {
			values.x = value as number
		},
	})
	const draw = vi.fn()
	const stop = motionCapability().scheduleFrame!(draw)
	try {
		binding.update({
			animate: { x: 10 },
			transition: { type: `tween`, duration: 0.01 },
		})
		await flush()
		await flush()
		expect(values.x).toBeCloseTo(10)
		expect(draw).toHaveBeenCalled()
		binding.update({ animate: { x: 20 } })
		await flush()
	} finally {
		stop()
		binding.dispose()
	}
})

it(`handles initial tuple-to-scalar values, missing targets, and malformed native base dimensions`, () => {
	const f = scene(() => 0)
	f.binding.update({
		initial: { x: [5, 6, 7] },
		animate: { x: 10, ignored: undefined },
	})
	expect(f.values[`x`]).toBe(10)
	f.binding.dispose()
	const g = scene(() => [0, 0])
	g.binding.update({
		initial: { position: [0, 0, 0] },
		animate: { position: [1, 2, 3] },
	})
	expect(() => {
		g.binding.update({})
	}).toThrow(`cannot change the shape`)
	g.binding.dispose()
})
it(`reacts to media changes for tuple animations and ignores non-reduced preferences`, () => {
	let changed = () => {}
	const preference = {
		matches: false,
		addEventListener(_event: string, run: () => void) {
			changed = run
		},
		removeEventListener() {},
	}
	vi.stubGlobal(`matchMedia`, () => preference)
	const values = { position: [0, 0, 0] }
	const binding = motionCapability().attach({
		kind: `three`,
		node: values,
		read: () => values.position,
		write(_, value) {
			values.position = value as number[]
		},
	})
	try {
		binding.update({ animate: { position: [1, 2, 3] } })
		changed()
		preference.matches = true
		changed()
		expect(values.position).toEqual([1, 2, 3])
	} finally {
		binding.dispose()
		vi.unstubAllGlobals()
	}
})
