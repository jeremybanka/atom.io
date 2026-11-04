import type { JSAnimation, MotionValue, ValueAnimationTransition } from "motion"
import { motionValue } from "motion"
import { expect, it } from "vitest"

import type { MotionScalar } from "../src/motion.ts"
import { animateTween } from "../src/motion-tween.ts"

function sample(value: MotionValue<MotionScalar>, seconds: number) {
	;(value.animation as JSAnimation<MotionScalar>).sample(seconds * 1000)
}
const transition: ValueAnimationTransition = {
	type: `tween`,
	duration: 2,
	ease: `linear`,
	isSync: true,
}
it.each([1, -1])(
	`brakes an interrupted tween at continuous velocity and turns toward the new target (%s)`,
	(direction) => {
		const value = motionValue<MotionScalar>(0)
		value.setWithVelocity(direction * 30, direction * 40, 10)
		const animation = animateTween(value, 0, transition, true)
		animation.pause()
		sample(value, 0)
		expect(value.get()).toBe(direction * 40)
		sample(value, 0.001)
		expect((Number(value.get()) - direction * 40) / 0.001).toBeCloseTo(
			direction * 1000,
			-1,
		)
		sample(value, 0.4)
		expect(value.get()).toBeCloseTo(direction * 240)
		sample(value, 0.41)
		expect(Math.abs(Number(value.get()))).toBeLessThan(240)
		sample(value, 2)
		expect(value.get()).toBe(0)
		animation.stop()
		value.destroy()
	},
)
it(`uses the same bridge for matching CSS units and handles a target at the interruption position`, () => {
	const value = motionValue<MotionScalar>(`0px`)
	value.setWithVelocity(`30px`, `40px`, 10)
	const animation = animateTween(
		value,
		`40px`,
		{ duration: 2, ease: `linear`, isSync: true },
		true,
	)
	animation.pause()
	sample(value, 0.4)
	expect(parseFloat(String(value.get()))).toBeCloseTo(240)
	sample(value, 2)
	expect(value.get()).toBe(`40px`)
	animation.stop()
	value.destroy()
})
it(`retains authored easing for fresh or stationary tweens and bypasses braking for springs, incompatible values, and zero duration`, () => {
	for (const [current, goal, next, interrupted] of [
		[40, 0, transition, false],
		[40, 0, { ...transition, type: `spring` }, true],
		[40, 0, { isSync: true }, true],
		[`40px`, `0%`, transition, true],
		[`auto`, `auto`, transition, true],
		[40, 0, { ...transition, duration: 0 }, true],
	] as const) {
		const value = motionValue<MotionScalar>(current)
		value.setWithVelocity(current, current, 10)
		const animation = animateTween(value, goal, next, interrupted)
		animation.complete()
		animation.stop()
		value.destroy()
	}
	const stationary = motionValue<MotionScalar>(40)
	const animation = animateTween(stationary, 0, transition, true)
	animation.pause()
	sample(stationary, 1)
	expect(stationary.get()).toBeCloseTo(20)
	animation.stop()
	stationary.destroy()
})
it(`handles repeated interruption using the velocity of the returning segment`, () => {
	const value = motionValue<MotionScalar>(40)
	value.setWithVelocity(30, 40, 10)
	const first = animateTween(value, 0, transition, true)
	first.pause()
	sample(value, 1)
	const position = Number(value.get())
	sample(value, 1.001)
	const nextPosition = Number(value.get())
	first.time = 1.001
	first.stop()
	value.setWithVelocity(position, nextPosition, 1)
	const velocity = value.getVelocity()
	const second = animateTween(value, 400, transition, true)
	second.pause()
	sample(value, 0.001)
	expect((Number(value.get()) - nextPosition) / 0.001).toBeCloseTo(velocity, -1)
	sample(value, 0.4)
	expect(Number(value.get())).toBeLessThan(nextPosition)
	sample(value, 2)
	expect(value.get()).toBe(400)
	second.stop()
	value.destroy()
})

it(`completes a stationary no-op tween promptly instead of retaining it for its authored duration`, () => {
	const value = motionValue<MotionScalar>(0)
	const animation = animateTween(value, 0, { type: `tween`, duration: 2 }, false)
	expect(animation.duration).toBe(0)
	animation.stop()
	value.destroy()
})
