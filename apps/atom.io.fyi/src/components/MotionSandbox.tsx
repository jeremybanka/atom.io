import type { VNode } from "@atom.io/spa"
import { onCleanup, onMount, useSetter, useValue } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

import { captureMotion } from "./motion-sandbox-debug.ts"

const durationAtom = atom<number>({ key: `duration`, default: 2 })
const presentAtom = atom<boolean>({ key: `present`, default: true })
const distanceAtom = atom<number>({ key: `distance`, default: 480 })
const typeAtom = atom<`tween` | `spring`>({ key: `type`, default: `tween` })
const easeAtom = atom<`linear` | `easeInOut` | `easeOut`>({
	key: `ease`,
	default: `linear`,
})

export function MotionSandbox(): VNode {
	const duration = useValue(durationAtom),
		setDuration = useSetter(durationAtom)
	const present = useValue(presentAtom),
		setPresent = useSetter(presentAtom)
	const distance = useValue(distanceAtom),
		setDistance = useSetter(distanceAtom)
	const type = useValue(typeAtom),
		setType = useSetter(typeAtom)
	const ease = useValue(easeAtom),
		setEase = useSetter(easeAtom)
	let root!: HTMLElement
	let debug!: ReturnType<typeof captureMotion>
	onMount(() => {
		const stage = root.querySelector<HTMLElement>(`motion-stage`)!
		const resize = new ResizeObserver(() => {
			setDistance(Math.max(60, stage.clientWidth - 176))
		})
		resize.observe(stage)
		debug = captureMotion(
			root,
			() => ({ duration: duration(), type: type(), ease: ease() }),
			setPresent,
		)
		// Read-only capture access also lets the browser check the actual trajectory.
		Object.assign(root, { capture: debug.inspect })
		onCleanup(() => {
			resize.disconnect()
			debug.dispose()
		})
	})
	return (
		<motion-sandbox
			ref={(node) => {
				if (node) root = node
			}}
		>
			<motion-controls aria-label="Motion controls">
				<label for="motion-duration">
					Transition{` `}
					<output for="motion-duration">{duration().toFixed(2)}s</output>
					<input
						id="motion-duration"
						type="range"
						min="0.25"
						max="5"
						step="0.05"
						value={duration()}
						onInput={(event) => {
							setDuration(Number(event.currentTarget.value))
						}}
					/>
				</label>
				<label for="motion-type">
					Animation
					<select
						id="motion-type"
						value={type()}
						onChange={(event) => {
							setType(event.currentTarget.value as `tween` | `spring`)
						}}
					>
						<option value="tween">Tween</option>
						<option value="spring">Spring</option>
					</select>
				</label>
				<label for="motion-ease">
					Easing
					<select
						id="motion-ease"
						value={ease()}
						disabled={type() === `spring`}
						onChange={(event) => {
							setEase(
								event.currentTarget.value as `linear` | `easeInOut` | `easeOut`,
							)
						}}
					>
						<option value="linear">Linear</option>
						<option value="easeInOut">Ease in / out</option>
						<option value="easeOut">Ease out</option>
					</select>
				</label>
				<button
					id="motion-replay"
					onClick={() => {
						debug.replay()
					}}
				>
					Replay U-turn <span aria-hidden="true">↗↙</span>
				</button>
				<button
					id="motion-toggle"
					onClick={() => {
						debug.show(!present())
					}}
				>
					{present() ? `Exit` : `Bring back`}
				</button>
			</motion-controls>
			<motion-stage aria-label="Live animation with a recorded ghost trail">
				<stage-label className="start">VISIBLE / x = 0</stage-label>
				<stage-label className="end">EXIT →</stage-label>
				<canvas data-trail aria-hidden="true" />
				{present() && (
					<motion-card
						key="same-card"
						motion:initial={false}
						motion:animate={{ x: 0 }}
						motion:exit={{ x: distance() }}
						motion:transition={
							type() === `tween`
								? { type: `tween`, duration: duration(), ease: ease() }
								: {
										type: `spring`,
										stiffness: Math.pow(8 / duration(), 2),
										damping: 16 / duration(),
									}
						}
					>
						<span className="card-symbol" aria-hidden="true">
							↔
						</span>
						<strong>Still me.</strong>
						<span>One instance</span>
					</motion-card>
				)}
			</motion-stage>
			<motion-debug aria-label="Visual capture of the rendered animation">
				<debug-heading>
					<h2>The evidence, frame by frame.</h2>
					<span className="legend">
						<i className="position" /> Position <i className="velocity" />
						{` `}
						Velocity
					</span>
				</debug-heading>
				<canvas
					data-plot
					role="img"
					aria-label="Position and velocity over time. The velocity crosses zero at the turning point."
				/>
				<output data-stats aria-live="off">
					Ready. Replay a U-turn or interrupt the card yourself.
				</output>
				<label className="scrubber" for="motion-scrub">
					Inspect capture
					<input
						id="motion-scrub"
						data-scrub
						type="range"
						min="0"
						max="0"
						step="1"
						value="0"
						onInput={(event) => {
							debug.scrub(Number(event.currentTarget.value))
						}}
					/>
				</label>
				<debug-actions>
					<button
						id="motion-live"
						onClick={() => {
							debug.live()
						}}
					>
						Live trace
					</button>
					<button
						id="motion-png"
						onClick={() => {
							debug.exportPNG()
						}}
					>
						Save sequence PNG
					</button>
					<button
						id="motion-json"
						onClick={() => {
							debug.exportJSON()
						}}
					>
						Save frame data
					</button>
				</debug-actions>
				<ol data-events aria-label="Capture event markers" />
			</motion-debug>
			<sandbox-notes>
				<p>
					<strong>Interrupt it again.</strong> Exit, bring it back, then exit
					while it is returning. The live card keeps its instance. A moving tween
					uses 20% of its new duration to brake, then turns toward its latest
					target over the remaining 80%.
				</p>
				<p>
					The dashed cards are recorded DOM positions. The trace shows the
					outgoing velocity easing to zero before changing direction. Scrubbing
					reviews the capture; it does not seek the live animation. PNG and JSON
					exports keep the sequence for comparison.
				</p>
			</sandbox-notes>
		</motion-sandbox>
	)
}
MotionSandbox.capabilities = [motionCapability({ reducedMotion: `never` })]
