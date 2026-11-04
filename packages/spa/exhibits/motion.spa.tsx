import type { VNode } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { atom } from "atom.io"

const targetXAtom = atom<number>({ key: `targetX`, default: 0 })
export function MotionPanel(): VNode {
	const x = useGetter(targetXAtom)
	const setX = useSetter(targetXAtom)
	return (
		<section>
			<button
				onClick={() => {
					setX((value) => (value === 0 ? 200 : 0))
				}}
			>
				Move
			</button>
			<sliding-panel
				style="display: block; width: 120px; padding: 16px; background: coral"
				motion:initial={{ opacity: 0, x: -100 }}
				motion:animate={{ opacity: 1, x: x() }}
				motion:transition={{ type: `spring`, stiffness: 180, damping: 22 }}
				motion:whileHover={{ scale: 1.05 }}
				motion:whileTap={{ scale: 0.95 }}
			>
				Motion, with your own markup.
			</sliding-panel>
		</section>
	)
}
