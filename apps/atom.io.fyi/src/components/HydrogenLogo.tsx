import type { VNode } from "@atom.io/hydrogen"
import { onCleanup, onMount } from "@atom.io/hydrogen"
import * as THREE from "three"

import { createHydrogenCloud } from "./hydrogen-orbital-three"
import css from "./HydrogenLogo.module.css"

export type HydrogenLogoProps = {
	variant?: `mark` | `background`
}

export function HydrogenLogo({ variant = `mark` }: HydrogenLogoProps): VNode {
	let host: HTMLElement | null = null
	onMount(() => {
		const container = host
		if (!container) return
		let renderer: THREE.WebGLRenderer
		try {
			renderer = new THREE.WebGLRenderer({
				alpha: true,
				antialias: true,
				powerPreference: `low-power`,
			})
		} catch {
			return // Keep the server-rendered static logo when WebGL is unavailable.
		}
		const model = createHydrogenCloud()
		model.uniforms.uNegative.value = 1
		renderer.setClearColor(0, 0)
		renderer.domElement.setAttribute(`aria-hidden`, `true`)
		container.append(renderer.domElement)
		const abort = new AbortController()
		const { signal } = abort
		const reducedMotion = matchMedia(`(prefers-reduced-motion: reduce)`)
		const light = matchMedia(`(prefers-color-scheme: light)`)
		let frame = 0
		let previous = 0
		let elapsed = 0
		let inView = true
		let lost = false
		let width = 0
		let height = 0
		const render = () => {
			if (lost) return
			const nextWidth = Math.max(container.clientWidth, 1)
			const nextHeight = Math.max(container.clientHeight, 1)
			const ratio = Math.min(devicePixelRatio || 1, 2)
			if (
				nextWidth !== width ||
				nextHeight !== height ||
				renderer.getPixelRatio() !== ratio
			) {
				width = nextWidth
				height = nextHeight
				renderer.setPixelRatio(ratio)
				renderer.setSize(width, height, false)
			}
			model.uniforms.uLight.value = light.matches ? 1 : 0
			model.update(
				width,
				height,
				ratio,
				elapsed,
				variant === `background` ? elapsed / 3 : elapsed,
			)
			renderer.render(model.scene, model.camera)
			container.dataset.ready = `true`
		}
		const active = () =>
			!lost && inView && !document.hidden && !reducedMotion.matches
		const tick = (now: number) => {
			frame = 0
			if (!active()) return
			if (now - previous >= 1000 / 30) {
				elapsed += Math.min((now - previous) / 1000, 0.1)
				previous = now
				render()
			}
			frame = requestAnimationFrame(tick)
		}
		const sync = () => {
			cancelAnimationFrame(frame)
			frame = 0
			previous = performance.now()
			if (active()) frame = requestAnimationFrame(tick)
		}
		const resizeObserver = new ResizeObserver(render)
		resizeObserver.observe(container)
		const intersectionObserver = new IntersectionObserver(([entry]) => {
			inView = entry?.isIntersecting ?? false
			sync()
		})
		intersectionObserver.observe(container)
		document.addEventListener(`visibilitychange`, sync, { signal })
		reducedMotion.addEventListener(`change`, sync, { signal })
		light.addEventListener(`change`, render, { signal })
		renderer.domElement.addEventListener(
			`webglcontextlost`,
			(event) => {
				event.preventDefault()
				lost = true
				delete container.dataset.ready
				sync()
			},
			{ signal },
		)
		renderer.domElement.addEventListener(
			`webglcontextrestored`,
			() => {
				lost = false
				render()
				sync()
			},
			{ signal },
		)
		render()
		sync()
		onCleanup(() => {
			cancelAnimationFrame(frame)
			abort.abort()
			resizeObserver.disconnect()
			intersectionObserver.disconnect()
			model.dispose()
			renderer.dispose()
			renderer.domElement.remove()
			delete container.dataset.ready
		})
	})
	return (
		<hydrogen-logo
			class={css.class}
			data-variant={variant}
			aria-hidden={variant === `background` ? true : undefined}
			ref={(element: HTMLElement | null) => {
				host = element
			}}
			role="img"
			aria-label="Hydrogen logo"
		>
			<img
				src={
					variant === `background`
						? `/hydrogen/logo.png`
						: `/hydrogen/icon-512.png`
				}
				alt=""
				width="160"
				height="160"
				aria-hidden="true"
			/>
		</hydrogen-logo>
	)
}
