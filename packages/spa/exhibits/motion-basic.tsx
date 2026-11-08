import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const targetXAtom = atom<number>({ key: `targetX`, default: 0 })

export function MotionPanel(): SpaElement {
	const getTargetX = useGetter(targetXAtom)
	const setTargetX = useSetter(targetXAtom)
	return (
		<section>
			<button
				onClick={() => {
					setTargetX((x) => (x === 0 ? 200 : 0))
				}}
			>
				Move
			</button>
			<p motion:animate={{ x: getTargetX() }}>An animated paragraph.</p>
		</section>
	)
}
