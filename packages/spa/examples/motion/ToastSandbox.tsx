import type { VNode } from "@atom.io/spa"
import { onCleanup, onMount, useGetter, useSetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

import { captureMotion } from "./motion-sandbox-debug.ts"

const toastDurationAtom = atom<number>({ key: `toastDuration`, default: 0.24 })
const toastPresentAtom = atom<boolean>({ key: `toastPresent`, default: true })

export function ToastSandbox(): VNode {
	const duration = useGetter(toastDurationAtom),
		setDuration = useSetter(toastDurationAtom)
	const present = useGetter(toastPresentAtom),
		setPresent = useSetter(toastPresentAtom)
	let root!: HTMLElement
	let debug!: ReturnType<typeof captureMotion>
	onMount(() => {
		debug = captureMotion(
			root,
			() => ({
				duration: duration(),
				type: present() ? `spring` : `tween`,
				ease: `easeOut`,
				example: `toast`,
			}),
			setPresent,
		)
		Object.assign(root, { capture: debug.inspect })
		onCleanup(() => {
			debug.dispose()
		})
	})
	return (
		<toast-sandbox
			ref={(node) => {
				if (node) root = node
			}}
		>
			<toast-heading>
				<p className="eyebrow">02 / A CHANGE OF HEART</p>
				<h2>A toast, almost dismissed.</h2>
				<p>
					A quick fade and a shrink to 85%. Interrupt it partway and the same
					notification springs back, with a little overshoot.
				</p>
			</toast-heading>
			<motion-controls aria-label="Toast controls">
				<label for="toast-duration">
					Dismiss duration{` `}
					<output for="toast-duration">{duration().toFixed(2)}s</output>
					<input
						id="toast-duration"
						type="range"
						min="0.12"
						max="2"
						step="0.02"
						value={duration()}
						onInput={(event) => {
							setDuration(Number(event.currentTarget.value))
						}}
					/>
				</label>
				<button
					id="toast-replay"
					onClick={() => {
						debug.replay()
					}}
				>
					Dismiss & interrupt <span aria-hidden="true">↘↗</span>
				</button>
				<button
					id="toast-toggle"
					onClick={() => {
						debug.show(!present())
					}}
				>
					{present() ? `Dismiss` : `Undo dismissal`}
				</button>
			</motion-controls>
			<motion-stage aria-label="Toast dismissal shrinking to 85% and fading out">
				<stage-label className="start">
					SCALE 1 → 0.85 / OPACITY 1 → 0
				</stage-label>
				<stage-label className="end">TWEEN OUT · SPRING BACK</stage-label>
				<canvas data-trail aria-hidden="true" />
				{present() && (
					<motion-card
						key="same-toast"
						className="toast"
						role="status"
						motion:initial={false}
						motion:animate={{ scale: 1, opacity: 1 }}
						motion:exit={{ scale: 0.85, opacity: 0 }}
						motion:transition={
							present()
								? {
										type: `spring`,
										stiffness: 500 * Math.pow(0.24 / duration(), 2),
										damping: (26 * 0.24) / duration(),
									}
								: { type: `tween`, duration: duration(), ease: `easeOut` }
						}
					>
						<toast-icon aria-hidden="true">✓</toast-icon>
						<toast-copy>
							<strong>Changes saved</strong>
							<span>Your edits are safely stored.</span>
						</toast-copy>
						<button
							aria-label="Dismiss notification"
							onClick={() => {
								debug.show(false)
							}}
						>
							×
						</button>
					</motion-card>
				)}
			</motion-stage>
			<motion-debug aria-label="Recorded toast scale, opacity, and velocity">
				<debug-heading>
					<h2>Shrink, fade, rebound.</h2>
					<span className="legend">
						<i className="position" /> Scale <i className="opacity" /> Opacity
						{` `}
						<i className="velocity" /> Velocity
					</span>
				</debug-heading>
				<canvas
					data-plot
					role="img"
					aria-label="Recorded toast scale, opacity, and scale velocity. Scale passes through one as the spring rebounds."
				/>
				<output data-stats aria-live="off">
					Ready. Dismiss and interrupt to capture the rebound.
				</output>
				<label className="scrubber" for="toast-scrub">
					Inspect capture
					<input
						id="toast-scrub"
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
						id="toast-live"
						onClick={() => {
							debug.live()
						}}
					>
						Live trace
					</button>
					<button
						id="toast-png"
						onClick={() => {
							debug.exportPNG()
						}}
					>
						Save sequence PNG
					</button>
					<button
						id="toast-json"
						onClick={() => {
							debug.exportJSON()
						}}
					>
						Save frame data
					</button>
				</debug-actions>
				<ol data-events aria-label="Toast capture event markers" />
			</motion-debug>
			<sandbox-notes>
				<p>
					<strong>Quick by default.</strong> The dismissal takes 240ms. “Dismiss
					& interrupt” brings the toast back 35% into that fade. Increase the
					duration to see the turnaround in slow motion.
				</p>
				<p>
					The return uses a spring, carrying the shrinking velocity before
					expanding past 100% and settling. Dismiss it without interruption to
					see the full 85% shrink and fade; “Undo dismissal” creates a new toast
					once the old one has finished.
				</p>
			</sandbox-notes>
		</toast-sandbox>
	)
}
ToastSandbox.capabilities = [motionCapability({ reducedMotion: `never` })]
