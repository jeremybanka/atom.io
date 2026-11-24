import { animate, type MotionValue, motionValue } from "motion"

import type { GraphItem, GraphPosition } from "./ecology-graph.ts"
import type { EcologyLine } from "./ecology-lines.ts"

export const FAMILY_SPRING = {
	type: `spring`,
	stiffness: 320,
	damping: 28,
} as const
export const EDITOR_SPRING = {
	type: `spring`,
	stiffness: 420,
	damping: 38,
} as const

export function animateEcologyEditorHeight(
	editor: HTMLElement,
	content: HTMLElement,
): () => void {
	const body = editor.parentElement!
	const window = editor.ownerDocument.defaultView!
	const preference = window.matchMedia(`(prefers-reduced-motion: reduce)`)
	const height = motionValue(0)
	const property = `--ecology-editor-height`
	const write = (pixels: number) => {
		editor.style.setProperty(property, `${pixels}px`)
	}
	const release = height.on(`change`, write)
	let target: number | undefined
	const sync = (animateChange: boolean) => {
		const pinned = editor.style.getPropertyValue(property)
		// Measure the natural split with the current flex limits before the next paint.
		editor.style.removeProperty(property)
		const previous = target
		target =
			body.clientHeight > 0 && window.getComputedStyle(body).display === `flex`
				? editor.getBoundingClientRect().height
				: undefined
		if (
			!animateChange ||
			preference.matches ||
			previous === undefined ||
			target === undefined
		) {
			height.stop()
			return
		}
		if (target === previous) {
			if (pinned) editor.style.setProperty(property, pinned)
			return
		}
		if (!pinned) height.jump(previous)
		write(height.get())
		animate(height, target, {
			...EDITOR_SPRING,
			onComplete() {
				editor.style.removeProperty(property)
			},
		})
	}
	const reset = () => {
		sync(false)
	}
	const observer = new window.ResizeObserver((entries) => {
		sync(!entries.some((entry) => entry.target === body))
	})
	observer.observe(body)
	observer.observe(content)
	preference.addEventListener(`change`, reset)
	reset()
	return () => {
		observer.disconnect()
		preference.removeEventListener(`change`, reset)
		release()
		height.destroy()
		editor.style.removeProperty(property)
	}
}

interface EdgeHeading {
	goal: number
	value?: MotionValue<number>
}
export interface EdgeRoutingMotion {
	angle(id: string): number | undefined
	steer(id: string, direction: number): number
	sync(edges: readonly EcologyLine[]): void
	dispose(): void
}

/** Spring only the solver's choice of port, in quarter turns around the card. */
export function createEdgeRoutingMotion(
	invalidate: () => void,
	preference: MediaQueryList,
): EdgeRoutingMotion {
	const headings = new Map<string, EdgeHeading>()
	const reduce = () => {
		if (preference.matches)
			for (const heading of headings.values()) heading.value?.jump(heading.goal)
	}
	preference.addEventListener(`change`, reduce)
	return {
		angle(id: string): number | undefined {
			const heading = headings.get(id)
			return heading?.value?.get() ?? heading?.goal
		},
		steer(id: string, direction: number): number {
			const heading = headings.get(id)
			if (!heading) {
				headings.set(id, { goal: direction })
				return direction
			}
			const current = heading.value?.get() ?? heading.goal
			if ((heading.goal - direction) % 4 === 0) return current
			if (preference.matches) {
				heading.goal = direction
				heading.value?.jump(direction)
				return direction
			}
			// Choose the nearest equivalent heading, preserving progress on reversal.
			heading.goal = direction + 4 * Math.round((current - direction) / 4)
			if (!heading.value) {
				heading.value = motionValue(current)
				heading.value.on(`change`, invalidate)
			}
			animate(heading.value, heading.goal, {
				type: `spring`,
				stiffness: 430,
				damping: 42,
			})
			return current
		},
		sync(edges: readonly EcologyLine[]): void {
			const retained = new Set(edges.map((edge) => edge.id))
			for (const [id, heading] of headings) {
				if (retained.has(id)) continue
				heading.value?.destroy()
				headings.delete(id)
			}
		},
		dispose(): void {
			preference.removeEventListener(`change`, reduce)
			for (const heading of headings.values()) heading.value?.destroy()
			headings.clear()
		},
	}
}

