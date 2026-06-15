import type { VNode } from "preact"
import { useEffect } from "react"

export function GlobalEffectsManager(): VNode {
	useEffect(() => {
		function updateThemeColor() {
			const themeColor = getComputedStyle(document.documentElement)
				.getPropertyValue(`--bg-shade-2`)
				.trim()
			const metaThemeColor = document.querySelector(`meta[name="theme-color"]`)
			if (metaThemeColor) {
				metaThemeColor.setAttribute(`content`, themeColor)
			}
		}
		const matcher = window.matchMedia(`(prefers-color-scheme: dark)`)

		matcher.addEventListener(`change`, updateThemeColor)

		return () => {
			matcher.removeEventListener(`change`, updateThemeColor)
		}
	}, [])
	return <global-effects-manager />
}
