import { Silo } from "atom.io"

import { render, useGetter } from "../src/index.ts"
import { layoutCapability } from "../src/layout.ts"
import { motionCapability } from "../src/motion.ts"

export function layoutRegressions(): {
	resize(value: number, external?: boolean): void
	removeMotion(): void
	dispose(): void
} {
	const silo = new Silo({
		name: `layout-regressions`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const widthAtom = silo.atom<number>({ key: `width`, default: 100 })
	const motionAtom = silo.atom<boolean>({ key: `motion`, default: true })
	const host = document.createElement(`main`)
	host.style.cssText = `position:absolute;left:0;top:800px`
	document.body.append(host)
	function App() {
		const getWidth = useGetter(widthAtom)
		const getMotion = useGetter(motionAtom)
		return (
			<>
				<style>{`.layout-authored { opacity: .15; pointer-events: none; visibility: hidden; transform-origin: 25px 10px; }`}</style>
				{[`inline`, `stylesheet`].map((source) => (
					<div
						id={`authored-${source}`}
						class={source === `stylesheet` ? `layout-authored` : ``}
						layout:id={`authored-${source}`}
						layout:animate
						style={`width:${getWidth()}px;height:40px;${source === `inline` ? `opacity:.15;pointer-events:none;visibility:hidden` : ``}`}
					/>
				))}
				{[`fixed`, `percent`, `stylesheet`].map((origin) =>
					[false, true].map((projected) => (
						<div
							id={`origin-${origin}-${projected}`}
							class={origin === `stylesheet` ? `layout-authored` : ``}
							{...(projected ? { "layout:animate": true } : {})}
							style={`position:absolute;left:10px;top:100px;width:${getWidth()}px;height:80px;transform:rotate(13deg) scale(1.1);${origin === `stylesheet` ? `` : `transform-origin:${origin === `fixed` ? `25px 10px` : `25% 20%`}`}`}
						/>
					)),
				)}
				<div
					id="removable-motion"
					layout:animate
					style={`width:${getWidth()}px;height:40px;transform:rotate(5deg);opacity:.6`}
					{...(getMotion()
						? {
								"motion:initial": false,
								"motion:animate": { x: 50, opacity: 0.2 },
							}
						: {})}
				/>
			</>
		)
	}
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [
			layoutCapability({ transition: { duration: 0.2, ease: `linear` } }),
			motionCapability({ reducedMotion: `always` }),
		],
	})
	return {
		resize(value: number, external = false): void {
			if (external)
				for (const element of host.querySelectorAll<HTMLElement>(`div`))
					element.style.width = `${value}px`
			else {
				silo.setState(widthAtom, value)
				root.flush()
			}
		},
		removeMotion(): void {
			silo.setState(motionAtom, false)
			root.flush()
		},
		dispose(): void {
			root.dispose()
			host.remove()
		},
	}
}
