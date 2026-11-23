import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import { motionCapability } from "@atom.io/spa/motion"
import { atom } from "atom.io"

const players = [`Ada`, `Grace`] as const
const readyPlayersAtom = atom<string[]>({ key: `readyPlayers`, default: [] })

function ReadinessGroup(props: { ready: boolean; match: string }): SpaElement {
	const getReadyPlayers = useGetter(readyPlayersAtom)
	const setReadyPlayers = useSetter(readyPlayersAtom)
	return (
		<fieldset
			motion:layout
			style={`width:${getReadyPlayers().length ? 260 : 180}px;max-width:100%;min-height:66px`}
		>
			<legend>{props.ready ? `Ready` : `Waiting`}</legend>
			<footer>
				{players
					.filter((player) => getReadyPlayers().includes(player) === props.ready)
					.map((player) => (
						<button
							key={player}
							motion:layout="position"
							motion:layoutId={player}
							motion:layoutGroup={props.match}
							motion:exit={{ opacity: 0 }}
							motion:transition={{ duration: 0.2 }}
							onClick={() => {
								setReadyPlayers((ready) =>
									ready.includes(player)
										? ready.filter((name) => name !== player)
										: [...ready, player],
								)
							}}
						>
							{player}
						</button>
					))}
			</footer>
		</fieldset>
	)
}

export default function ReadinessBoard(): SpaElement {
	return (
		<>
			<ReadinessGroup ready={false} match="match-1" />
			<ReadinessGroup ready={true} match="match-1" />
		</>
	)
}

ReadinessBoard.capabilities = [
	motionCapability({ layoutTransition: { duration: 0.3, ease: `easeInOut` } }),
]
