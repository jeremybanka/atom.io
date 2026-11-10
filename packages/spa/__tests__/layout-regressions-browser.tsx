import { Silo } from "atom.io"

import { render, useGetter } from "../src/index.ts"
import { motionCapability } from "../src/motion.ts"

export function layoutRegressions(): {
	resize(value: number, external?: boolean): void
	removeMotion(): void
	removeLayout(): void
	dispose(): void
} {
	const silo = new Silo({
		name: `layout-regressions`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const widthAtom = silo.atom<number>({ key: `width`, default: 100 })
	const motionAtom = silo.atom<boolean>({ key: `motion`, default: true })
	const layoutAtom = silo.atom<boolean>({ key: `layout`, default: true })
	const host = document.createElement(`main`)
	host.style.cssText = `position:absolute;left:0;top:800px`
	document.body.append(host)
	function App() {
		const getWidth = useGetter(widthAtom)
		const getMotion = useGetter(motionAtom)
		const getLayout = useGetter(layoutAtom)
		return (
			<>
				<style>{`.layout-authored { opacity: .15; pointer-events: none; visibility: hidden; transform-origin: 25px 10px; }`}</style>
				{[`inline`, `stylesheet`].map((source) => (
					<div
						id={`authored-${source}`}
						class={source === `stylesheet` ? `layout-authored` : ``}
						motion:layoutId={`authored-${source}`}
						motion:layout
						style={`width:${getWidth()}px;height:40px;${source === `inline` ? `opacity:.15;pointer-events:none;visibility:hidden` : ``}`}
					/>
				))}
				{[`fixed`, `percent`, `stylesheet`].map((origin) =>
					[false, true].map((projected) => (
						<div
							id={`origin-${origin}-${projected}`}
							class={origin === `stylesheet` ? `layout-authored` : ``}
							{...(projected ? { "motion:layout": true } : {})}
							style={`position:absolute;left:10px;top:100px;width:${getWidth()}px;height:80px;transform:rotate(13deg) scale(1.1);${origin === `stylesheet` ? `` : `transform-origin:${origin === `fixed` ? `25px 10px` : `25% 20%`}`}`}
						/>
					)),
				)}
				<div
					id="persistent-motion"
					{...(getLayout() ? { "motion:layout": true } : {})}
					motion:initial={false}
					motion:animate={{ x: 30, opacity: 0.7 }}
					style={`width:${getWidth()}px;height:40px`}
				/>
				<div
					id="removable-motion"
					motion:layout
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
			motionCapability({ layoutTransition: { duration: 0.2, ease: `linear` } }),
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
		removeLayout(): void {
			silo.setState(layoutAtom, false)
			root.flush()
		},
		dispose(): void {
			root.dispose()
			host.remove()
		},
	}
}
