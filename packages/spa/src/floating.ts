import type {
	AutoUpdateOptions,
	Middleware,
	Placement,
	ReferenceElement,
	Strategy,
} from "@floating-ui/dom"
import { autoUpdate, computePosition } from "@floating-ui/dom"

import type {
	Capability,
	CapabilityBinding,
	CapabilityTarget,
} from "./capabilities.ts"
import type { Scope } from "./core.ts"
import { fail, onMount, within } from "./core.ts"

export interface FloatingAttributes<Kind extends string = `dom`> {
	[`floating:reference`]?: Kind extends `dom` ? ReferenceElement | null : never
	[`floating:placement`]?: Kind extends `dom` ? Placement : never
	[`floating:strategy`]?: Kind extends `dom` ? Strategy : never
	[`floating:middleware`]?: Kind extends `dom` ? readonly Middleware[] : never
	[`floating:enabled`]?: Kind extends `dom` ? boolean : never
	[`floating:autoUpdate`]?: Kind extends `dom`
		? boolean | AutoUpdateOptions
		: never
}

// eslint-disable-next-line quotes -- TypeScript module augmentation requires a string literal.
declare module "@atom.io/spa/jsx-runtime" {
	// oxlint-disable-next-line typescript/no-empty-interface -- Declaration merging supplies optional floating attributes.
	interface CapabilityAttributes<
		Kind extends string,
	> extends FloatingAttributes<Kind> {}
}

interface FloatingProps {
	reference?: ReferenceElement | null
	placement?: Placement
	strategy?: Strategy
	middleware?: readonly Middleware[]
	enabled?: boolean
	autoUpdate?: boolean | AutoUpdateOptions
}
const allowed = new Set([
	`reference`,
	`placement`,
	`strategy`,
	`middleware`,
	`enabled`,
	`autoUpdate`,
])
const observerKeys = [
	`ancestorScroll`,
	`ancestorResize`,
	`elementResize`,
	`layoutShift`,
	`animationFrame`,
] as const
const ownedStyles = [
	`position`,
	`left`,
	`top`,
	`translate`,
	`visibility`,
] as const

function attach(target: CapabilityTarget, scope?: Scope): CapabilityBinding {
	const element = target.node as HTMLElement
	if (
		target.kind !== `dom` ||
		element?.namespaceURI !== `http://www.w3.org/1999/xhtml`
	)
		throw new Error(`spa/floating: floating elements must be HTML elements`)
	let props: FloatingProps = {}
	let dead = false
	let mounted = false
	let generation = 0
	let request = 0
	let stop: (() => void) | undefined
	let reference: ReferenceElement | undefined
	let observing: boolean | AutoUpdateOptions | undefined
	let original: Map<string, { value: string; priority: string }> | undefined
	let positioned = false

	const restore = () => {
		if (!original) return
		for (const [key, style] of original) {
			if (style.value)
				element.style.setProperty(key, style.value, style.priority)
			else element.style.removeProperty(key)
		}
		original = undefined
		positioned = false
	}
	const disconnect = () => {
		++generation
		stop?.()
		stop = undefined
		reference = undefined
	}
	const report = (error: unknown) => {
		if (!scope) {
			queueMicrotask(() => {
				throw error
			})
			return
		}
		try {
			fail(scope._root, error)
		} catch (failure) {
			scope._root.error(failure)
		}
	}
	const updatePosition = () => {
		const anchor = reference
		if (dead || !anchor) return
		const currentGeneration = generation
		const currentRequest = ++request
		void computePosition(anchor, element, {
			placement: props.placement ?? `bottom`,
			strategy: props.strategy ?? `absolute`,
			middleware: props.middleware ? [...props.middleware] : [],
		}).then(
			({ x, y }) => {
				if (
					dead ||
					generation !== currentGeneration ||
					currentRequest !== request
				)
					return
				element.style.setProperty(`translate`, `${x}px ${y}px`)
				if (!positioned) {
					positioned = true
					const visibility = original!.get(`visibility`)!
					if (visibility.value)
						element.style.setProperty(
							`visibility`,
							visibility.value,
							visibility.priority,
						)
					else element.style.removeProperty(`visibility`)
				}
			},
			(error: unknown) => {
				if (
					!dead &&
					generation === currentGeneration &&
					currentRequest === request
				)
					report(error)
			},
		)
	}
	const connect = () => {
		if (dead || !mounted) return
		const nextReference =
			props.enabled === false ? undefined : (props.reference ?? undefined)
		const nextObserving = props.autoUpdate ?? true
		const optionsChanged =
			typeof nextObserving !== typeof observing ||
			(typeof nextObserving === `object` && typeof observing === `object`
				? observerKeys.some(
						(key) =>
							nextObserving[key] !== (observing as AutoUpdateOptions)[key],
					)
				: nextObserving !== observing)
		const reconnect = nextReference !== reference || optionsChanged
		if (reconnect) disconnect()
		if (!nextReference) {
			restore()
			return
		}
		original ??= new Map(
			ownedStyles.map((key) => [
				key,
				{
					value: element.style.getPropertyValue(key),
					priority: element.style.getPropertyPriority(key),
				},
			]),
		)
		element.style.setProperty(`position`, props.strategy ?? `absolute`)
		element.style.setProperty(`left`, `0px`)
		element.style.setProperty(`top`, `0px`)
		if (!positioned) element.style.setProperty(`visibility`, `hidden`)
		reference = nextReference
		observing =
			typeof nextObserving === `object` ? { ...nextObserving } : nextObserving
		if (reconnect && nextObserving !== false) {
			stop = autoUpdate(
				nextReference,
				element,
				updatePosition,
				typeof nextObserving === `object` ? nextObserving : undefined,
			)
		} else updatePosition()
	}
	const mount = () => {
		if (dead) return
		mounted = true
		connect()
	}
	if (scope)
		within(scope, () => {
			onMount(mount)
		})
	else queueMicrotask(mount)
	return {
		update(next) {
			if (dead) return
			for (const key of Object.keys(next))
				if (!allowed.has(key))
					throw new Error(`spa/floating: unknown property floating:${key}`)
			props = next
			connect()
		},
		dispose() {
			if (dead) return
			dead = true
			disconnect()
			restore()
		},
	}
}

/** Position HTML overlays using CSS translate, leaving transform available to Motion. */
export function floatingCapability(): Capability {
	return { namespace: `floating`, attach }
}
