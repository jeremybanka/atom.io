import { animate, type MotionValue, motionValue } from "motion"

import type {
	FamilyConnection,
	GraphItem,
	GraphPosition,
} from "./ecology-graph.ts"
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
	goal: number
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
	historySpines(): FamilyConnection[]
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
		const { item } = member
		if (!item.history) {
			const amount = member.value.get(),
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
		}
		invalidate()
	}
	const target = (member: MemberMotion, goal: number, immediate = false) => {
		if (immediate) {
			member.goal = goal
			member.value.jump(goal)
			return
		}
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
	// History springs animate a vertical offset relative to the timeline, even while the timeline itself is moving.
	const historyAnchor = (item: GraphItem) =>
		members.get(item.familyId!)?.point ?? item.cluster!
	const historyPoint = (member: MemberMotion, anchor: GraphPosition) => ({
		x: anchor.x,
		y: anchor.y + member.value.get(),
		z: anchor.z,
	})
	const position = (id: string): GraphPosition | undefined => {
		const member = members.get(id)
		return member?.item.history
			? historyPoint(member, historyAnchor(member.item))
			: member?.point
	}
	const point = (item: GraphPosition) =>
		`id` in item ? (position(String(item.id)) ?? item) : item
	const port = (endpoint: GraphPosition, card: GraphPosition | undefined) => {
		const member =
			`id` in endpoint ? members.get(String(endpoint.id)) : undefined
		return member?.retiring && member.value.get() > 0
			? member.point
			: point(card ?? endpoint)
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
				const group = member.item.familyId!
				if (item?.cluster) {
					member.item = item
					member.retiring = false
					target(member, item.history ? item.y - item.cluster.y : 1, fresh)
					updatePoint(member)
				} else if (
					!fresh &&
					(!expanded.has(group) ||
						(member.item.history &&
							(incoming.has(group) || members.get(group)?.retiring)))
				) {
					member.retiring = true
					target(member, 0)
				} else release(id)
			}
			for (const item of items) {
				if (!item.cluster || members.has(item.id)) continue
				const entering =
					!fresh &&
					!preference.matches &&
					(item.history !== undefined || !previousExpanded.has(item.familyId!))
				const destination = item.history ? item.y - item.cluster.y : 1
				const initial = entering ? 0 : destination
				const value = motionValue(initial)
				const member: MemberMotion = {
					item,
					value,
					point: item,
					goal: initial,
					entering,
					retiring: false,
				}
				members.set(item.id, member)
				value.on(`change`, () => {
					updatePoint(member)
				})
				updatePoint(member)
				target(member, destination)
			}
			previousExpanded = new Set(expanded)
			generation = nextGeneration
		},
		entering: (id: string) => members.get(id)?.entering ?? false,
		exiting: (id: string) =>
			!preference.matches && (members.get(id)?.retiring ?? false),
		position,
		get active() {
			return [...members.values()].some(
				(member) => member.value.get() !== member.goal,
			)
		},
		point,
		historySpines() {
			const spans = new Map<string, FamilyConnection>()
			for (const member of members.values()) {
				const { item } = member
				if (!item.history) continue
				const family = item.familyId!
				const anchor = historyAnchor(item)
				let span = spans.get(family)
				if (!span) {
					span = { family, from: anchor, to: anchor, color: item.color }
					spans.set(family, span)
				}
				const event = historyPoint(member, anchor)
				if (event.y < span.from.y) span.from = event
				if (event.y > span.to.y) span.to = event
			}
			return [...spans.values()].filter(({ from, to }) => from !== to)
		},
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
