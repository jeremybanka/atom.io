import type { MotionValue, ValueAnimationTransition } from "motion"
import {
	animate,
	cancelFrame,
	frame,
	hover,
	motionValue,
	press,
	readStyleValue,
	styleEffect,
} from "motion"

import type {
	Capability,
	CapabilityBinding,
	CapabilityTarget,
} from "./capabilities.ts"

export type MotionScalar = number | string
export type MotionDOMTarget = Partial<
	Record<
		| keyof CSSStyleDeclaration
		| `x`
		| `y`
		| `z`
		| `scale`
		| `scaleX`
		| `scaleY`
		| `rotate`
		| `rotateX`
		| `rotateY`
		| `rotateZ`
		| `skewX`
		| `skewY`
		| `--${string}`,
		MotionScalar
	>
>
export interface MotionThreeTarget {
	position?: readonly [number, number, number]
	rotation?: readonly [number, number, number]
	scale?: number | readonly [number, number, number]
	opacity?: number
	intensity?: number
	color?: string
}
export type MotionTarget<Kind extends string> = Kind extends `dom`
	? MotionDOMTarget
	: Kind extends `three`
		? MotionThreeTarget
		: Record<string, MotionScalar>
/** Supported transition options; keep public declarations independent of optional peer types. */
export interface MotionTransition {
	type?: `spring` | `tween`
	stiffness?: number
	damping?: number
	mass?: number
	velocity?: number
	restSpeed?: number
	restDelta?: number
	bounce?: number
	visualDuration?: number
	duration?: number
	delay?: number
	ease?:
		| `linear`
		| `easeIn`
		| `easeOut`
		| `easeInOut`
		| `circIn`
		| `circOut`
		| `circInOut`
		| `backIn`
		| `backOut`
		| `backInOut`
		| readonly [number, number, number, number]
}
export interface MotionAttributes<Kind extends string = `dom`> {
	[`motion:initial`]?: MotionTarget<Kind> | false
	[`motion:animate`]?: MotionTarget<Kind>
	[`motion:transition`]?: MotionTransition
	[`motion:whileHover`]?: MotionTarget<Kind>
	[`motion:whileTap`]?: MotionTarget<Kind>
}

// eslint-disable-next-line quotes -- TypeScript module augmentation requires a string literal.
declare module "@atom.io/spa/jsx-runtime" {
	// oxlint-disable-next-line typescript/no-empty-interface -- Declaration merging adds optional motion attributes.
	interface CapabilityAttributes<
		Kind extends string,
	> extends MotionAttributes<Kind> {}
}

export interface MotionCapabilityOptions {
	/** Respect the user's reduced-motion preference by default. */
	reducedMotion?: `user` | `always` | `never`
}
type TargetValues = Record<string, MotionScalar | readonly number[]>
interface AnimatedProperty {
	values: MotionValue<MotionScalar>[]
	base: MotionScalar | readonly number[]
	target: MotionScalar | readonly number[]
	release(): void
}
const transform =
	/^(x|y|z|translate.*|scale.*|rotate.*|skew.*|transformPerspective)$/
const allowed = new Set([
	`initial`,
	`animate`,
	`transition`,
	`whileHover`,
	`whileTap`,
])
function equal(a: unknown, b: unknown): boolean {
	return (
		Object.is(a, b) ||
		(Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((value, index) => Object.is(value, b[index])))
	)
}

