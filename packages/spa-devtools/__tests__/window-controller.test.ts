import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { createWindowController } from "../src/window-controller.ts"
import { SNAP_TARGETS } from "../src/window-geometry.ts"

const cleanups: (() => void)[] = []
let frames: Map<number, FrameRequestCallback>,
	serial = 0
const free = { x: 100, y: 120, width: 500, height: 400 }
beforeEach(() => {
	localStorage.clear()
	Object.assign(window, { innerWidth: 1200, innerHeight: 900 })
	frames = new Map()
	vi.spyOn(window, `requestAnimationFrame`).mockImplementation((callback) => {
		frames.set(++serial, callback)
		return serial
	})
	vi.spyOn(window, `cancelAnimationFrame`).mockImplementation((id) => {
		frames.delete(id)
	})
})
afterEach(() => {
	for (const cleanup of cleanups.splice(0)) cleanup()
	document.body.replaceChildren()
	vi.restoreAllMocks()
	Object.assign(window, { innerWidth: 1024, innerHeight: 768 })
})
function fixture(saved: unknown = { free, snap: null }) {
	localStorage.setItem(`🔍 Devtools Window`, JSON.stringify(saved))
	const host = document.createElement(`div`)
	host.innerHTML = `<main><header class="toolbar"><button class="drag-handle">Move</button><nav><button>Atoms</button></nav><button data-testid="open-close-devtools">Minimize</button></header><input value="2."></main>`
	document.body.append(host)
	const panel = host.querySelector<HTMLElement>(`main`)!
	const toolbar = panel.querySelector<HTMLElement>(`header`)!
	const toggle = vi.fn()
	const controller = createWindowController(panel, toggle)
	cleanups.push(controller.dispose)
	for (const node of [
		toolbar,
		...panel.querySelectorAll<HTMLElement>(`[data-resize]`),
	]) {
		node.setPointerCapture = vi.fn()
		node.releasePointerCapture = vi.fn()
	}
	const targets = host.querySelectorAll<HTMLElement>(`[data-snap]`)
	targets.forEach((button, index) => {
		button.getBoundingClientRect = () =>
			new DOMRect(100 + index * 60, 10, 60, 30)
	})
	const pointer = (
		type: string,
		x = 200,
		y = 200,
		target: HTMLElement = toolbar,
		other: PointerEventInit = {},
	) => {
		target.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				pointerId: 1,
				button: 0,
				isPrimary: true,
				clientX: x,
				clientY: y,
				...other,
			}),
		)
	}
	const key = (
		pressed: string,
		element: HTMLElement = toolbar,
		extra: KeyboardEventInit = {},
	) => {
		element.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: pressed, bubbles: true, ...extra }),
		)
	}
	const flush = () => {
		for (const [id, callback] of [...frames]) {
			frames.delete(id)
			callback(0)
		}
	}
	const rect = () => ({
		x: Number.parseFloat(panel.style.left),
		y: Number.parseFloat(panel.style.top),
		width: Number.parseFloat(panel.style.width),
		height: Number.parseFloat(panel.style.height),
	})
	return {
		host,
		panel,
		toolbar,
		controller,
		toggle,
		pointer,
		key,
		flush,
		rect,
		targets,
		preview: host.querySelector<HTMLElement>(`.snap-preview`)!,
		palette: host.querySelector<HTMLElement>(`.snap-palette`)!,
	}
}
it(`coalesces movement, preserves focused input nodes and persists only committed geometry`, () => {
	const f = fixture()
	const input = f.panel.querySelector(`input`)!
	input.focus()
	const storage = vi.spyOn(window.localStorage, `setItem`)
	f.pointer(`pointermove`)
	f.pointer(`pointerup`)
	f.pointer(`pointercancel`)
	f.pointer(`pointerdown`, 200, 200)
	f.pointer(`pointermove`, 230, 240)
	f.pointer(`pointermove`, 250, 260)
	expect(frames.size).toBe(1)
	expect(f.rect()).toEqual(free)
	expect(storage).not.toHaveBeenCalled()
	f.flush()
	expect(f.rect()).toEqual({ ...free, x: 150, y: 180 })
	expect(document.activeElement).toBe(input)
	expect(input.value).toBe(`2.`)
	f.pointer(`pointerup`, 270, 280)
	expect(f.rect()).toEqual({ ...free, x: 170, y: 200 })
	expect(storage).toHaveBeenCalledTimes(1)
	expect(f.palette.hidden).toBe(true)
})
it(`ignores unrelated buttons, pointers and controls, and cancels on Escape, cancellation or capture loss`, () => {
	const f = fixture()
	for (const options of [{ button: 2 }, { isPrimary: false }])
		f.pointer(`pointerdown`, 200, 200, f.toolbar, options)
	for (const node of [
		f.panel,
		f.panel.querySelector(`input`)!,
		f.panel.querySelector<HTMLElement>(`nav button`)!,
	])
		f.pointer(`pointerdown`, 200, 200, node)
	expect(f.toolbar.setPointerCapture).not.toHaveBeenCalled()
	for (const cancel of [`Escape`, `pointercancel`, `lostpointercapture`]) {
		f.pointer(`pointerdown`)
		f.pointer(`pointerdown`)
		f.pointer(`pointermove`, 500, 500, f.toolbar, { pointerId: 2 })
		f.pointer(`pointerup`, 500, 500, f.toolbar, { pointerId: 2 })
		f.pointer(`pointercancel`, 500, 500, f.toolbar, { pointerId: 2 })
		f.pointer(`pointermove`, 300, 300)
		f.flush()
		expect(f.rect()).not.toEqual(free)
		if (cancel === `Escape`) f.key(`Escape`)
		else f.pointer(cancel)
		expect(f.rect()).toEqual(free)
		expect(f.preview.hidden).toBe(true)
	}
	f.key(`z`)
	f.key(`z`, f.panel.querySelector(`input`)!)
	f.key(`a`, f.toolbar, { ctrlKey: true, shiftKey: true, code: `KeyA` })
	expect(f.toggle).toHaveBeenCalledOnce()
})
it(`previews every palette target, commits exact zones and restores the last free position`, () => {
	const f = fixture()
	SNAP_TARGETS.forEach((target, index) => {
		f.pointer(`pointerdown`)
		f.pointer(`pointermove`, 120 + index * 60, 20)
		f.flush()
		expect(f.preview.hidden).toBe(false)
		const preview = f.preview.style.cssText
		f.pointer(`pointerup`, 120 + index * 60, 20)
		expect(f.panel.style.cssText).toBe(preview)
		expect(JSON.parse(localStorage.getItem(`🔍 Devtools Window`)!).snap).toBe(
			target,
		)
		f.host.querySelector<HTMLButtonElement>(`.layout-button`)!.click()
		f.palette.querySelector<HTMLButtonElement>(`button:last-child`)!.click()
	})
	expect(f.rect()).toEqual(free)
})
it(`unsnaps on header drag and restores the prior snap when cancelled`, () => {
	const f = fixture({ free, snap: `right-half` })
	f.pointer(`pointerdown`, 800, 20)
	f.pointer(`pointermove`, 700, 100)
	f.flush()
	expect(f.rect().width).toBe(500)
	f.pointer(`pointercancel`)
	expect(f.rect()).toEqual({ x: 600, y: 0, width: 600, height: 900 })
	const layout = f.panel.querySelector<HTMLButtonElement>(`.layout-button`)!
	layout.click()
	f.key(`Escape`)
	expect(document.activeElement).toBe(layout)
})
it(`snaps and restores through keyboard-accessible buttons, moves/resizes with arrows and clamps on viewport changes`, () => {
	const f = fixture()
	const layout = f.panel.querySelector<HTMLButtonElement>(`.layout-button`)!
	layout.click()
	expect(document.activeElement).toBe(f.targets[0])
	layout.click()
	expect(f.palette.hidden).toBe(true)
	layout.click()
	f.targets[1].click()
	expect(f.rect()).toEqual({ x: 600, y: 0, width: 600, height: 900 })
	Object.assign(window, { innerWidth: 600, innerHeight: 300 })
	window.dispatchEvent(new Event(`resize`))
	expect(f.rect()).toEqual({ x: 300, y: 0, width: 300, height: 300 })
	f.palette.querySelector<HTMLButtonElement>(`button:last-child`)!.click()
	expect(f.rect()).toEqual({ x: 100, y: 0, width: 500, height: 300 })
	const handle = f.panel.querySelector<HTMLElement>(`.drag-handle`)!
	for (const key of [`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Enter`])
		f.key(key, handle)
	expect(f.rect().y).toBe(0)
	const resize = f.panel.querySelector<HTMLElement>(`[data-resize="e"]`)!
	f.key(`ArrowLeft`, resize)
	expect(f.rect().width).toBe(490)
	Object.assign(window, { innerWidth: 160, innerHeight: 90 })
	window.dispatchEvent(new Event(`resize`))
	expect(f.rect()).toEqual({ x: 0, y: 0, width: 160, height: 90 })
})
it(`resizes corners, cancels scheduled work and preserves free geometry across hide/minimize/disposal`, () => {
	const f = fixture()
	const handle = f.panel.querySelector<HTMLElement>(`[data-resize="se"]`)!
	f.pointer(`pointerdown`, 600, 520, handle)
	f.pointer(`pointermove`, 700, 620, handle)
	f.flush()
	expect(f.preview.hidden).toBe(true)
	expect(f.rect()).toEqual({ ...free, width: 600, height: 500 })
	f.pointer(`pointerup`, 700, 620, handle)
	for (const [hidden, open] of [
		[true, true],
		[false, false],
	]) {
		f.pointer(`pointerdown`)
		f.pointer(`pointermove`, 300, 300)
		const callback = [...frames.values()][0]
		f.controller.visibility(hidden, open)
		expect(frames.size).toBe(0)
		callback(0) // A stale browser callback after cancellation must be harmless.
		f.pointer(`pointerdown`)
		expect(frames.size).toBe(0)
		f.controller.visibility(false, true)
		expect(f.rect()).toEqual({ ...free, width: 600, height: 500 })
	}
	f.pointer(`pointerdown`)
	f.pointer(`pointermove`, 250, 250)
	f.controller.dispose()
	expect(frames.size).toBe(0)
	expect(f.host.querySelector(`.snap-palette`)).toBeNull()
})
it(`handles unavailable storage, failed capture and already-lost capture without leaking DOM`, () => {
	const get = vi.spyOn(window.localStorage, `getItem`).mockImplementation(() => {
		throw new Error(`storage`)
	})
	const f = fixture()
	get.mockRestore()
	vi.spyOn(window.localStorage, `setItem`).mockImplementation(() => {
		throw new Error(`storage`)
	})
	f.toolbar.setPointerCapture = () => {
		throw new Error(`capture`)
	}
	f.pointer(`pointerdown`)
	expect(f.palette.hidden).toBe(true)
	f.toolbar.setPointerCapture = () => {}
	f.toolbar.releasePointerCapture = () => {
		throw new Error(`lost capture`)
	}
	f.pointer(`pointerdown`)
	f.pointer(`pointermove`, 0, 200)
	f.pointer(`pointerup`, 0, 200)
	expect(f.rect().x).toBe(0)
	f.key(`Escape`)
})
