import type {
	Rect,
	ResizeEdge,
	SnapTarget,
	WindowGeometry,
} from "./window-geometry.ts"
import {
	clampRect,
	edgeTarget,
	LAUNCHER_SIZE,
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
	"left-two-thirds": `Left two-thirds`,
	"center-third": `Center third`,
	"right-two-thirds": `Right two-thirds`,
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
	let suppressLauncherClick = false
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
				launcher: boolean
		  }
		| undefined
	const expanded = () =>
		geometry.snap ? snapRect(geometry.snap, viewport()) : geometry.free
	const current = () =>
		open
			? expanded()
			: clampRect(
					{
						...expanded(),
						...geometry.launcher,
						width: LAUNCHER_SIZE,
						height: LAUNCHER_SIZE,
					},
					viewport(),
					1,
					1,
				)
	const overlay = panel.querySelector<HTMLElement>(`window-overlay`)!
	const layout = panel.querySelector<HTMLButtonElement>(
		`[aria-label="Debugger layout"]`,
	)!
	const toolbar = panel.querySelector<HTMLElement>(`debugger-toolbar`)!
	const launcher = panel.querySelector<HTMLElement>(
		`[data-testid="open-close-devtools"]`,
	)!
	const targets = [...overlay.querySelectorAll<HTMLButtonElement>(`[data-snap]`)]
	const paint = () => {
		if (!menuOpen) focusPalette = false
		const rect = current()
		publish({
			rect,
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
		geometry = {
			...geometry,
			free: clampRect(geometry.free, viewport()),
			snap: target,
		}
		menuOpen = false
		paint()
		persist()
		layout.focus()
	}
	function update() {
		frame = 0
		if (!gesture?.active) return
		const { base, edge, x, y, startX, startY } = gesture
		if (gesture.launcher) {
			const next = clampRect(
				{ ...base, x: base.x + x - startX, y: base.y + y - startY },
				viewport(),
				1,
				1,
			)
			geometry = { ...geometry, launcher: { x: next.x, y: next.y } }
			paint()
			return
		}
		const zones = gesture.zones.length
			? gesture.zones
			: gesture.edge
				? []
				: (gesture.zones = targets.map((button, index) => ({
						target: SNAP_TARGETS[index],
						rect: button.getBoundingClientRect(),
					})))
		geometry = {
			...geometry,
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
		if (!committed) geometry = ending.before
		else if (!ending.launcher)
			geometry = {
				...geometry,
				free: ending.target ? ending.before.free : geometry.free,
				snap: ending.target,
			}
		suppressLauncherClick = ending.launcher && (ending.active || cancel)
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
		if (hidden || gesture || event.button !== 0 || event.isPrimary === false)
			return
		suppressLauncherClick = false
		const element = event.target as HTMLElement
		if (!open && !launcher.contains(element)) return
		const handle = element.closest<HTMLElement>(`[data-resize]`)
		if (
			!handle &&
			(!element.closest(`debugger-toolbar`) ||
				(element.closest(`button, input, select, nav`) &&
					!element.closest(`[data-drag-handle]`)))
		)
			return
		const capture = !open ? launcher : (handle ?? toolbar)
		const before = geometry
		let base = current()
		if (open && !handle && geometry.snap)
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
		if (open) event.preventDefault()
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
			launcher: !open,
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
		const tap =
			gesture.launcher && !gesture.active && event.pointerType === `touch`
		finish(false)
		if (tap) {
			// Moving touch targets do not always receive a compatibility click.
			launcher.click()
			suppressLauncherClick = true
		}
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
		if (
			hidden ||
			!element.matches(`[data-drag-handle], [data-resize]`) ||
			(!open && element !== launcher)
		)
			return
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
					open ? 320 : 1,
					open ? 160 : 1,
				)
		if (
			next.x === base.x &&
			next.y === base.y &&
			next.width === base.width &&
			next.height === base.height
		)
			return
		geometry = open
			? { ...geometry, free: next, snap: null }
			: { ...geometry, launcher: { x: next.x, y: next.y } }
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
	const launcherClick = (event: MouseEvent) => {
		if (!suppressLauncherClick || !launcher.contains(event.target as Node))
			return
		suppressLauncherClick = false
		if (event.detail > 0) {
			event.preventDefault()
			event.stopImmediatePropagation()
		}
	}
	overlay.addEventListener(`click`, click)
	layout.addEventListener(`click`, toggleMenu)
	panel.addEventListener(`pointerdown`, down)
	panel.addEventListener(`pointermove`, move)
	panel.addEventListener(`pointerup`, up)
	panel.addEventListener(`pointercancel`, cancel)
	panel.addEventListener(`lostpointercapture`, cancel)
	panel.addEventListener(`keydown`, nudge)
	panel.addEventListener(`click`, launcherClick, true)
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
			if (nextHidden || nextOpen !== open) {
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
			panel.removeEventListener(`click`, launcherClick, true)
			doc.removeEventListener(`keydown`, keyboard)
			win.removeEventListener(`resize`, resize)
			layout.removeEventListener(`click`, toggleMenu)
			overlay.removeEventListener(`click`, click)
		},
	}
}
