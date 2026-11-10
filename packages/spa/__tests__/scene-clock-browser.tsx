import { Silo } from "atom.io"

import { render, useGetter, useSetter } from "../src/index.ts"
import { motionCapability } from "../src/motion.ts"
import { onSceneFrame } from "../src/renderer.ts"
import { Canvas } from "../src/three.ts"

type Sample = { frame: number; time: number; delta?: number }
interface ClockSnapshot {
	samples: Record<`direct` | `scene` | `canvas`, Sample[]>
	browserFrame: number
	clicks: number
	cleanups: number
	tick: number
}

export function sceneClockRegression(): {
	inspect(): ClockSnapshot
	disposeOnNextFrame(): void
	dispose(): void
} {
	const silo = new Silo({
		name: `scene-clock`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const tickAtom = silo.atom<number>({ key: `tick`, default: 0 })
	const samples: Record<`direct` | `scene` | `canvas`, Sample[]> = {
		direct: [],
		scene: [],
		canvas: [],
	}
	let browserFrame = 0
	let clicks = 0
	let cleanups = 0
	let disposeOnFrame = false
	const markFrame = () => {
		browserFrame++
		frame = requestAnimationFrame(markFrame)
	}
	let frame = requestAnimationFrame(markFrame)
	const host = document.createElement(`main`)
	document.body.append(host)
	function SceneHook() {
		const setTick = useSetter(tickAtom)
		onSceneFrame((time) => {
			if (samples.scene.length >= 100) return
			samples.scene.push({ frame: browserFrame, time })
			setTick((value) => value + 1)
		})
		return null
	}
	function App() {
		const getTick = useGetter(tickAtom)
		const setTick = useSetter(tickAtom)
		onSceneFrame((time) => {
			if (samples.direct.length >= 100) return
			samples.direct.push({ frame: browserFrame, time })
			setTick((value) => value + 1)
			if (disposeOnFrame) root.dispose()
		})
		return (
			<section motion:layout style={`width:${100 + (getTick() % 2) * 50}px`}>
				<span id="scene-clock-tick">{getTick()}</span>
				<button
					id="scene-clock-input"
					onClick={() => {
						clicks++
					}}
				>
					Respond to input
				</button>
				<Canvas
					width={40}
					height={40}
					onCreated={() => () => {
						cleanups++
					}}
					onFrame={({ time, delta }) => {
						if (samples.canvas.length >= 100) return
						samples.canvas.push({
							frame: browserFrame,
							time: time * 1000,
							delta,
						})
						setTick((value) => value + 1)
					}}
				>
					<SceneHook />
				</Canvas>
			</section>
		)
	}
	const root = render(() => <App />, host, {
		store: silo.store,
		capabilities: [motionCapability()],
	})
	return {
		inspect(): ClockSnapshot {
			return {
				samples,
				browserFrame,
				clicks,
				cleanups,
				tick: Number(host.querySelector(`#scene-clock-tick`)?.textContent),
			}
		},
		disposeOnNextFrame(): void {
			disposeOnFrame = true
		},
		dispose(): void {
			root.dispose()
			cancelAnimationFrame(frame)
			host.remove()
		},
	}
}
