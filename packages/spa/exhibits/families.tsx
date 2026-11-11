import type { SpaElement } from "@atom.io/spa"
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

function FamilyCounter(props: { key: string }): SpaElement {
	const getCount = useGetter(countAtoms, props.key)
	const setCount = useSetter(countAtoms, props.key)
	const ref = useRef(buttonAtoms, props.key)
	const history = useTimeline(historyTimelines, props.key)
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

export function Counters(props: { ids: readonly string[] }): SpaElement {
	return (
		<section>
			{props.ids.map((id) => (
				<FamilyCounter key={id} />
			))}
		</section>
	)
}
