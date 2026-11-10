import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter } from "@atom.io/spa"
import type {} from "@atom.io/spa/layout"
import type {} from "@atom.io/spa/motion"
import { atom } from "atom.io"

const players = [`Ada`, `Grace`] as const
const readyPlayersAtom = atom<string[]>({ key: `readyPlayers`, default: [] })

function ReadinessGroup(props: { ready: boolean; match: string }): SpaElement {
	const getReadyPlayers = useGetter(readyPlayersAtom)
	const setReadyPlayers = useSetter(readyPlayersAtom)
	return (
		<section
			layout:animate
			style={`width:${getReadyPlayers().length ? 260 : 180}px;min-height:80px`}
		>
			<h2>{props.ready ? `Ready` : `Waiting`}</h2>
			{players
				.filter((player) => getReadyPlayers().includes(player) === props.ready)
				.map((player) => (
					<button
						key={player}
						layout:animate="position"
						layout:id={player}
						layout:group={props.match}
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
		</section>
	)
}

export function ReadinessBoard(): SpaElement {
	return (
		<>
			<ReadinessGroup ready={false} match="match-1" />
			<ReadinessGroup ready={true} match="match-1" />
		</>
	)
}
