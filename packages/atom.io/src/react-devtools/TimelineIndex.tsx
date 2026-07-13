import type {
	ReadonlyPureSelectorToken,
	RegularAtomToken,
	TimelineToken,
} from "atom.io"
import { redo, undo } from "atom.io"
import { findInStore, type Timeline } from "atom.io/internal"
import { useI, useO } from "atom.io/react"
import { type FC, Fragment, useContext } from "react"

import { button } from "./Button.tsx"
import { DevtoolsContext } from "./store.ts"
import { article } from "./Updates.tsx"

export const YouAreHere: FC = () => {
	return <span className="you_are_here">you are here</span>
}

export const TimelineLog: FC<{
	token: TimelineToken<any>
	isOpenState: RegularAtomToken<boolean>
	timelineState: ReadonlyPureSelectorToken<Timeline<any>>
}> = ({ token, isOpenState, timelineState }) => {
	const timeline = useO(timelineState)
	const isOpen = useO(isOpenState)
	const setIsOpen = useI(isOpenState)

	return (
		<section className="node timeline_log" data-testid={`timeline-${token.key}`}>
			<header>
				<button.OpenClose
					isOpen={isOpen}
					testid={`open-close-timeline-${token.key}`}
					setIsOpen={setIsOpen}
				/>
				<main>
					<h2>{token.key}</h2>
					<span className="detail length">
						({timeline.at}/{timeline.history.length})
					</span>
					<span className="gap" />
					<nav>
						<button
							type="button"
							onClick={() => {
								undo(token)
							}}
							disabled={timeline.at === 0}
						>
							undo
						</button>
						<button
							type="button"
							onClick={() => {
								redo(token)
							}}
							disabled={timeline.at === timeline.history.length}
						>
							redo
						</button>
					</nav>
				</main>
			</header>
			{isOpen ? (
				<main>
					{timeline.history.map((update, index) =>
						update.type !== `atom_creation` &&
						update.type !== `atom_disposal` ? (
							<Fragment key={update.token.key + index + timeline.at}>
								{index === timeline.at ? <YouAreHere /> : null}
								<article.TimelineUpdate
									timelineUpdate={update}
									serialNumber={index}
								/>
								{index === timeline.history.length - 1 &&
								timeline.at === timeline.history.length ? (
									<YouAreHere />
								) : null}
							</Fragment>
						) : null,
					)}
				</main>
			) : null}
		</section>
	)
}

export const TimelineIndex: FC = () => {
	const { timelineIndex, timelineSelectors, viewIsOpenAtoms, store } =
		useContext(DevtoolsContext)

	const tokenIds = useO(timelineIndex)
	const visibleTokens = tokenIds.filter((token) => !token.key.startsWith(`👁‍🗨`))
	const familyMembers = new Map<string, TimelineToken<any>[]>()
	const standalone: TimelineToken<any>[] = []
	for (const token of visibleTokens) {
		if (token.family) {
			const members = familyMembers.get(token.family.key) ?? []
			members.push(token)
			familyMembers.set(token.family.key, members)
		} else {
			standalone.push(token)
		}
	}
	const renderTimeline = (token: TimelineToken<any>) => (
		<TimelineLog
			key={token.key}
			token={token}
			isOpenState={findInStore(store, viewIsOpenAtoms, [token.key])}
			timelineState={findInStore(store, timelineSelectors, token.key)}
		/>
	)

	return (
		<article className="index timeline_index" data-testid="timeline-index">
			{visibleTokens.length === 0 ? (
				<p className="index-empty-state">(no timelines)</p>
			) : (
				<>
					{standalone.map(renderTimeline)}
					{[...familyMembers].map(([familyKey, members]) => (
						<section
							className="timeline_family"
							data-testid={`timeline-family-${familyKey}`}
							key={familyKey}
						>
							<h2>{familyKey}</h2>
							{members.map(renderTimeline)}
						</section>
					))}
				</>
			)}
		</article>
	)
}
