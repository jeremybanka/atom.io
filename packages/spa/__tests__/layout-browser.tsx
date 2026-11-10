import { atom, setState } from "atom.io"

import { floatingCapability } from "../src/floating.ts"
import { render, useGetter } from "../src/index.ts"
import { motionCapability } from "../src/motion.ts"
import { layoutRegressions } from "./layout-regressions-browser.tsx"
import { sceneClockRegression } from "./scene-clock-browser.tsx"

const retainedAtom = atom<boolean>({ key: `retained`, default: true })
const badLayoutAtom = atom<boolean>({ key: `badLayout`, default: false })
const phaseAtom = atom<number>({ key: `phase`, default: 0 })
const anchor = document.createElement(`button`)
anchor.style.cssText = `position:absolute;left:400px;top:400px;width:40px;height:20px`
document.body.append(anchor)
const host = document.createElement(`main`)
document.body.append(host)
const capability = motionCapability({
	layoutTransition: { duration: 0.35, ease: `linear` },
})
let kept: HTMLElement | null = null
function Marker() {
	return (
		<i
			id="marker"
			motion:layout="position"
			motion:layoutId="player"
			motion:layoutGroup="ready"
			style="display:block;width:40px;height:40px;background:orange;border-radius:50%"
		/>
	)
}
function App() {
	const getPhase = useGetter(phaseAtom)
	const getRetained = useGetter(retainedAtom)
	const getBadLayout = useGetter(badLayoutAtom)
	return (
		<>
			<section
				id="panel"
				motion:layout
				motion:layoutTransition={{
					duration: getBadLayout() ? -1 : 0.35,
					ease: `linear`,
				}}
				style={`display:flex;gap:200px;width:${getPhase() % 2 ? 500 : 300}px;height:100px;background:#ddd`}
			>
				<div id="left" style="width:50px;height:80px">
					{getPhase() % 2 === 0 && <Marker key="left" />}
				</div>
				<div id="right" style="width:50px;height:80px">
					{getPhase() % 2 === 1 && <Marker key="right" />}
				</div>
			</section>
			<div
				id="nested-parent"
				motion:layout
				style={`margin-top:40px;width:${getPhase() % 2 ? 240 : 120}px;height:80px;transform:scale(1.2);transform-origin:0 0;background:#aaa`}
			>
				<span
					id="nested"
					motion:layout="position"
					style={`display:block;margin-left:${getPhase() % 2 ? 100 : 0}px;width:30px;height:30px;background:blue;transform:rotate(8deg)`}
				/>
			</div>
			<div
				id="animated-layout"
				motion:layout
				style={`position:absolute;left:8px;top:300px;width:${getPhase() % 2 ? 80 : 40}px;height:40px;background:cyan`}
				motion:animate={getPhase() % 2 ? { x: 50, y: 20 } : { x: 0 }}
				motion:transition={{ duration: 0.2 }}
				motion:whileHover={{ scale: 1.2 }}
			/>

			<i
				id="unrelated"
				motion:layout
				motion:layoutId="player"
				motion:layoutGroup="other"
				style="position:absolute;left:600px;top:10px;width:40px;height:40px;background:green"
			/>
			<aside
				id="floating-layout"
				motion:layout
				floating:reference={anchor}
				floating:placement="bottom"
				floating:strategy="fixed"
				style={`width:${getPhase() % 2 ? 120 : 60}px;height:30px;background:red;transform:rotate(5deg)`}
			/>
			{getRetained() && (
				<section
					id="retained"
					key="retained"
					motion:layout
					motion:layoutId="retained"
					motion:exit={{ opacity: 0 }}
					motion:transition={{ duration: 0.25 }}
					style="width:40px;height:40px;background:purple"
				/>
			)}
		</>
	)
}
const root = render(() => <App />, host, {
	capabilities: [capability, floatingCapability()],
})
const otherHost = document.createElement(`section`)
otherHost.style.cssText = `position:absolute;top:600px;left:20px`
document.body.append(otherHost)
const otherRoot = render(
	() => (
		<i
			id="other-root"
			motion:layout
			motion:layoutId="player"
			motion:layoutGroup="ready"
			style="display:block;width:40px;height:40px;background:purple"
		/>
	),
	otherHost,
	{ capabilities: [capability] },
)
const bounds = (id: string) => {
	const element = document.getElementById(id)!
	const rect = element.getBoundingClientRect()
	return {
		x: rect.x,
		y: rect.y,
		width: rect.width,
		height: rect.height,
		transform: getComputedStyle(element).transform,
		translate: element.style.translate,
		opacity: getComputedStyle(element).opacity,
	}
}
Object.assign(window, {
	layoutTest: {
		regressions: layoutRegressions,
		sceneClock: sceneClockRegression,
		update(phase: number) {
			setState(phaseAtom, phase)
			root.flush()
		},
		show(visible: boolean) {
			setState(retainedAtom, visible)
			root.flush()
		},
		fail() {
			setState(badLayoutAtom, true)
			try {
				root.flush()
				return ``
			} catch (error) {
				return (error as Error).message
			}
		},
		empty() {
			return host.childNodes.length === 0
		},
		inspect() {
			return Object.fromEntries(
				[
					`marker`,
					`panel`,
					`nested`,
					`nested-parent`,
					`animated-layout`,
					`unrelated`,
					`other-root`,
					`floating-layout`,
				].map((id) => [id, bounds(id)]),
			)
		},
		dispose() {
			kept = document.getElementById(`nested`)
			root.dispose()
			otherRoot.dispose()
		},
		afterDispose() {
			return kept?.style.cssText
		},
	},
})
