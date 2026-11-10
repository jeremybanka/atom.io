import type { ValueAnimationTransition } from "motion"

import type { MotionScalar, MotionTransition } from "./motion.ts"

export function finalFrame(value: any): MotionScalar {
	return Array.isArray(value) ? value.at(-1) : value
}
/** Property options override default options, which override top-level options. */
export function propertyTransition(
	config: MotionTransition | undefined,
	key: string,
	goal?: unknown,
): ValueAnimationTransition {
	const { default: fallback, properties, ...base } = config ?? {}
	const transition = { ...base, ...fallback, ...properties?.[key] }
	const sequence = Array.isArray(goal)
	if (sequence) {
		if (
			goal.length < 2 ||
			goal.some(
				(value, index) =>
					!(
						typeof value === `string` ||
						(typeof value === `number` && Number.isFinite(value)) ||
						(index === 0 && value === null)
					),
			)
		)
			throw new Error(
				`spa/motion: keyframes require at least two scalar values; only the first may be null`,
			)
		if (transition.type === `spring` && goal.length > 2)
			throw new Error(
				`spa/motion: multi-keyframe sequences require a tween transition`,
			)
		transition.type ??= `tween`
	}
	if (!sequence && !config) transition.type ??= `spring`
	const count = sequence ? goal.length : 2
	if (
		transition.times &&
		(transition.times.length !== count ||
			transition.times[0] !== 0 ||
			transition.times.at(-1) !== 1 ||
			transition.times.some(
				(at, index, times) =>
					!Number.isFinite(at) ||
					at < 0 ||
					at > 1 ||
					(index > 0 && at < times[index - 1]),
			))
	)
		throw new Error(
			`spa/motion: times must match the keyframes and increase from 0 to 1`,
		)
	if (
		Array.isArray(transition.ease) &&
		typeof transition.ease[0] !== `number` &&
		transition.ease.length !== count - 1
	)
		throw new Error(
			`spa/motion: segment easing must match the keyframe intervals`,
		)
	for (const option of [
		`duration`,
		`delay`,
		`visualDuration`,
		`velocity`,
		`bounce`,
		`stiffness`,
		`damping`,
		`mass`,
		`restDelta`,
		`restSpeed`,
	] as const) {
		const value = transition[option]
		if (
			value !== undefined &&
			(!Number.isFinite(value) ||
				(option !== `velocity` && option !== `delay` && value < 0) ||
				(option === `bounce` && value >= 1) ||
				([`stiffness`, `damping`, `mass`, `restDelta`, `restSpeed`].includes(
					option,
				) &&
					value === 0))
		)
			throw new Error(
				`spa/motion: animation requires a finite settling transition`,
			)
	}
	return transition as ValueAnimationTransition
}
