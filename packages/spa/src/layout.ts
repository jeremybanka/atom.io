import type { IProjectionNode, ValueTransition } from "motion"
import { acquireProjectionNode, visualElementStore } from "motion"

import type {
	Capability,
	CapabilityBinding,
	CapabilityTarget,
} from "./capabilities.ts"
import type { Cleanup, Root, Scope } from "./core.ts"
import { fail, onMount, within } from "./core.ts"

export interface LayoutTransition {
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
export interface LayoutAttributes<Kind extends string = `dom`> {
	[`layout:animate`]?: Kind extends `dom` ? boolean | `position` | `size` : never
	[`layout:id`]?: Kind extends `dom` ? string | number : never
	[`layout:group`]?: Kind extends `dom` ? string | number : never
	[`layout:scroll`]?: Kind extends `dom` ? boolean : never
	[`layout:transition`]?: Kind extends `dom` ? LayoutTransition : never
}
// eslint-disable-next-line quotes -- Declaration merging requires a string literal.
declare module "@atom.io/spa/jsx-runtime" {
	// oxlint-disable-next-line typescript/no-empty-interface -- Optional layout attributes augment native props.
	interface CapabilityAttributes<
		Kind extends string,
	> extends LayoutAttributes<Kind> {}
}
export interface LayoutCapabilityOptions {
	reducedMotion?: `user` | `always` | `never`
	transition?: LayoutTransition
}
interface Props {
	animate?: boolean | `position` | `size`
	id?: string | number
	group?: string | number
	scroll?: boolean
	transition?: LayoutTransition
}
interface Entry {
	element: HTMLElement
	scope: Scope
	props: Props
	mounted: boolean
	dead: boolean
	node?: IProjectionNode | undefined
	release?: Cleanup | undefined
	identity?: string
	size?: string
}
const allowed = new Set([`animate`, `id`, `group`, `scroll`, `transition`])
let serial = 0

function controller(root: Root, options: LayoutCapabilityOptions) {
	const prefix = serial++
	const entries = new Set<Entry>()
	let dead = false
	let updating = false
	const preference =
		options.reducedMotion !== `never` && typeof matchMedia === `function`
			? matchMedia(`(prefers-reduced-motion: reduce)`)
			: undefined
	const reduced = () =>
		options.reducedMotion === `always` ||
		(options.reducedMotion !== `never` && Boolean(preference?.matches))
	const report = (error: unknown) => {
		try {
			fail(root, error)
		} catch (failure) {
			root.error(failure)
		}
	}
	const ordered = () =>
		[...entries]
			.filter(
				(entry) => entry.mounted && !entry.dead && entry.element.isConnected,
			)
			.sort((a, b) =>
				a.element.compareDocumentPosition(b.element) &
				Node.DOCUMENT_POSITION_FOLLOWING
					? -1
					: 1,
			)
	const release = (entry: Entry) => {
		const detach = entry.release
		entry.release = undefined
		entry.node = undefined
		detach?.()
	}
	const configure = (entry: Entry) => {
		const transition = entry.props.transition ??
			options.transition ?? { duration: 0.3 }
		for (const name of [
			`duration`,
			`delay`,
			`stiffness`,
			`damping`,
			`mass`,
		] as const) {
			const value = transition[name]
			if (
				value !== undefined &&
				(!Number.isFinite(value) ||
					value < 0 ||
					([`stiffness`, `damping`, `mass`].includes(name) && value === 0))
			)
				throw new Error(`spa/layout: transitions must settle in finite time`)
		}
		entry.node!.setOptions({
			layoutScroll: entry.props.scroll ?? false,
			animationType:
				typeof entry.props.animate === `string` ? entry.props.animate : `both`,
			animate: entry.props.animate !== false && !reduced(),
			transition: (reduced() ? { duration: 0 } : transition) as ValueTransition,
		})
		if (reduced()) entry.node!.finishAnimation()
	}
	const prepare = (entry: Entry) => {
		const { element, props } = entry
		const identity = JSON.stringify([
			prefix,
			props.group ?? ``,
			props.id ?? null,
			props.animate ?? true,
		])
		if (entry.node && entry.identity !== identity) release(entry)
		if (!entry.node) {
			const attrs = [`data-layout`, `data-layout-id`].map(
				(name) => [name, element.getAttribute(name)] as const,
			)
			const style = [
				`transform`,
				`transform-origin`,
				`opacity`,
				`visibility`,
			].map(
				(name) =>
					[
						name,
						element.style.getPropertyValue(name),
						element.style.getPropertyPriority(name),
					] as const,
			)
			const computed = getComputedStyle(element)
			const transform = computed.transform
			const origin = computed.transformOrigin.split(` `)
			element.removeAttribute(`data-layout`)
			element.removeAttribute(`data-layout-id`)
			if (props.animate !== false)
				element.setAttribute(
					`data-layout`,
					typeof props.animate === `string` ? props.animate : `true`,
				)
			if (props.id !== undefined && props.animate !== false)
				element.setAttribute(
					`data-layout-id`,
					JSON.stringify([prefix, props.group ?? ``, props.id]),
				)
			const [node, detach] = acquireProjectionNode(element)
			entry.node = node
			const anchor = {
				x: parseFloat(origin[0]) / (element.offsetWidth || 1),
				y: parseFloat(origin[1]) / (element.offsetHeight || 1),
			}
			if (Number.isFinite(anchor.x) && Number.isFinite(anchor.y)) {
				node.latestValues[`originX`] ??= anchor.x
				node.latestValues[`originY`] ??= anchor.y
			}
			entry.identity = identity
			const visual = node.options.visualElement!
			const originalProps = visual.getProps()
			// Preserve authored transforms; Motion-owned transform values already compose in projection.
			if (
				transform &&
				transform !== `none` &&
				!Object.keys(visual.latestValues).some((key) =>
					/^(x|y|scale|rotate|skew)/.test(key),
				)
			)
				visual.update(
					{
						...originalProps,
						transformTemplate: (_, projected) =>
							`${projected === `none` ? `` : projected} ${transform}`.trim(),
					},
					null,
				)
			entry.release = () => {
				try {
					if (node.isLead()) node.finishAnimation()
					detach()
				} finally {
					visual.projection = undefined
					if (root._dead || entry.scope._dead || !visual.values.size) {
						visual.unmount()
						visualElementStore.delete(element)
					} else visual.update(originalProps, null)
					for (const [name, value] of attrs) {
						if (value === null) element.removeAttribute(name)
						else element.setAttribute(name, value)
					}
					for (const [name, value, priority] of style) {
						if (value) element.style.setProperty(name, value, priority)
						else element.style.removeProperty(name)
					}
				}
			}
			observer?.observe(element)
		}
		configure(entry)
		entry.size = `${element.offsetWidth}:${element.offsetHeight}`
	}
	const commit = () => {
		try {
			if (dead) return
			for (const entry of ordered()) prepare(entry)
			const roots = new Set(
				[...entries].flatMap((entry) =>
					entry.node ? [entry.node.root ?? entry.node] : [],
				),
			)
			for (const projection of roots) projection.didUpdate()
			// Mount replacements before dropping outgoing nodes so shared snapshots can hand off.
			for (const entry of entries)
				if (entry.dead) {
					observer?.unobserve(entry.element)
					release(entry)
					entries.delete(entry)
				}
		} finally {
			updating = false
		}
	}
	const observer =
		typeof ResizeObserver === `function`
			? new ResizeObserver((changes) => {
					if (dead || updating) return
					try {
						for (const change of changes) {
							const entry = [...entries].find(
								(candidate) => candidate.element === change.target,
							)
							if (
								!entry?.node ||
								entry.size ===
									`${entry.element.offsetWidth}:${entry.element.offsetHeight}`
							)
								continue
							const previous = entry.node.layout
							entry.node.willUpdate()
							if (previous) entry.node.snapshot = previous
						}
						commit()
					} catch (error) {
						report(error)
					}
				})
			: undefined
	const mediaChanged = () => {
		try {
			for (const entry of entries) if (entry.node) configure(entry)
		} catch (error) {
			report(error)
		}
	}
	preference?.addEventListener(`change`, mediaChanged)
	root._cleanups.add(() => {
		dead = true
		observer?.disconnect()
		preference?.removeEventListener(`change`, mediaChanged)
		const errors: unknown[] = []
		for (const entry of entries)
			try {
				release(entry)
			} catch (error) {
				errors.push(error)
			}
		entries.clear()
		if (errors.length) throw new AggregateError(errors)
	})
	return {
		beforeUpdate() {
			updating = true
			for (const entry of ordered()) {
				prepare(entry)
				entry.node!.willUpdate()
			}
			return commit
		},
		attach(element: HTMLElement, scope: Scope): CapabilityBinding {
			const entry: Entry = {
				element,
				scope,
				props: {},
				mounted: false,
				dead: false,
			}
			entries.add(entry)
			within(scope, () => {
				onMount(() => {
					entry.mounted = true
				})
			})
			return {
				update(props) {
					for (const key of Object.keys(props))
						if (!allowed.has(key))
							throw new Error(`spa/layout: unknown property layout:${key}`)
					entry.props = props
				},
				exit() {
					if (entry.node) entry.node.isPresent = false
					return undefined
				},
				resume() {
					if (entry.node) {
						entry.node.isPresent = true
						entry.node.promote()
					}
				},
				dispose() {
					entry.dead = true
					if (!updating) {
						observer?.unobserve(element)
						release(entry)
						entries.delete(entry)
					}
				},
			}
		},
	}
}

/** Optional DOM layout projection, with shared identities isolated by root and explicit group. */
export function layoutCapability(
	options: LayoutCapabilityOptions = {},
): Capability {
	const roots = new WeakMap<Root, ReturnType<typeof controller>>()
	const state = (root: Root) => {
		let current = roots.get(root)
		if (!current) {
			current = controller(root, options)
			roots.set(root, current)
		}
		return current
	}
	return {
		namespace: `layout`,
		beforeUpdate: (root) => state(root).beforeUpdate(),
		attach(target: CapabilityTarget, scope?: Scope) {
			const element = target.node as HTMLElement
			if (
				target.kind !== `dom` ||
				element?.namespaceURI !== `http://www.w3.org/1999/xhtml` ||
				!scope
			)
				throw new Error(`spa/layout: layout requires an owned HTML element`)
			return state(scope._root).attach(element, scope)
		},
	}
}