interface MemberMotion {
	item: GraphItem
	value: MotionValue<number>
	point: GraphPosition
	goal: 0 | 1
	entering: boolean
	retiring: boolean
}
interface EcologyMotion {
	sync(
		items: readonly GraphItem[],
		expanded: ReadonlySet<string>,
		generation: number,
	): void
	entering(id: string): boolean
	exiting(id: string): boolean
	position(id: string): GraphPosition | undefined
	readonly active: boolean
	point(position: GraphPosition): GraphPosition
	edge(edge: EcologyLine): EcologyLine
	release(id: string): void
	dispose(): void
}

/** World-space spring progress shares Motion's frame clock with SPA's renderer. */
export function createEcologyMotion(
	invalidate: () => void,
	view: Pick<Window, `matchMedia`>,
): EcologyMotion {
	const preference = view.matchMedia(`(prefers-reduced-motion: reduce)`)
	const members = new Map<string, MemberMotion>()
	let previousExpanded = new Set<string>(),
		generation: number | undefined
	const updatePoint = (member: MemberMotion) => {
		const amount = member.value.get(),
			item = member.item,
			cluster = item.cluster!
		member.point =
			amount === 1
				? item
				: amount === 0
					? cluster
					: {
							x: cluster.x + (item.x - cluster.x) * amount,
							y: cluster.y + (item.y - cluster.y) * amount,
							z: cluster.z + (item.z - cluster.z) * amount,
						}
		invalidate()
	}
	const target = (member: MemberMotion, goal: 0 | 1) => {
		if (member.goal === goal) return
		member.goal = goal
		if (preference.matches) member.value.jump(goal)
		else animate(member.value, goal, FAMILY_SPRING)
	}
	const release = (id: string) => {
		members.get(id)?.value.destroy()
		members.delete(id)
	}
	const reduce = () => {
		if (preference.matches)
			for (const member of members.values()) member.value.jump(member.goal)
	}
	preference.addEventListener(`change`, reduce)
	const point = (position: GraphPosition) =>
		`id` in position
			? (members.get(String(position.id))?.point ?? position)
			: position
	const port = (position: GraphPosition, card: GraphPosition | undefined) => {
		const member =
			`id` in position ? members.get(String(position.id)) : undefined
		return member?.retiring && member.value.get() > 0
			? member.point
			: point(card ?? position)
	}
	return {
		sync(
			items: readonly GraphItem[],
			expanded: ReadonlySet<string>,
			nextGeneration: number,
		) {
			const fresh = generation !== nextGeneration
			const incoming = new Map(items.map((item) => [item.id, item]))
			for (const [id, member] of members) {
				const item = incoming.get(id)
				if (item?.cluster) {
					member.item = item
					member.retiring = false
					target(member, 1)
					if (fresh) member.value.jump(1)
					updatePoint(member)
				} else if (!fresh && !expanded.has(member.item.familyLabel!)) {
					member.retiring = true
					target(member, 0)
				} else release(id)
			}
			for (const item of items) {
				if (!item.cluster || members.has(item.id)) continue
				const entering =
					!fresh &&
					!preference.matches &&
					!previousExpanded.has(item.familyLabel!)
				const value = motionValue(entering ? 0 : 1)
				const member: MemberMotion = {
					item,
					value,
					point: item,
					goal: entering ? 0 : 1,
					entering,
					retiring: false,
				}
				members.set(item.id, member)
				value.on(`change`, () => {
					updatePoint(member)
				})
				updatePoint(member)
				target(member, 1)
			}
			previousExpanded = new Set(expanded)
			generation = nextGeneration
		},
		entering: (id: string) => members.get(id)?.entering ?? false,
		exiting: (id: string) =>
			!preference.matches && (members.get(id)?.retiring ?? false),
		position: (id: string) => members.get(id)?.point,
		get active() {
			return [...members.values()].some(
				(member) => member.value.get() !== member.goal,
			)
		},
		point,
		edge(edge: EcologyLine): EcologyLine {
			return {
				...edge,
				from: point(edge.from),
				to: point(edge.to),
				fromCard: port(edge.from, edge.fromCard),
				toCard: port(edge.to, edge.toCard),
				origin: point(edge.fromCard ?? edge.from),
			}
		},
		release,
		dispose() {
			preference.removeEventListener(`change`, reduce)
			for (const id of members.keys()) release(id)
		},
	}
}
