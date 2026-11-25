import type * as THREE from "three"
import { beforeEach, vi } from "vitest"

// DOM unit suites inspect settled state; real motion and interruption run in browsers.
const match = globalThis.window?.matchMedia.bind(window)
beforeEach(() => {
	if (!match) return
	vi.spyOn(window, `matchMedia`).mockImplementation((query) => {
		const media = match(query)
		if (query === `(prefers-reduced-motion: reduce)`)
			Object.defineProperty(media, `matches`, {
				value: true,
				configurable: true,
			})
		return media
	})
})

// Exercise real cameras, scene resources, labels and controls without requiring a GPU in DOM tests.
vi.mock(`three`, async (actual) => ({
	...(await actual<typeof THREE>()),
	WebGLRenderer: vi.fn(function (options) {
		return {
			domElement: options.canvas,
			setSize: vi.fn(),
			setPixelRatio: vi.fn(),
			render: vi.fn(),
			dispose: vi.fn(),
		}
	}),
}))

// DOM suites advance task timers; GPU frame loops are advanced explicitly in scene tests.
if (globalThis.window) {
	window.requestAnimationFrame = vi.fn(() => 1)
	window.cancelAnimationFrame = vi.fn()
}
