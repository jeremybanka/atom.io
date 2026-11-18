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
