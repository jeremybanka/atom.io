import type { SpaElement } from "@atom.io/spa"
import { useGetter, useSetter, useTimeline } from "@atom.io/spa"
import type {
	ReadableToken,
	TimelineToken,
	TransactionToken,
	WritableToken,
} from "atom.io"
import {
	disposeFromStore,
	findInStore,
	isReservedIntrospectionKey,
} from "atom.io/internal"
import type { FamilyNode } from "atom.io/introspection"

import { JsonEditor } from "./JsonEditor.tsx"
import type { Tools } from "./store.ts"
import { useExpanded } from "./store.ts"
import { describe } from "./value.ts"

type Token = ReadableToken<unknown, any, any>
export function StateIndex(props: {
	tools: Tools
	type: `atoms` | `selectors`
}): SpaElement {
	const getStateIndex = useGetter<Map<string, Token | FamilyNode<Token>>>(
		props.type === `atoms` ? props.tools.atomIndex : props.tools.selectorIndex,
	)
	return (
		<article class="index" data-testid="state-index">
			{getStateIndex().size === 0 ? (
				<p>(no {props.type})</p>
			) : (
				[...getStateIndex().values()].map((node) => (
					<StateNode key={node.key} tools={props.tools} node={node} />
				))
			)}
		</article>
	)
}
function StateNode(props: {
	tools: Tools
	node: Token | FamilyNode<Token>
}): SpaElement {
	const [getOpen, toggle] = useExpanded(props.tools, [props.node.key])
	return (
		<section class="node" data-testid={`state-${props.node.key}`}>
			{`familyMembers` in props.node ? (
				<>
					<header>
						<button
							type="button"
							aria-expanded={getOpen()}
							data-testid={`open-close-state-family-${props.node.key}`}
							onClick={toggle}
						>
							{getOpen() ? `▾` : `▸`}
						</button>
						<h2 title={props.node.key}>{props.node.key}</h2>
						<small>family</small>
					</header>
					{getOpen()
						? [...props.node.familyMembers.values()].map((token) => (
								<StateLeaf key={token.key} tools={props.tools} token={token} />
							))
						: null}
				</>
			) : (
				<StateLeaf tools={props.tools} token={props.node} />
			)}
		</section>
	)
}
export function StateLeaf(props: { tools: Tools; token: Token }): SpaElement {
	const getValue = useGetter(props.token)
	const writable = !props.token.type.startsWith(`readonly`)
	const setValue = writable
		? useSetter(props.token as WritableToken<unknown, any, any>)
		: undefined
	const value = () => {
		try {
			return getValue()
		} catch (error) {
			return error
		}
	}
	return (
		<section class="state-leaf" data-testid={`state-value-${props.token.key}`}>
			<JsonEditor
				label={
					<h3 title={props.token.key}>
						{props.token.family?.subKey ?? props.token.key}
					</h3>
				}
				actions={
					props.token.family ? (
						<button
							type="button"
							aria-label={`Dispose ${props.token.key}`}
							onClick={() => {
								props.tools.attempt(() => {
									disposeFromStore(props.tools.store, props.token)
								})
							}}
						>
							×
						</button>
					) : null
				}
				tools={props.tools}
				value={value()}
				change={
					setValue
						? (update) => {
								// Validate edits before opening an atom.io write operation.
								const next = update(getValue())
								setValue(() => next)
							}
						: undefined
				}
				path={
					props.token.family
						? [props.token.family.key, props.token.family.subKey]
						: [props.token.key]
				}
			/>
		</section>
	)
}
export function TransactionIndex(props: { tools: Tools }): SpaElement {
	const getTransactionIndex = useGetter(props.tools.transactionIndex)
	const visible = () =>
		getTransactionIndex().filter(
			(token) => !isReservedIntrospectionKey(token.key),
		)
	return (
		<article class="index" data-testid="transaction-index">
			{visible().length === 0 ? (
				<p>(no transactions)</p>
			) : (
				visible().map((token) => (
					<TransactionLog key={token.key} tools={props.tools} token={token} />
				))
			)}
		</article>
	)
}
function TransactionLog(props: {
	tools: Tools
	token: TransactionToken<any>
}): SpaElement {
	const getTransactionLog = useGetter(
		findInStore(
			props.tools.store,
			props.tools.transactionLogSelectors,
			props.token.key,
		),
	)
	const [getOpen, toggle] = useExpanded(props.tools, [props.token.key])
	return (
		<section class="node" data-testid={`transaction-${props.token.key}`}>
			<header>
				<button
					type="button"
					aria-expanded={getOpen()}
					data-testid={`open-close-transaction-${props.token.key}`}
					onClick={toggle}
				>
					{getOpen() ? `▾` : `▸`}
				</button>
				<h2 title={props.token.key}>{props.token.key}</h2>
				<small>transaction</small>
				<small class="count">({getTransactionLog().length})</small>
			</header>
			{getOpen() ? (
				<section class="transaction-outcomes">
					{getTransactionLog().map((event, index) => (
						<EventView
							key={index}
							tools={props.tools}
							event={event}
							index={index}
						/>
					))}
				</section>
			) : null}
		</section>
	)
}
// Events are recursive discriminated records, including user-defined transaction outputs.
/** @internal Used by contributor tools or implementation tests. */
export function EventView(props: {
	tools: Tools
	event: any
	index: number
}): SpaElement {
	const [getOpen, toggle] = useExpanded(
		props.tools,
		[`event`, props.event.token?.key ?? ``, String(props.index)],
		true,
	)
	return (
		<section
			class="event"
			data-testid={`${props.event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${props.event.token?.key}-${props.index}`}
		>
			<header>
				<button type="button" aria-expanded={getOpen()} onClick={toggle}>
					{getOpen() ? `▾` : `▸`}
				</button>
				<strong>{props.event.token?.key}</strong>
				<small>{props.event.type}</small>
			</header>
			{getOpen() ? (
				props.event.type === `transaction_outcome` ? (
					<>
						<p>
							params: <code>{describe(props.event.params)}</code>
						</p>
						<p>
							output: <code>{describe(props.event.output)}</code>
						</p>
						<section class="impact">
							{props.event.subEvents.map((event: any, index: number) => (
								<EventView
									key={index}
									tools={props.tools}
									event={event}
									index={index}
								/>
							))}
						</section>
					</>
				) : props.event.update ? (
					<p>
						<del data-kind={typeof props.event.update.oldValue}>
							{describe(props.event.update.oldValue)}
						</del>
						{` `}→{` `}
						<ins data-kind={typeof props.event.update.newValue}>
							{describe(props.event.update.newValue)}
						</ins>
					</p>
				) : (
					<code>{describe(props.event)}</code>
				)
			) : null}
		</section>
	)
}
export function TimelineIndex(props: { tools: Tools }): SpaElement {
	const getTimelineIndex = useGetter(props.tools.timelineIndex)
	const groups = () => {
		const result = new Map<string, TimelineToken<any>[]>()
		for (const token of getTimelineIndex()) {
			if (isReservedIntrospectionKey(token.key) || token.key.startsWith(`👁‍🗨`))
				continue
			const key = token.family?.key ?? ``
			const members = result.get(key) ?? []
			members.push(token)
			result.set(key, members)
		}
		return [...result]
	}
	return (
		<article class="index" data-testid="timeline-index">
			{groups().length === 0 ? (
				<p>(no timelines)</p>
			) : (
				groups().map(([family, members]) => (
					<section
						key={family}
						data-testid={family ? `timeline-family-${family}` : undefined}
					>
						{family ? <h2>{family}</h2> : null}
						{members.map((token) => (
							<TimelineLog key={token.key} tools={props.tools} token={token} />
						))}
					</section>
				))
			)}
		</article>
	)
}
function TimelineLog(props: {
	tools: Tools
	token: TimelineToken<any>
}): SpaElement {
	const controls = useTimeline(props.token)
	const getTimeline = useGetter(
		findInStore(
			props.tools.store,
			props.tools.timelineSelectors,
			props.token.key,
		),
	)
	const [getOpen, toggle] = useExpanded(props.tools, [props.token.key])
	return (
		<section class="node" data-testid={`timeline-${props.token.key}`}>
			<header>
				<button
					type="button"
					aria-expanded={getOpen()}
					data-testid={`open-close-timeline-${props.token.key}`}
					onClick={toggle}
				>
					{getOpen() ? `▾` : `▸`}
				</button>
				<h2>{props.token.family?.subKey ?? props.token.key}</h2>
				<small>
					({controls.getCursor()}/{controls.getLength()})
				</small>
				<button
					type="button"
					disabled={controls.getCursor() === 0}
					onClick={() => {
						props.tools.attempt(controls.undo)
					}}
				>
					undo
				</button>
				<button
					type="button"
					disabled={controls.getCursor() === controls.getLength()}
					onClick={() => {
						props.tools.attempt(controls.redo)
					}}
				>
					redo
				</button>
			</header>
			{getOpen() ? (
				<section>
					{getTimeline().history.map((event, index) => (
						<section key={index}>
							{index === getTimeline().at ? (
								<p class="you-are-here">you are here</p>
							) : null}
							<EventView tools={props.tools} event={event} index={index} />
						</section>
					))}
					{getTimeline().at === getTimeline().history.length ? (
						<p class="you-are-here">you are here</p>
					) : null}
				</section>
			) : null}
		</section>
	)
}
