import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

const replayAtom = atom<number>({ key: `replay`, default: 0 })

export default function TurnBanner(): SpaElement {
	const getReplay = useGetter(replayAtom)
	const setReplay = useSetter(replayAtom)
	return (
		<section>
			<button onClick={() => setReplay((run) => run + 1)}>Replay banner</button>
			<div style="overflow:clip; min-height:36px">
				<aside
					key={getReplay()}
					style="box-sizing:border-box; white-space:nowrap"
					motion:animate={{
						x: [`-1500%`, `2%`, `4%`, `0%`],
						skewX: [`-50deg`, `-5deg`, `-5deg`, `0deg`],
						width: [`20%`, `88%`, `88%`, `100%`],
						opacity: [0, 1, 1, 1],
					}}
					motion:transition={{
						duration: 3,
						times: [0, 0.1, 0.77, 1],
						ease: [`circOut`, `linear`, `easeIn`],
						properties: { opacity: { times: [0, 0.2, 0.8, 1], ease: `linear` } },
					}}
				>
					Next turn
				</aside>
			</div>
		</section>
	)
}

TurnBanner.capabilities = [motionCapability()]
