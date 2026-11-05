import type { VNode } from "@atom.io/spa"
import { useGetter, useRef, useSetter, useTimeline } from "@atom.io/spa"
import { atomFamily, scopeFamily, timelineFamily } from "atom.io"

const countAtoms = atomFamily<number, string>({ key: `count`, default: 0 })
const buttonAtoms = atomFamily<HTMLButtonElement | null, string>({
	key: `button`,
	default: null,
})
const historyTimelines = timelineFamily<string>({
	key: `history`,
	scope: [scopeFamily(countAtoms, { timelineKey: (id) => id })],
})

export function FamilyCounter(props: { id: string }): VNode {
	const getCount = useGetter(countAtoms, props.id)
	const setCount = useSetter(countAtoms, props.id)
	const ref = useRef(buttonAtoms, props.id)
	const history = useTimeline(historyTimelines, props.id)
	return (
		<section>
			<button
				ref={ref}
				onClick={() => {
					setCount((value) => value + 1)
				}}
			>
				{getCount()}
			</button>
			<button disabled={history.getCursor() === 0} onClick={history.undo}>
				Undo
			</button>
		</section>
	)
}
