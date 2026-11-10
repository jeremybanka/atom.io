import type { MotionValue, ValueAnimationTransition } from "motion"
import { animate, keyframes } from "motion"

import type { MotionScalar } from "./motion.ts"

const trajectories = new WeakMap<
	MotionValue<MotionScalar>,
	() => { position: number; velocity: number }
>()
const scalar = /^(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i
const brake = (progress: number) => progress * (2 - progress)
const returnToTarget = (progress: number) =>
	progress * progress * (3 - 2 * progress)

/** Retarget a moving tween without changing its position or velocity at the join. */
export function animateTween(
	value: MotionValue<MotionScalar>,
	goal: MotionScalar | readonly (MotionScalar | null)[],
	transition: ValueAnimationTransition,
	interrupted: boolean,
): ReturnType<typeof animate> {
	if (Array.isArray(goal)) {
		value.stop()
		trajectories.delete(value)
		return animate(
			value,
			goal.map((frame) => frame ?? value.get()),
			{ ...transition, isSync: true },
		)
	}
	if (interrupted) value.stop()
	const current = value.get()
	const from =
		typeof current === `number` ? [``, current, ``] : scalar.exec(current)
	const to =
		typeof goal === `number` ? [``, goal, ``] : scalar.exec(goal as string)
	const previous = trajectories.get(value)?.()
	const velocity =
		previous && from && Math.abs(previous.position - Number(from[1])) < 0.001
			? previous.velocity
			: value.getVelocity()
	trajectories.delete(value)
	const duration = transition.duration ?? 0.3
	// A duration/ease without an explicit type is also a Motion tween. Springs keep
	// Motion's own velocity-aware integration; discrete values keep native mixing.
	const tween =
		transition.type === `tween` ||
		(transition.type === undefined &&
			(transition.duration !== undefined || transition.ease !== undefined))
	const moving =
		interrupted &&
		tween &&
		from &&
		to &&
		from[2] === to[2] &&
		Number.isFinite(velocity) &&
		velocity !== 0 &&
		duration > 0
	const braking = 0.2
	const turn = from ? Number(from[1]) + (velocity * duration * braking) / 2 : 0
	const waypoint = typeof current === `number` ? turn : `${turn}${from?.[2]}`
	const frames = moving ? [current, waypoint, goal] : [current, goal]
	// Constant deceleration: dx/dt at t=0 is v, and at the waypoint is zero.
	// The return starts and ends at rest. Keyframes also handle goal === current.
	const next = moving
		? {
				...transition,
				type: `tween` as const,
				duration,
				delay: 0,
				times: [0, braking, 1],
				ease: [brake, returnToTarget],
			}
		: transition
	// Values are already resolved. Synchronous numeric tweens also keep cancelled,
	// not-yet-started resolver work from being revived by a timeline read.
	const controls = animate(
		value,
		frames,
		tween && (moving || current !== goal) ? { ...next, isSync: true } : next,
	)
	if (
		tween &&
		(moving || current !== goal) &&
		from &&
		to &&
		from[2] === to[2] &&
		duration > 0
	) {
		const curve = keyframes({
			keyframes: moving
				? [Number(from[1]), turn, Number(to[1])]
				: [Number(from[1]), Number(to[1])],
			duration: duration * 1000,
			times: moving ? [0, braking, 1] : [0, 1],
			ease: next.ease ?? `easeOut`,
		})
		const sample = (at: number) => curve.next(at * 1000).value

		// Use the tween's own timeline. Frame-estimated MotionValue velocity becomes
		// noisy when stop/resume happen several times within the same render frame.
		trajectories.set(value, () => {
			const at = Math.max(0, Math.min(duration, controls.time))
			const before = Math.max(0, at - 0.0001),
				after = Math.min(duration, at + 0.0001)
			return {
				position: sample(at),
				velocity:
					at <= 0 || at >= duration
						? 0
						: (sample(after) - sample(before)) / (after - before),
			}
		})
	}
	return controls
}
