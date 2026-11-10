import type { animate, MotionValue } from "motion"
import {
	cancelFrame,
	frame,
	handOffElementState,
	hover,
	motionValue,
	press,
	readStyleValue,
	styleEffect,
	visualElementStore,
} from "motion"

import type {
	Capability,
	CapabilityBinding,
	CapabilityTarget,
} from "./capabilities.ts"
import type { Root } from "./core.ts"
import { createLayoutController } from "./motion-layout.ts"
import { finalFrame, propertyTransition } from "./motion-transition.ts"
import { animateTween } from "./motion-tween.ts"
import type { ExitHandle } from "./presence.ts"
import { createPresence } from "./presence.ts"

export type MotionKeyframes = readonly [
	MotionScalar | null,
	MotionScalar,
	...MotionScalar[],
]
export type MotionEasing =
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
/** Public options remain independent of optional Motion peer declarations. */
export interface MotionValueTransition {
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
	times?: readonly number[]
	ease?: MotionEasing | readonly MotionEasing[]
}
export interface MotionTransition extends MotionValueTransition {
	default?: MotionValueTransition
	properties?: Readonly<Record<string, MotionValueTransition>>
}
export interface MotionLayoutTransition {
	type?: `spring` | `tween`
	duration?: number
	delay?: number
	ease?:
		| `linear`
		| `easeIn`
		| `easeOut`
		| `easeInOut`
		| readonly [number, number, number, number]
	stiffness?: number
	damping?: number
	mass?: number
}

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
		MotionScalar | MotionKeyframes
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
export interface MotionAttributes<Kind extends string = `dom`> {
	[`motion:layout`]?: Kind extends `dom` ? boolean | `position` | `size` : never
	[`motion:layoutId`]?: Kind extends `dom` ? string | number : never
	[`motion:layoutGroup`]?: Kind extends `dom` ? string | number : never
	[`motion:layoutScroll`]?: Kind extends `dom` ? boolean : never
	[`motion:layoutTransition`]?: Kind extends `dom`
		? MotionLayoutTransition
		: never
	[`motion:initial`]?:
		| (Kind extends `dom`
				? Partial<Record<keyof MotionDOMTarget, MotionScalar>>
				: MotionTarget<Kind>)
		| false
	[`motion:animate`]?: MotionTarget<Kind>
	[`motion:exit`]?: MotionTarget<Kind>
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
	/** Default transition for layout projection; animated properties use motion:transition. */
	layoutTransition?: MotionLayoutTransition
}
type TargetValue = MotionScalar | readonly (MotionScalar | null)[]
type TargetValues = Record<string, TargetValue>
interface AnimatedProperty {
	values: MotionValue<MotionScalar>[]
	base: TargetValue
	rest: TargetValue
	target: TargetValue
	release(): void
}
const transform =
	/^(x|y|z|translate.*|scale.*|rotate.*|skew.*|transformPerspective)$/
const allowed = new Set([
	`initial`,
	`animate`,
	`exit`,
	`transition`,
	`whileHover`,
	`whileTap`,
])
const layoutKeys = {
	layout: `animate`,
	layoutId: `id`,
	layoutGroup: `group`,
	layoutScroll: `scroll`,
	layoutTransition: `transition`,
} as const
function equal(a: unknown, b: unknown): boolean {
	return (
		Object.is(a, b) ||
		(Array.isArray(a) &&
			Array.isArray(b) &&
			a.length === b.length &&
			a.every((value, index) => Object.is(value, b[index])))
	)
}

