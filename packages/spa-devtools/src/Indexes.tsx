/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import {
	onCleanup,
	onMount,
	render,
	useGetter,
	useSetter,
	useTimeline,
} from "@atom.io/spa"
import type {
	ReadableToken,
	TimelineToken,
	TransactionToken,
	WritableToken,
} from "atom.io"
import {
	deposit,
	disposeFromStore,
	findInStore,
	isReservedIntrospectionKey,
} from "atom.io/internal"
import type { FamilyNode } from "atom.io/introspection"

import {
	historyEventPreview,
	historyIdentity,
	historyParams,
	historyValue,
	type RecordedEvent,
} from "./history-search.ts"
import { JsonEditor } from "./JsonEditor.tsx"
import type { SearchContext } from "./search-controller.ts"
import { createStateSearch } from "./search-controller.ts"
import type { Tools } from "./store.ts"
import { useExpanded } from "./store.ts"

type Token = ReadableToken<unknown, any, any>
export function StateIndex(props: {
	tools: Tools
	type: `atoms` | `selectors`
	context: SearchContext
}): SpaElement {
	const getStateIndex = useGetter<Map<string, Token | FamilyNode<Token>>>(
		props.type === `atoms` ? props.tools.atomIndex : props.tools.selectorIndex,
	)
	let host: HTMLElement | null = null
	onMount(() => {
		// Each view entry takes a new committed-root copy; only query text survives a remount.
		delete props.context.index
		onCleanup(
			createStateSearch(
				host!,
				props.tools.store,
				props.type,
				props.context,
				(key, target) => {
					const store = props.tools.store
					const state =
						store.atoms.get(key) ??
						store.readonlySelectors.get(key) ??
						store.writableSelectors.get(key)
					if (!state) {
						target.textContent = `State disposed. Refresh to update the snapshot.`
						return () => {}
					}
					return render(
						() => <StateLeaf tools={props.tools} token={deposit(state)} />,
						target,
						{ store },
					).dispose
				},
			),
		)
	})
	return (
		<section
			class="state-search"
			ref={(element) => {
				host = element
			}}
		>
			<article class="index" data-testid="state-index">
				{getStateIndex().size === 0 ? (
					<p>(no {props.type})</p>
				) : (
					[...getStateIndex().values()].map((node) => (
						<StateNode key={node.key} tools={props.tools} node={node} />
					))
				)}
			</article>
		</section>
	)
}
function StateNode(props: {
	tools: Tools
	node: Token | FamilyNode<Token>
}): SpaElement {
	const [getOpen, toggle] = useExpanded(props.tools, [props.node.key])
	return (
		<section
			class="node"
			data-state-key={props.node.key}
			data-testid={`state-${props.node.key}`}
		>
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
		<section
			class="state-leaf"
			data-state-key={props.token.key}
			data-testid={`state-value-${props.token.key}`}
		>
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
function useHistorySearch(
	type: `transactions` | `timelines`,
	props: { tools: Tools; context: SearchContext },
) {
	let host: HTMLElement | null = null
	onMount(() => {
		delete props.context.index
		onCleanup(createStateSearch(host!, props.tools.store, type, props.context))
	})
	return (element: HTMLElement) => {
		host = element
	}
}
export function TransactionIndex(props: {
	tools: Tools
	context: SearchContext
}): SpaElement {
	const attach = useHistorySearch(`transactions`, props)
	const getTransactionIndex = useGetter(props.tools.transactionIndex)
	const visible = () =>
		getTransactionIndex().filter(
			(token) => !isReservedIntrospectionKey(token.key),
		)
	return (
		<section class="state-search" ref={attach}>
			<article class="index" data-testid="transaction-index">
				{visible().length === 0 ? (
					<p>(no transactions)</p>
				) : (
					visible().map((token) => (
						<TransactionLog key={token.key} tools={props.tools} token={token} />
					))
				)}
			</article>
		</section>
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
		<section
			class="node"
			data-history-owner={historyIdentity(
				props.tools.store.transactions.get(props.token.key)!,
			)}
			data-testid={`transaction-${props.token.key}`}
		>
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
							key={historyIdentity(event)}
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
/** @internal Recorded event previews never traverse application-owned payloads. */
export function EventView(props: {
	tools: Tools
	event: RecordedEvent
	index: number
	depth?: number
}): SpaElement {
	const event = props.event
	const token = `token` in event ? event.token : undefined
	const depth = props.depth ?? 0
	const descendants = `subEvents` in event ? event.subEvents : []
	const [getOpen, toggle] = useExpanded(
		props.tools,
		[`event`, historyIdentity(event)],
		true,
	)
	const nested = () =>
		depth < 31
			? descendants.map((child, index) => (
					<EventView
						key={historyIdentity(child)}
						tools={props.tools}
						event={child}
						index={index}
						depth={depth + 1}
					/>
				))
			: `Nested events omitted`
	return (
		<section
			class="event"
			data-history-event={historyIdentity(event)}
			data-testid={`${event.type === `transaction_outcome` ? `transaction` : `timeline`}-update-${token?.key}-${props.index}`}
		>
			<header>
				<button type="button" aria-expanded={getOpen()} onClick={toggle}>
					{getOpen() ? `▾` : `▸`}
				</button>
				<strong>{token?.key}</strong>
				<small>{event.type}</small>
			</header>
			{getOpen() ? (
				event.type === `transaction_outcome` ? (
					<>
						<p>
							params: <code>{historyParams(event.params)}</code>
						</p>
						<p>
							output: <code>{historyValue(event.output) ?? `[opaque]`}</code>
						</p>
						<section class="impact">{nested()}</section>
					</>
				) : `update` in event ? (
					<p>
						<del data-kind={typeof event.update.oldValue}>
							{historyValue(event.update.oldValue) ?? `[opaque]`}
						</del>
						{` `}→{` `}
						<ins data-kind={typeof event.update.newValue}>
							{historyValue(event.update.newValue) ?? `[opaque]`}
						</ins>
					</p>
				) : descendants.length ? (
					<section class="impact">{nested()}</section>
				) : (
					<code>{historyEventPreview(event)}</code>
				)
			) : null}
		</section>
	)
}
export function TimelineIndex(props: {
	tools: Tools
	context: SearchContext
}): SpaElement {
	const attach = useHistorySearch(`timelines`, props)
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
		<section class="state-search" ref={attach}>
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
		</section>
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
		<section
			class="node"
			data-history-owner={historyIdentity(
				props.tools.store.timelines.get(props.token.key)!,
			)}
			data-testid={`timeline-${props.token.key}`}
		>
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
							<EventView
								key={historyIdentity(event)}
								tools={props.tools}
								event={event}
								index={index}
							/>
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
