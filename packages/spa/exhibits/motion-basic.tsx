import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

const targetXAtom = atom<number>({ key: `targetX`, default: 0 })

export default function MotionPanel(): SpaElement {
	const getTargetX = useGetter(targetXAtom)
	const setTargetX = useSetter(targetXAtom)
	return (
		<section>
			<button
				onClick={() => {
					setTargetX((x) => (x === 0 ? 56 : 0))
				}}
			>
				Move
			</button>
			<p style="margin-inline-end:56px" motion:animate={{ x: getTargetX() }}>
				An animated paragraph.
			</p>
		</section>
	)
}

MotionPanel.capabilities = [motionCapability()]
