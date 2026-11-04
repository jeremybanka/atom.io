import { cancelFrame, frame } from "motion"

export interface MotionSample {
	time: number
	x: number
	scale: number
	opacity: number
	velocity: number
	present: boolean
	phase: string
	instance: number
}
export interface MotionMarker {
	time: number
	x: number
	label: string
	settings: Settings
}
interface Settings {
	duration: number
	type: `tween` | `spring`
	ease: string
	example?: `toast`
}
export interface MotionCapture {
	settings: Settings
	samples: MotionSample[]
	markers: MotionMarker[]
}

export interface MotionDebug {
	show(present: boolean): void
	replay(): void
	scrub(index: number): void
	live(): void
	inspect(): MotionCapture
	exportJSON(): void
	exportPNG(): void
	dispose(): void
}

/** Observe rendered DOM after Motion's render phase; the debug layer never drives it. */
export function captureMotion(
	root: HTMLElement,
	settings: () => Settings,
	toggle: (present: boolean) => void,
): MotionDebug {
	const trail = root.querySelector<HTMLCanvasElement>(`[data-trail]`)!
	const plot = root.querySelector<HTMLCanvasElement>(`[data-plot]`)!
	const stats = root.querySelector<HTMLOutputElement>(`[data-stats]`)!
	const scrub = root.querySelector<HTMLInputElement>(`[data-scrub]`)!
	const events = root.querySelector<HTMLOListElement>(`[data-events]`)!
	const surface = root.querySelector<HTMLElement>(`motion-stage`)!
	const toast = settings().example === `toast`
	const metric = (at: MotionSample) => (toast ? at.scale : at.x)
	const resting = toast ? 1 : 0
	const metricLabel = toast ? `scale` : `x`
	const unit = toast ? `` : `px`
	const velocityEpsilon = toast ? 0.001 : 0.5
	let cardWidth = toast ? 340 : 96,
		cardHeight = 84
	let capture: MotionCapture = { settings: settings(), samples: [], markers: [] }
	let start = performance.now(),
		present = true,
		instance = 0,
		element: HTMLElement | null = null
	let previous: MotionSample | undefined
	let settledSince: number | undefined
	let direction = 0
	let phase = `visible`,
		reviewing = false,
		dead = false
	let timer: ReturnType<typeof setTimeout> | undefined
	const marker = (
		label: string,
		sample: Pick<MotionSample, `time` | `x`> = {
			time: performance.now() - start,
			x: previous?.x ?? 0,
		},
	) => {
		capture.markers.push({
			label,
			time: sample?.time ?? 0,
			x: sample?.x ?? 0,
			settings: settings(),
		})
		const item = document.createElement(`li`)
		item.textContent = `${((sample?.time ?? 0) / 1000).toFixed(2)}s · ${label}`
		events.append(item)
	}
	const canvas = (node: HTMLCanvasElement) => {
		const width = node.clientWidth,
			height = node.clientHeight,
			ratio = devicePixelRatio || 1
		if (
			node.width !== Math.round(width * ratio) ||
			node.height !== Math.round(height * ratio)
		) {
			node.width = Math.round(width * ratio)
			node.height = Math.round(height * ratio)
		}
		const ctx = node.getContext(`2d`)!
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
		ctx.clearRect(0, 0, width, height)
		return { ctx, width, height }
	}
	const draw = (index = capture.samples.length - 1) => {
		const sample = capture.samples[index]
		const { ctx, width, height } = canvas(trail)
		const color = (at: MotionSample) =>
			at.phase === `exiting` ? `#ffb29c` : `#94e4c6`
		const limit = Math.min(index, capture.samples.length - 1)
		// Ghosts record where the actual card was, rather than a simulated trajectory.
		let last = -1000
		for (let i = 0; i <= limit; i++) {
			const at = capture.samples[i]
			if (at.time - last < 110 && i !== limit) continue
			last = at.time
			ctx.strokeStyle = color(at)
			ctx.globalAlpha = i === limit && reviewing ? 0.95 : 0.2
			ctx.setLineDash([3, 4])
			const scaledWidth = cardWidth * at.scale,
				scaledHeight = cardHeight * at.scale
			ctx.strokeRect(
				toast ? (width - scaledWidth) / 2 : 24 + at.x,
				(height - scaledHeight) / 2,
				scaledWidth,
				scaledHeight,
			)
			if (toast && i === limit && reviewing) {
				ctx.fillStyle = color(at)
				ctx.font = `11px ui-monospace, monospace`
				ctx.fillText(
					`${(at.scale * 100).toFixed(1)}% · opacity ${at.opacity.toFixed(2)}`,
					(width - scaledWidth) / 2,
					(height - scaledHeight) / 2 - 10,
				)
			}
		}
		ctx.globalAlpha = 1
		ctx.setLineDash([])
		for (const mark of capture.markers) {
			if (sample && mark.time > sample.time) continue
			ctx.fillStyle = mark.label === `turn` ? `#ffe598` : `#b9b5f9`
			ctx.beginPath()
			ctx.arc(
				toast ? width / 2 : 72 + mark.x,
				height / 2 + 58,
				3,
				0,
				Math.PI * 2,
			)
			ctx.fill()
		}
		const graph = canvas(plot),
			pad = 30
		const maxTime = Math.max(1000, capture.samples.at(-1)?.time ?? 0)
		const maxX = Math.max(
			toast ? 0.15 : 1,
			...capture.samples.map((at) => Math.abs(metric(at) - resting)),
		)
		const maxV = Math.max(
			toast ? 0.1 : 1,
			...capture.samples.map((at) => Math.abs(at.velocity)),
		)
		graph.ctx.strokeStyle = `#30383f`
		graph.ctx.lineWidth = 1
		for (const y of [graph.height * 0.38, graph.height * 0.76]) {
			graph.ctx.beginPath()
			graph.ctx.moveTo(pad, y)
			graph.ctx.lineTo(graph.width - pad, y)
			graph.ctx.stroke()
		}
		const line = (value: (at: MotionSample) => number, stroke: string) => {
			graph.ctx.strokeStyle = stroke
			graph.ctx.lineWidth = 2
			graph.ctx.beginPath()
			capture.samples.forEach((at, i) => {
				const x = pad + (at.time / maxTime) * (graph.width - pad * 2),
					y = value(at)
				if (i) graph.ctx.lineTo(x, y)
				else graph.ctx.moveTo(x, y)
			})
			graph.ctx.stroke()
		}
		line(
			(at) =>
				graph.height * 0.38 -
				((metric(at) - resting) / maxX) * graph.height * 0.28,
			`#94e4c6`,
		)
		if (toast)
			line(
				(at) => graph.height * 0.38 + (1 - at.opacity) * graph.height * 0.28,
				`#b9b5f9`,
			)
		line(
			(at) => graph.height * 0.76 - (at.velocity / maxV) * graph.height * 0.16,
			`#ffb29c`,
		)
		graph.ctx.font = `11px ui-monospace, monospace`
		for (const mark of capture.markers) {
			const x = pad + (mark.time / maxTime) * (graph.width - pad * 2)
			graph.ctx.strokeStyle = `#b9b5f955`
			graph.ctx.beginPath()
			graph.ctx.moveTo(x, 6)
			graph.ctx.lineTo(x, graph.height - 12)
			graph.ctx.stroke()
			graph.ctx.fillStyle = `#b9b5f9`
			graph.ctx.fillText(
				mark.label,
				Math.min(x + 4, graph.width - 68),
				graph.height - 5,
			)
		}
		if (sample) {
			const x = pad + (sample.time / maxTime) * (graph.width - pad * 2)
			graph.ctx.strokeStyle = `#eef5ef`
			graph.ctx.beginPath()
			graph.ctx.moveTo(x, 0)
			graph.ctx.lineTo(x, graph.height)
			graph.ctx.stroke()
			stats.textContent = `${(sample.time / 1000).toFixed(2)}s  /  ${metricLabel} ${metric(sample).toFixed(toast ? 3 : 1)}${unit}${toast ? ` / opacity ${sample.opacity.toFixed(2)}` : ``}  /  v ${sample.velocity.toFixed(toast ? 3 : 1)}${unit}/s  /  ${sample.phase}  /  instance ${sample.instance}`
		}
		scrub.max = String(Math.max(0, capture.samples.length - 1))
		if (!reviewing) scrub.value = scrub.max
		root.dataset.frames = String(capture.samples.length)
		root.dataset.reviewing = String(reviewing)
		root.dataset.phase = phase
		// Kept for layout checks in the browser sandbox test.
		surface.dataset.width = String(width)
	}
	const read = () => {
		if (dead) return
		const node = surface.querySelector<HTMLElement>(`motion-card`)
		if (node && node !== element) {
			element = node
			instance++
			marker(`mount #${instance}`)
		}
		const style = node ? getComputedStyle(node) : undefined
		const matrix = style ? new DOMMatrixReadOnly(style.transform) : undefined
		const x = matrix?.m41 ?? previous?.x ?? 0
		const scale = matrix
			? Math.hypot(matrix.a, matrix.b)
			: (previous?.scale ?? 1)
		const opacity = style ? Number(style.opacity) : 0
		if (node) {
			cardWidth = node.offsetWidth
			cardHeight = node.offsetHeight
		}
		const value = toast ? scale : x
		const time = performance.now() - start
		const velocity =
			previous &&
			node &&
			previous.instance === instance &&
			previous.phase !== `disposed`
				? ((value - metric(previous)) / Math.max(1, time - previous.time)) * 1000
				: 0
		if (!node && previous?.phase !== `disposed`) {
			phase = `disposed`
			marker(`dispose`)
		}
		if (
			direction &&
			direction * velocity < -velocityEpsilon &&
			(phase === `returning` || phase === `exiting`)
		)
			marker(`turn`)
		if (Math.abs(velocity) > velocityEpsilon) direction = Math.sign(velocity)

		if (
			present &&
			node &&
			Math.abs(value - resting) < (toast ? 0.0001 : 0.05) &&
			Math.abs(opacity - 1) < (toast ? 0.00001 : 0.001) &&
			Math.abs(velocity) < (toast ? 0.001 : 0.5)
		) {
			settledSince ??= time
			if (
				!toast ||
				time - settledSince >= Math.max(120, settings().duration * 600)
			) {
				phase = `visible`
				direction = 0
			}
		} else {
			settledSince = undefined
			if (present && node && phase === `visible`) phase = `returning`
		}
		if (!node) direction = 0
		const at = { time, x, scale, opacity, velocity, present, phase, instance }
		// Stop growing a settled capture, but keep the subscription ready for a toggle.
		if (
			!previous ||
			phase !== previous.phase ||
			(phase !== `visible` && phase !== `disposed`) ||
			Math.abs(metric(previous) - value) > (toast ? 0.00001 : 0.01) ||
			Math.abs(previous.opacity - opacity) > 0.001 ||
			time < 150
		) {
			capture.samples.push(at)
			root.dataset.frames = String(capture.samples.length)
			previous = at
			if (capture.samples.length > 3600) {
				capture.samples.shift()
			}
			if (!reviewing) draw()
		}
	}
	frame.postRender(read, true)
	const show = (next: boolean) => {
		settledSince = undefined
		clearTimeout(timer)
		reviewing = false
		present = next
		phase = next ? `returning` : `exiting`
		toggle(next)
		marker(next ? `re-entry` : `exit`)
		draw()
	}
	return {
		show,
		replay() {
			clearTimeout(timer)
			reviewing = false
			toggle(true)
			present = true
			start = performance.now()
			previous = undefined
			settledSince = undefined
			direction = 0
			phase = `visible`
			capture = { settings: settings(), samples: [], markers: [] }
			events.replaceChildren()
			marker(`capture · instance #${instance}`)
			// Begin after the current render so the initial sample is in the capture.
			timer = setTimeout(() => {
				show(false)
				timer = setTimeout(() => {
					show(true)
				}, settings().duration * 350)
			}, 50)
		},
		scrub(index: number) {
			reviewing = true
			draw(index)
		},
		live() {
			reviewing = false
			draw()
		},
		inspect: () => structuredClone(capture),
		exportJSON() {
			download(
				new Blob([JSON.stringify(capture, null, 2)], {
					type: `application/json`,
				}),
				`spa-motion-capture.json`,
			)
		},
		exportPNG() {
			// The contact sheet preserves the sequence, including the turn and its trace.
			const sheet = document.createElement(`canvas`)
			sheet.width = 1200
			sheet.height = 840
			const ctx = sheet.getContext(`2d`)!
			ctx.fillStyle = `#11191d`
			ctx.fillRect(0, 0, 1200, 840)
			ctx.fillStyle = `#edf5ef`
			ctx.font = `24px ui-monospace, monospace`
			ctx.fillText(
				`SPA / ${toast ? `toast dismissal` : `${capture.settings.type} U-turn`} / ${capture.settings.duration}s`,
				28,
				42,
			)
			const count = Math.min(8, capture.samples.length)
			for (let i = 0; i < count; i++) {
				const at =
					capture.samples[
						Math.round(
							(i / Math.max(1, count - 1)) * (capture.samples.length - 1),
						)
					]
				const col = i % 2,
					row = Math.floor(i / 2),
					x = col * 600,
					y = 70 + row * 145
				ctx.strokeStyle = `#34454c`
				ctx.strokeRect(x + 20, y, 560, 125)
				ctx.fillStyle = at.phase === `exiting` ? `#ffb29c` : `#94e4c6`
				ctx.globalAlpha = toast ? Math.max(0.08, at.opacity) : 1
				const w = toast ? 170 * at.scale : 55,
					h = toast ? 48 * at.scale : 42
				ctx.fillRect(
					toast
						? x + 300 - w / 2
						: x + 40 + (at.x / Math.max(1, surface.clientWidth)) * 440,
					y + 55 - h / 2,
					w,
					h,
				)
				ctx.globalAlpha = 1

				ctx.font = `13px ui-monospace, monospace`
				ctx.fillText(
					`${(at.time / 1000).toFixed(2)}s  ${metricLabel}=${metric(at).toFixed(toast ? 3 : 1)}${toast ? ` α=${at.opacity.toFixed(2)}` : ``}  v=${at.velocity.toFixed(toast ? 3 : 1)}  ${at.phase}`,
					x + 35,
					y + 107,
				)
			}
			ctx.drawImage(plot, 20, 665, 1160, 150)
			sheet.toBlob((blob) => {
				if (blob) download(blob, `spa-motion-sequence.png`)
			})
		},
		dispose() {
			dead = true
			clearTimeout(timer)
			cancelFrame(read)
			element = null
		},
	}
}
function download(blob: Blob, name: string) {
	const url = URL.createObjectURL(blob),
		link = document.createElement(`a`)
	link.href = url
	link.download = name
	link.click()
	setTimeout(() => {
		URL.revokeObjectURL(url)
	}, 0)
}
