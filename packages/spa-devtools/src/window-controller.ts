import type {
	Rect,
	ResizeEdge,
	SnapTarget,
	WindowGeometry,
} from "./window-geometry.ts"
import {
	clampRect,
	edgeTarget,
	readGeometry,
	RESIZE_EDGES,
	resizeRect,
	SNAP_TARGETS,
	snapRect,
} from "./window-geometry.ts"
import type { WindowPresentation } from "./WindowOverlay.tsx"

const STORAGE_KEY = `🔍 Devtools Window`
export const EDGE_LABELS: Record<ResizeEdge, string> = {
	n: `top edge`,
	s: `bottom edge`,
	e: `right edge`,
	w: `left edge`,
	ne: `top right corner`,
	nw: `top left corner`,
	se: `bottom right corner`,
	sw: `bottom left corner`,
}
export const LABELS: Record<SnapTarget, string> = {
	"left-half": `Left half`,
	"right-half": `Right half`,
	"left-third": `Left third`,
	"center-third": `Center third`,
	"right-third": `Right third`,
	"top-half": `Top half`,
	"bottom-half": `Bottom half`,
	full: `Full viewport`,
}
/** Owns geometry and gestures for the SPA window; never writes application state. */
export function createWindowController(
	panel: HTMLElement,
	toggleHidden: () => void,
	publish: (patch: Partial<WindowPresentation>) => void,
): {
	visibility(hidden: boolean, open: boolean): void
	toggleMenu(): void
	choose(target: SnapTarget | null): void
	committed(): void
	dispose(): void
} {
	const doc = panel.ownerDocument,
		win = doc.defaultView!
	const viewport = () => ({
		width: Math.max(1, win.innerWidth),
		height: Math.max(1, win.innerHeight),
	})
	let saved: unknown
	try {
		saved = JSON.parse(win.localStorage.getItem(STORAGE_KEY) ?? `null`)
	} catch {
		/* unavailable or corrupt storage */
	}
	let geometry = readGeometry(saved, viewport())
	let hidden = false,
		open = true,
		menuOpen = false,
		focusPalette = false,
		frame = 0
	let gesture:
		| {
				id: number
				capture: HTMLElement
				before: WindowGeometry
				base: Rect
				startX: number
				startY: number
				x: number
				y: number
				edge: ResizeEdge | null
				active: boolean
				target: SnapTarget | null
				zones: { target: SnapTarget; rect: DOMRect }[]
		  }
		| undefined
	const current = () =>
		geometry.snap ? snapRect(geometry.snap, viewport()) : geometry.free
	const overlay = panel.querySelector<HTMLElement>(`window-overlay`)!
	const layout = panel.querySelector<HTMLButtonElement>(
		`[aria-label="Debugger layout"]`,
	)!
	const toolbar = panel.querySelector<HTMLElement>(`debugger-toolbar`)!
	const targets = [...overlay.querySelectorAll<HTMLButtonElement>(`[data-snap]`)]
	const paint = () => {
		if (!menuOpen) focusPalette = false
		const rect = current()
		publish({
			rect: open
				? rect
				: clampRect({ ...rect, width: 33, height: 28 }, viewport(), 1, 1),
			interaction: menuOpen || Boolean(gesture),
			paletteHidden:
				hidden || !open || !(menuOpen || (gesture?.active && !gesture.edge)),
			menuOpen,
			selected: gesture?.target ?? geometry.snap,
		})
	}
	function persist() {
		try {
			win.localStorage.setItem(STORAGE_KEY, JSON.stringify(geometry))
		} catch {
			/* in-memory geometry remains usable */
		}
	}
	function choose(target: SnapTarget | null) {
		finish(true)
		geometry = { free: clampRect(geometry.free, viewport()), snap: target }
		menuOpen = false
		paint()
		persist()
		layout.focus()
	}
	function update() {
		frame = 0
		if (!gesture?.active) return
		const { base, edge, x, y, startX, startY } = gesture
		const zones = gesture.zones.length
			? gesture.zones
			: gesture.edge
				? []
				: (gesture.zones = targets.map((button, index) => ({
						target: SNAP_TARGETS[index],
						rect: button.getBoundingClientRect(),
					})))
		geometry = {
			free: edge
				? resizeRect(base, edge, x - startX, y - startY, viewport())
				: clampRect(
						{ ...base, x: base.x + x - startX, y: base.y + y - startY },
						viewport(),
					),
			snap: null,
		}
		gesture.target = edge
			? null
			: (zones.find(
					({ rect }) =>
						x >= rect.left &&
						x <= rect.right &&
						y >= rect.top &&
						y <= rect.bottom,
				)?.target ?? edgeTarget(x, y, viewport()))
		publish({
			preview: gesture.target ? snapRect(gesture.target, viewport()) : undefined,
		})
		paint()
	}
	function finish(cancel: boolean) {
		if (!gesture) return
		if (frame) win.cancelAnimationFrame(frame)
		if (!cancel) update()
		const ending = gesture
		const committed = !cancel && ending.active
		gesture = undefined
		frame = 0
		geometry = committed
			? {
					free: ending.target ? ending.before.free : geometry.free,
					snap: ending.target,
				}
			: ending.before
		publish({ preview: undefined })
		try {
			ending.capture.releasePointerCapture(ending.id)
		} catch {
			/* capture can already be lost */
		}
		paint()
		if (committed) persist()
	}
	const down = (event: PointerEvent) => {
		if (
			hidden ||
			!open ||
			gesture ||
			event.button !== 0 ||
			event.isPrimary === false
		)
			return
		const element = event.target as HTMLElement
		const handle = element.closest<HTMLElement>(`[data-resize]`)
		if (
			!handle &&
			(!element.closest(`debugger-toolbar`) ||
				(element.closest(`button, input, select, nav`) &&
					!element.closest(`[data-drag-handle]`)))
		)
			return
		const capture = handle ?? toolbar
		const before = geometry
		let base = current()
		if (!handle && geometry.snap)
			base = clampRect(
				{
					...geometry.free,
					x:
						event.clientX -
						((event.clientX - base.x) / base.width) * geometry.free.width,
					y: event.clientY - Math.min(28, event.clientY - base.y),
				},
				viewport(),
			)
		try {
			capture.setPointerCapture(event.pointerId)
		} catch {
			return
		}
		event.preventDefault()
		menuOpen = false
		gesture = {
			id: event.pointerId,
			capture,
			before,
			base,
			startX: event.clientX,
			startY: event.clientY,
			x: event.clientX,
			y: event.clientY,
			edge: handle ? (handle.dataset[`resize`] as ResizeEdge) : null,
			active: false,
			target: null,
			zones: [],
		}
		paint()
	}
	// Capture tracks a press; only meaningful movement starts a drag/resize.
	function recordPoint(event: PointerEvent) {
		const press = gesture!
		press.x = event.clientX
		press.y = event.clientY
		const dx =
			press.edge && !press.edge.includes(`e`) && !press.edge.includes(`w`)
				? 0
				: press.x - press.startX
		const dy =
			press.edge && !press.edge.includes(`n`) && !press.edge.includes(`s`)
				? 0
				: press.y - press.startY
		if (!press.active && Math.hypot(dx, dy) >= 4) {
			press.active = true
			paint()
		}
	}
	const move = (event: PointerEvent) => {
		if (!gesture || event.pointerId !== gesture.id) return
		recordPoint(event)
		if (!gesture.active) return
		if (!frame) frame = win.requestAnimationFrame(update)
	}
	const up = (event: PointerEvent) => {
		if (!gesture || event.pointerId !== gesture.id) return
		recordPoint(event)
		finish(false)
	}
	const cancel = (event: PointerEvent) => {
		if (gesture?.id === event.pointerId) finish(true)
	}
	const keyboard = (event: KeyboardEvent) => {
		if (event.key === `Escape`) {
			finish(true)
			if (menuOpen) layout.focus()
			menuOpen = false
			paint()
		}
		if (event.ctrlKey && event.shiftKey && event.code === `KeyA`) {
			event.preventDefault()
			toggleHidden()
		}
	}
	const nudge = (event: KeyboardEvent) => {
		const element = event.target as HTMLElement
		if (!element.matches(`[data-drag-handle], [data-resize]`)) return
		const step = {
			ArrowLeft: [-10, 0],
			ArrowRight: [10, 0],
			ArrowUp: [0, -10],
			ArrowDown: [0, 10],
		}[event.key]
		if (!step) return
		const edge = element.dataset[`resize`] as ResizeEdge | undefined
		if (
			edge &&
			((step[0] && !edge.includes(`e`) && !edge.includes(`w`)) ||
				(step[1] && !edge.includes(`n`) && !edge.includes(`s`)))
		)
			return
		event.preventDefault()
		finish(true)
		const base = current()
		const next = edge
			? resizeRect(base, edge, step[0], step[1], viewport())
			: clampRect(
					{ ...base, x: base.x + step[0], y: base.y + step[1] },
					viewport(),
				)
		if (
			next.x === base.x &&
			next.y === base.y &&
			next.width === base.width &&
			next.height === base.height
		)
			return
		geometry = { free: next, snap: null }
		paint()
		persist()
	}
	const resize = () => {
		finish(true)
		geometry = { ...geometry, free: clampRect(geometry.free, viewport()) }
		paint()
	}
	function toggleMenu() {
		finish(true)
		menuOpen = !menuOpen
		focusPalette = menuOpen
		paint()
	}
	const click = (event: Event) => {
		const target = (event.target as Element).closest<HTMLElement>(
			`[data-snap], [data-restore]`,
		)
		if (target)
			choose(
				target.hasAttribute(`data-restore`)
					? null
					: (target.dataset[`snap`] as SnapTarget),
			)
	}
	overlay.addEventListener(`click`, click)
	layout.addEventListener(`click`, toggleMenu)
	panel.addEventListener(`pointerdown`, down)
	panel.addEventListener(`pointermove`, move)
	panel.addEventListener(`pointerup`, up)
	panel.addEventListener(`pointercancel`, cancel)
	panel.addEventListener(`lostpointercapture`, cancel)
	panel.addEventListener(`keydown`, nudge)
	doc.addEventListener(`keydown`, keyboard)
	win.addEventListener(`resize`, resize)
	paint()
	return {
		toggleMenu,
		choose,
		committed() {
			if (focusPalette) {
				focusPalette = false
				targets[0].focus()
			}
		},
		visibility(nextHidden: boolean, nextOpen: boolean): void {
			if (nextHidden || !nextOpen) {
				finish(true)
				menuOpen = false
			}
			hidden = nextHidden
			open = nextOpen
			paint()
		},
		dispose(): void {
			finish(true)
			panel.removeEventListener(`pointerdown`, down)
			panel.removeEventListener(`pointermove`, move)
			panel.removeEventListener(`pointerup`, up)
			panel.removeEventListener(`pointercancel`, cancel)
			panel.removeEventListener(`lostpointercapture`, cancel)
			panel.removeEventListener(`keydown`, nudge)
			doc.removeEventListener(`keydown`, keyboard)
			win.removeEventListener(`resize`, resize)
			layout.removeEventListener(`click`, toggleMenu)
			overlay.removeEventListener(`click`, click)
		},
	}
}