function attachValues(
	target: CapabilityTarget,
	options: MotionCapabilityOptions,
): CapabilityBinding {
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
	let exiting = false
	let exitHandle: ExitHandle | undefined
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
		if (element) {
			styles = styleEffect(
				[element],
				Object.fromEntries(
					[...properties].map(([key, property]) => [key, property.values[0]]),
				) as any,
			)
			// Layout projection and late-added/gesture values must render together.
			const visual = visualElementStore.get(element)
			if (visual) handOffElementState(element, visual)
		}
	}
	const ensure = (
		key: string,
		goal: TargetValue,
		initial: TargetValues | false,
	): AnimatedProperty => {
		const vector = !element && Array.isArray(goal)
		const sample = element ? finalFrame(goal) : goal
		const existing = properties.get(key)
		if (existing) {
			if (existing.values.length !== (vector ? goal.length : 1))
				throw new Error(`spa/motion: cannot change the shape of ${key}`)
			return existing
		}
		const base = read(key, sample) as TargetValue
		const rest = !vector && Array.isArray(base) ? base[0]! : base
		let start = initial === false ? sample : (initial[key] ?? rest)
		if (!vector && Array.isArray(start)) start = start[0]!
		if (vector && (!Array.isArray(start) || start.length !== goal.length))
			throw new Error(`spa/motion: ${key} requires matching numeric tuples`)
		const values = (Array.isArray(start) ? start : [start]).map((value) =>
			motionValue(value),
		) as MotionValue<MotionScalar>[]
		const unsubscribers: (() => void)[] = []
		if (element) {
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
			rest,
			target: start,
			release() {
				for (const release of unsubscribers) release()
				for (const value of values) value.destroy()
			},
		}
		properties.set(key, property)
		return property
	}
	const refresh = (force = false) => {
		if (dead || exiting) return
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
				goals[key] ??
				(initial === false ? undefined : initial[key]) ??
				hoverTo[key] ??
				tapTo[key]
			if (sample === undefined) continue
			const had = properties.has(key)
			ensure(key, sample, started ? {} : initial)
			if (!had) added = true
		}
		if (added) bindStyles()
		for (const [key, property] of properties) {
			const goal =
				goals[key] ??
				(initial === false ? undefined : initial[key]) ??
				property.rest
			if (!force && equal(property.target, goal)) continue
			property.target = Array.isArray(goal) ? [...goal] : goal
			const next = !element && Array.isArray(goal) ? goal : [goal]
			const transition = propertyTransition(
				props[`transition`] as MotionTransition | undefined,
				key,
				element ? goal : undefined,
			)
			if (next.length !== property.values.length)
				throw new Error(`spa/motion: cannot change the shape of ${key}`)
			property.values.forEach((value, index) => {
				if (reduced() || (!started && initial === false))
					value.jump(finalFrame(next[index]))
				else
					animateTween(
						value,
						next[index],
						transition,
						force || value.isAnimating(),
					)
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
				const goal =
					!element && Array.isArray(property.target)
						? property.target
						: [property.target]
				property.values.forEach((value, i) => {
					value.jump(finalFrame(goal[i]))
				})
			}
		}
	}
	const finishExit = () => {
		exitHandle?.cancel()
	}
	const mediaChanged = () => {
		preferenceChanged()
		if (reduced() && exiting) finishExit()
	}
	preference?.addEventListener(`change`, mediaChanged)
	return {
		exit(next) {
			const goals = next[`exit`] as TargetValues | undefined
			exiting = true
			hovered = tapped = false
			clearGestures()
			const moving = new Set<MotionValue<MotionScalar>>()
			for (const property of properties.values())
				for (const value of property.values) {
					if (value.isAnimating()) moving.add(value)
					value.stop()
				}
			if (!goals || !Object.keys(goals).length || reduced()) return undefined
			const transition = (next[`transition`] ?? {
				type: `spring`,
			}) as MotionTransition
			for (const key of [
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
				const value = transition[key]
				if (
					value !== undefined &&
					(!Number.isFinite(value) ||
						(key !== `velocity` && value < 0) ||
						(key === `bounce` && value >= 1) ||
						([`stiffness`, `damping`, `mass`, `restDelta`, `restSpeed`].includes(
							key,
						) &&
							value === 0))
				)
					throw new Error(
						`spa/motion: exit requires a finite settling transition`,
					)
			}
			let added = false
			for (const [key, goal] of Object.entries(goals)) {
				const had = properties.has(key)
				ensure(key, goal, {})
				if (!had) added = true
			}
			if (added) bindStyles()
			let settle!: () => void
			let reject!: (error: unknown) => void
			const finished = new Promise<void>((resolve, fail) => {
				settle = resolve
				reject = fail
			})
			const controls: ReturnType<typeof animate>[] = []
			for (const [key, goal] of Object.entries(goals)) {
				const property = properties.get(key)!
				property.target = Array.isArray(goal) ? [...goal] : goal
				const values = !element && Array.isArray(goal) ? goal : [goal]
				const resolved = propertyTransition(
					next[`transition`] as MotionTransition | undefined,
					key,
					element ? goal : undefined,
				)
				property.values.forEach((value, index) =>
					controls.push(
						animateTween(value, values[index], resolved, moving.has(value)),
					),
				)
			}
			void Promise.all(controls.map((control) => Promise.resolve(control))).then(
				settle,
				reject,
			)
			exitHandle = {
				finished,
				cancel() {
					for (const control of controls) control.stop()
					settle()
				},
			}
			return exitHandle
		},
		resume() {
			exitHandle?.cancel()
			exitHandle = undefined
			exiting = false
			installGestures()
			refresh(true)
		},
		update(next, previousStyle) {
			const gestureChange =
				!started ||
				Boolean(next[`whileHover`]) !== Boolean(props[`whileHover`]) ||
				Boolean(next[`whileTap`]) !== Boolean(props[`whileTap`])
			props = next
			if (gestureChange && !exiting) installGestures()
			if (previousStyle !== undefined && started && element) {
				const snapshot = element.ownerDocument.createElement(`div`).style
				snapshot.cssText = previousStyle
				for (const key of originalStyles.keys())
					element.style.setProperty(
						key,
						snapshot.getPropertyValue(key),
						snapshot.getPropertyPriority(key),
					)
			}
			refresh()
		},
		dispose() {
			dead = true
			clearGestures()
			exitHandle?.cancel()
			preference?.removeEventListener(`change`, mediaChanged)
			styles?.()
			const visual = element && visualElementStore.get(element)
			for (const [key, property] of properties) {
				// Projection can retain this renderer after the binding is gone.
				if (visual?.values.get(key) === property.values[0])
					visual.removeValue(key)
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
	const layouts = new WeakMap<Root, ReturnType<typeof createLayoutController>>()
	return {
		namespace: `motion`,
		presence: createPresence,
		beforeUpdate(root) {
			const layout = layouts.get(root)
			// A layout binding can first appear during the upcoming DOM writes.
			return layout ? layout.beforeUpdate() : () => layouts.get(root)?.commit()
		},
		attach(target, scope) {
			if (target.kind !== `dom` && (!target.read || !target.write))
				throw new Error(
					`spa/motion: renderer ${target.kind} does not support motion`,
				)
			let values: CapabilityBinding | undefined
			let layout: CapabilityBinding | undefined
			let dead = false
			return {
				update(next, previousStyle) {
					if (dead) return
					const animated: Record<string, unknown> = {}
					const projected: Record<string, unknown> = {}
					for (const [key, value] of Object.entries(next)) {
						if (Object.hasOwn(layoutKeys, key))
							projected[layoutKeys[key as keyof typeof layoutKeys]] = value
						else if (allowed.has(key)) animated[key] = value
						else throw new Error(`spa/motion: unknown property motion:${key}`)
					}
					if (Object.keys(projected).length) {
						if (!layout) {
							const element = target.node as HTMLElement
							if (
								target.kind !== `dom` ||
								element?.namespaceURI !== `http://www.w3.org/1999/xhtml` ||
								!scope
							)
								throw new Error(
									`spa/motion: layout requires an owned HTML element`,
								)
							let controller = layouts.get(scope._root)
							if (!controller) {
								controller = createLayoutController(scope._root, options)
								layouts.set(scope._root, controller)
							}
							layout = controller.attach(element, scope)
						}
						layout.update(projected, previousStyle)
					} else {
						layout?.dispose()
						layout = undefined
					}
					if (
						Object.keys(animated).length ||
						(values && !Object.keys(projected).length)
					) {
						values ??= attachValues(target, options)
						values.update(animated, previousStyle)
					} else {
						values?.dispose()
						values = undefined
					}
				},
				exit(next) {
					if (dead) return undefined
					layout?.exit?.(next)
					return values?.exit?.(next)
				},
				resume() {
					if (dead) return
					layout?.resume?.()
					values?.resume?.()
				},
				dispose() {
					if (dead) return
					dead = true
					try {
						values?.dispose()
					} finally {
						layout?.dispose()
					}
				},
			}
		},
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
