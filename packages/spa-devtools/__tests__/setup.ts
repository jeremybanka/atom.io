import type * as THREE from "three"
import { vi } from "vitest"

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
window.requestAnimationFrame = vi.fn(() => 1)
window.cancelAnimationFrame = vi.fn()