function attach(
	target: CapabilityTarget,
	options: MotionCapabilityOptions,
): CapabilityBinding {
	if (target.kind !== `dom` && (!target.read || !target.write))
		throw new Error(
			`spa/motion: renderer ${target.kind} does not support motion`,
		)
	const element =
		target.kind === `dom` ? (target.node as HTMLElement | SVGElement) : undefined
	const properties = new Map<string, AnimatedProperty>()
	const originalStyles = new Map<string, { value: string; priority: string }>()
	let styles: (() => void) | undefined
	let props: Record<string, unknown> = {}
	let hovered = false
	let tapped = false
	let started = false
	let dead = false
	let gestures: (() => void)[] = []
	const preference =
		options.reducedMotion !== `never` && typeof matchMedia === `function`
			? matchMedia(`(prefers-reduced-motion: reduce)`)
			: undefined
	const reduced = () =>
		options.reducedMotion === `always` ||
		(options.reducedMotion !== `never` && preference?.matches)
	const read = (key: string, fallback: unknown): any => {
		const value = element ? readStyleValue(element, key) : target.read!(key)
		return value === undefined || value === ``
			? typeof fallback === `number`
				? key.startsWith(`scale`) || key === `opacity`
					? 1
					: 0
				: fallback
			: value
	}
	const bindStyles = () => {
		styles?.()
		if (element)
			styles = styleEffect(
				[element],
				Object.fromEntries(
					[...properties].map(([key, property]) => [key, property.values[0]]),
				) as any,
			)
	}
	const ensure = (
		key: string,
		goal: MotionScalar | readonly number[],
		initial: TargetValues | false,
	): AnimatedProperty => {
		const existing = properties.get(key)
		if (existing) {
			if (existing.values.length !== (Array.isArray(goal) ? goal.length : 1))
				throw new Error(`spa/motion: cannot change the shape of ${key}`)
			return existing
		}
		let base = read(key, goal) as MotionScalar | readonly number[]
		if (!Array.isArray(goal) && Array.isArray(base)) base = base[0]!
		let start = initial === false ? goal : (initial[key] ?? base)
		if (!Array.isArray(goal) && Array.isArray(start)) start = start[0]!
		if (
			Array.isArray(goal) &&
			(!Array.isArray(start) || start.length !== goal.length)
		)
			throw new Error(`spa/motion: ${key} requires matching numeric tuples`)
		const values = (Array.isArray(start) ? start : [start]).map((value) =>
			motionValue(value),
		) as MotionValue<MotionScalar>[]
		const unsubscribers: (() => void)[] = []
		if (element) {
			if (Array.isArray(goal))
				throw new Error(
					`spa/motion: DOM targets must be scalar styles or transforms`,
				)
			const cssKey = transform.test(key)
				? `transform`
				: key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
			if (!originalStyles.has(cssKey))
				originalStyles.set(cssKey, {
					value: element.style.getPropertyValue(cssKey),
					priority: element.style.getPropertyPriority(cssKey),
				})
		} else {
			const write = () => {
				target.write!(
					key,
					Array.isArray(goal)
						? values.map((value) => value.get())
						: values[0].get(),
				)
			}
			for (const value of values) unsubscribers.push(value.on(`change`, write))
			write()
		}
		const property: AnimatedProperty = {
			values,
			base,
			target: start,
			release() {
				for (const release of unsubscribers) release()
				for (const value of values) value.destroy()
			},
		}
		properties.set(key, property)
		return property
	}
	const refresh = () => {
		if (dead) return
		const initial = (props[`initial`] ?? {}) as TargetValues | false
		const animateTo = (props[`animate`] ?? {}) as TargetValues
		const hoverTo = (props[`whileHover`] ?? {}) as TargetValues
		const tapTo = (props[`whileTap`] ?? {}) as TargetValues
		const goals = {
			...animateTo,
			...(hovered ? hoverTo : {}),
			...(tapped ? tapTo : {}),
		}
		const keys = new Set([
			...Object.keys(initial || {}),
			...Object.keys(animateTo),
			...Object.keys(hoverTo),
			...Object.keys(tapTo),
		])
		let added = false
		for (const key of keys) {
			const sample =
				goals[key] ?? (initial && initial[key]) ?? hoverTo[key] ?? tapTo[key]
			if (sample === undefined) continue
			const had = properties.has(key)
			ensure(key, sample, started ? {} : initial)
			if (!had) added = true
		}
		if (added) bindStyles()
		const transition = (props[`transition`] ?? {
			type: `spring`,
		}) as ValueAnimationTransition
		for (const [key, property] of properties) {
			const goal = goals[key] ?? (initial && initial[key]) ?? property.base
			if (equal(property.target, goal)) continue
			property.target = Array.isArray(goal) ? [...goal] : goal
			const next = Array.isArray(goal) ? goal : [goal]
			if (next.length !== property.values.length)
				throw new Error(`spa/motion: cannot change the shape of ${key}`)
			property.values.forEach((value, index) => {
				if (reduced() || (!started && initial === false)) value.jump(next[index])
				else animate(value, next[index], transition)
			})
		}
		started = true
	}
	const clearGestures = () => {
		for (const release of gestures) release()
		gestures = []
	}
	const installGestures = () => {
		clearGestures()
		if (element) {
			if (props[`whileHover`])
				gestures.push(
					hover([element], () => {
						hovered = true
						refresh()
						return () => {
							hovered = false
							refresh()
						}
					}),
				)
			if (props[`whileTap`])
				gestures.push(
					press([element], () => {
						tapped = true
						refresh()
						return () => {
							tapped = false
							refresh()
						}
					}),
				)
		} else if (props[`whileHover`] || props[`whileTap`]) {
			if (!target.listen)
				throw new Error(
					`spa/motion: ${target.kind} gestures require a renderer event adapter`,
				)
			const listen = (event: string, run: () => void) =>
				gestures.push(target.listen!(event, run))
			listen(`pointerenter`, () => {
				hovered = true
				refresh()
			})
			listen(`pointerleave`, () => {
				hovered = false
				tapped = false
				refresh()
			})
			listen(`pointerdown`, () => {
				tapped = true
				refresh()
			})
			listen(`pointerup`, () => {
				tapped = false
				refresh()
			})
			listen(`pointercancel`, () => {
				tapped = false
				refresh()
			})
		}
	}
	const preferenceChanged = () => {
		if (reduced()) {
			for (const property of properties.values()) {
				const goal = Array.isArray(property.target)
					? property.target
					: [property.target]
				property.values.forEach((value, i) => {
					value.jump(goal[i])
				})
			}
		}
	}
	preference?.addEventListener(`change`, preferenceChanged)
	return {
		update(next) {
			if (dead) return
			for (const key of Object.keys(next))
				if (!allowed.has(key))
					throw new Error(`spa/motion: unknown property motion:${key}`)
			const gestureChange =
				!started ||
				Boolean(next[`whileHover`]) !== Boolean(props[`whileHover`]) ||
				Boolean(next[`whileTap`]) !== Boolean(props[`whileTap`])
			props = next
			if (gestureChange) installGestures()
			refresh()
		},
		dispose() {
			if (dead) return
			dead = true
			clearGestures()
			preference?.removeEventListener(`change`, preferenceChanged)
			styles?.()
			for (const [key, property] of properties) {
				property.release()
				if (!element) target.write!(key, property.base)
			}
			for (const [key, value] of originalStyles) {
				if (value.value)
					element!.style.setProperty(key, value.value, value.priority)
				else element!.style.removeProperty(key)
			}
			properties.clear()
		},
	}
}

/** Explicit, root-scoped motion:* integration. Importing it never registers globally. */
export function motionCapability(
	options: MotionCapabilityOptions = {},
): Capability {
	return {
		namespace: `motion`,
		attach: (target) => attach(target, options),
		scheduleFrame(callback) {
			const run = ({ timestamp }: { timestamp: number }) => {
				callback(timestamp)
			}
			frame.render(run, true)
			return () => {
				cancelFrame(run)
			}
		},
	}
}
