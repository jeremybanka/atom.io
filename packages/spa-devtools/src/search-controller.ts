import type { RootStore } from "atom.io/internal"

import { scheduleGraph } from "./ecology-graph.ts"
import { captureHistorySearch, historyTargetExists } from "./history-search.ts"
import type {
	SearchHit,
	SearchIndex,
	SearchResults,
	SearchView,
} from "./search.ts"
import {
	captureStateSearch,
	indexStateSearch,
	matchStateSearch,
} from "./search.ts"
import { isSearchShortcut, moveSearchFocus } from "./search-keys.ts"
import { createSearchSession, editorIsCurrent } from "./search-session.ts"
import type { SearchPresentation } from "./SearchView.tsx"

export interface SearchContext {
	query: string
	index?: SearchIndex
}
export const createSearchContext = (): SearchContext => ({ query: `` })

/** Scheduling, focus and live-row navigation for the SPA-owned search surface. */
export function createStateSearch(
	host: HTMLElement,
	store: RootStore,
	view: SearchView,
	context: SearchContext,
	update: (patch: Partial<SearchPresentation>) => void,
): { dispose(): void; committed(): void } {
	const history =
		view === `transactions` || view === `timelines` ? view : undefined
	const doc = host.ownerDocument,
		win = doc.defaultView!
	const panel = host.closest<HTMLElement>(`debugger-panel, main`)!
	const index = host.querySelector<HTMLElement>(`[data-index]`)!
	const ui = host.querySelector<HTMLElement>(`search-controls`)!
	const input = ui.querySelector(`input`)!
	const results = ui.querySelector<HTMLOListElement>(`search-results`)!
	const live = host.querySelector<HTMLElement>(`search-live-editor`)!
	const clear = () => {
		input.value = ``
		query()
		input.focus()
	}
	ui.querySelector<HTMLButtonElement>(`[data-action="clear"]`)!.onclick = clear
	ui.querySelector<HTMLButtonElement>(`[data-action="refresh"]`)!.onclick =
		capture
	input.value = context.query
	let pendingHistory: SearchHit | undefined
	let selectedHistory: HTMLElement | undefined
	let liveKey: string | undefined
	let result: SearchResults | undefined
	let cancelIndex = () => {}
	let cancelMatch = () => {}
	let preparing = false
	let wait = () => {}
	let disposed = false,
		busy = false
	let origin: HTMLElement | null = null
	const visible = () =>
		!disposed && !panel.hidden && panel.dataset[`open`] !== `false`
	const session = createSearchSession(panel, ui, mask, (editor) =>
		editorIsCurrent(store, editor),
	)

	function revealHistory() {
		if (!pendingHistory || !history || !visible()) return
		const target = pendingHistory.document.target!
		if (!historyTargetExists(store, history, target)) {
			update({
				detail: `Recorded event is no longer at its captured location. Refresh to update the snapshot.`,
			})
			pendingHistory = undefined
			return
		}
		const owner = index.querySelector<HTMLElement>(
			`[data-history-owner="${target.owner}"]`,
		)
		if (!owner) return
		let destination = owner
		for (const id of target.chain) {
			const next = destination.querySelector<HTMLElement>(
				`[data-history-event="${id}"]`,
			)
			if (!next) {
				destination
					.querySelector<HTMLButtonElement>(
						`:scope > :is(node-heading,event-heading) button[aria-expanded="false"]`,
					)
					?.click()
				return
			}
			destination = next
		}
		selectedHistory?.removeAttribute(`data-search-selected`)
		selectedHistory = destination
		destination.dataset[`searchSelected`] = `true`
		destination.tabIndex = -1
		destination.focus()
		destination.scrollIntoView?.({ block: `nearest` })
		pendingHistory = undefined
	}
	function mask() {
		if (history) {
			update({
				retained: Boolean(context.query.trim()) && result?.matching === 0,
			})
			revealHistory()
			return
		}

		const active = Boolean(context.query.trim())
		const keys = new Set(result?.hits.map((hit) => hit.document.key))
		const families = new Set(result?.hits.map((hit) => hit.document.family))
		const pinned = session.pinned()
		update({ pinned: Boolean(pinned) })
		for (const node of index.querySelectorAll<HTMLElement>(
			`:is(state-node,transaction-log,timeline-log)`,
		)) {
			node.hidden =
				active &&
				!keys.has(node.dataset[`stateKey`]!) &&
				!families.has(node.dataset[`stateKey`]!) &&
				!node.contains(pinned)
		}
		for (const leaf of index.querySelectorAll<HTMLElement>(`state-leaf`)) {
			leaf.hidden =
				active && !keys.has(leaf.dataset[`stateKey`]!) && leaf !== pinned
		}
	}
	function select(hit: SearchHit) {
		if (busy) return
		if (history) {
			update({ detail: `Recorded preview only; no history cursor changed.` })
			pendingHistory = hit
			revealHistory()
			return
		}
		const existing = [...host.querySelectorAll<HTMLElement>(`state-leaf`)].find(
			(leaf) => leaf.dataset[`stateKey`] === hit.document.key,
		)
		update({ selected: hit, existing: Boolean(existing), detail: `` })
	}
	const openLive = (event: Event) => {
		const action = (event.target as Element).closest<HTMLElement>(
			`[data-action]`,
		)?.dataset[`action`]
		if (action !== `open-live`) return
		const selected = results.querySelector<HTMLElement>(`[data-active-result]`)
		const hit = result?.hits.find(
			(item) => item.document.id === selected?.dataset[`searchId`],
		)
		if (!hit) return
		const existing = [...host.querySelectorAll<HTMLElement>(`state-leaf`)].find(
			(leaf) => leaf.dataset[`stateKey`] === hit.document.key,
		)
		if (existing) {
			existing.hidden = false
			existing
				.closest<HTMLElement>(`:is(state-node,transaction-log,timeline-log)`)
				?.removeAttribute(`hidden`)
			existing.querySelector<HTMLElement>(`input, button`)?.focus()
		} else {
			session.finish(null)
			if (liveKey !== hit.document.key) {
				liveKey = hit.document.key
				update({ liveKey })
			}
		}
	}
	const selectResult = (event: Event) => {
		const target = (event.target as Element).closest<HTMLElement>(
			`[data-search-id]`,
		)
		const hit = result?.hits.find(
			(item) => item.document.id === target?.dataset[`searchId`],
		)
		if (hit) select(hit)
	}
	ui.addEventListener(`click`, openLive)
	results.addEventListener(`click`, selectResult)
	let commitPaint: (() => void) | undefined
	function paint(next: SearchResults) {
		const started = performance.now()
		if (next.validation) {
			update({ message: next.validation })
			return
		}
		result = next
		pendingHistory = undefined
		update({ hits: next.hits, selected: undefined, detail: ``, message: `` })
		const snapshot = context.index!
		const summary = context.query.trim()
			? `${next.matching} ${next.matching === 1 ? `match` : `matches`} · ${next.hits.length} shown`
			: `${snapshot.documents.length} captured records`
		const metadata = ` · ${context.query.trim() ? `${snapshot.documents.length} captured records · ` : ``}${`${new Date(snapshot.capturedAt).toISOString().slice(11, 19)} UTC`}.${snapshot.uncachedValues ? ` ${snapshot.uncachedValues} not cached.` : ``}${snapshot.skippedValues ? ` ${snapshot.skippedValues} complex values skipped.` : ``}${snapshot.partial ? ` Partial capture; more records unsearched.` : ``}${snapshot.truncatedText ? ` ${snapshot.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}${context.query.trim() && !next.matching ? ` No matches in captured ${history ? `history` : `metadata`}.` : ``}`
		update({
			summary,
			metadata,
			notes: `${snapshot.uncachedValues} not cached · ${snapshot.skippedValues} complex values skipped.${snapshot.notice ? ` ${snapshot.notice}` : ``}`,
		})
		mask()
		commitPaint = () => {
			host.dataset[`commitMs`] = String(performance.now() - started)
			host.dataset[`ready`] = `true`
		}
	}
	function matching() {
		cancelMatch()
		if (preparing || !context.index || !visible()) return
		busy = true
		update({ busy: true })
		host.dataset[`ready`] = `false`
		const started = performance.now()
		cancelMatch = scheduleGraph(
			matchStateSearch(context.index, context.query),
			(next, chunks) => {
				host.dataset[`matchMs`] = String(
					chunks.reduce((sum, value) => sum + value, 0),
				)
				host.dataset[`matchElapsedMs`] = String(performance.now() - started)
				host.dataset[`maxMatchChunkMs`] = String(Math.max(...chunks))
				host.dataset[`matchChunks`] = JSON.stringify(chunks)
				busy = false
				update({ busy: false })
				paint(next)
			},
			undefined,
			undefined,
			2,
		)
	}
	function query() {
		context.query = input.value
		matching()
	}
	function capture() {
		cancelIndex()
		cancelMatch()
		wait()
		wait = () => {}
		if (!visible()) return
		// A query may replace matching, but must never discard this admitted copy.
		preparing = true
		busy = true
		host.dataset[`ready`] = `false`
		update({ busy: true })
		const started = performance.now()
		const copy =
			view === `atoms` || view === `selectors`
				? captureStateSearch(store, view)
				: captureHistorySearch(store, view)
		host.dataset[`captureMs`] = String(performance.now() - started)
		if (!copy) {
			update({ message: `Waiting for the current transaction to commit.` })
			wait = store.on.transactionApplying.subscribe(
				`search-${view}-${crypto.randomUUID()}`,
				(applying) => {
					if (applying === null) capture()
				},
			)
			return
		}
		host.dataset[`captureWork`] = JSON.stringify(copy.snapshotWork)
		host.dataset[`documentCount`] = String(copy.documents.length)
		update({ message: `Preparing copied metadata and cached values…` })
		host.dataset[`ready`] = `false`
		cancelIndex = scheduleGraph(
			indexStateSearch(copy),
			(indexed, chunks) => {
				host.dataset[`indexMs`] = String(
					chunks.reduce((sum, value) => sum + value, 0),
				)
				host.dataset[`indexElapsedMs`] = String(
					performance.now() - started - Number(host.dataset[`captureMs`]),
				)
				host.dataset[`maxIndexChunkMs`] = String(Math.max(...chunks))
				host.dataset[`indexChunks`] = JSON.stringify(chunks)
				context.index = indexed
				preparing = false
				if (
					liveKey &&
					!store.atoms.has(liveKey) &&
					!store.readonlySelectors.has(liveKey) &&
					!store.writableSelectors.has(liveKey)
				) {
					liveKey = undefined
					update({ liveKey: undefined })
				}
				matching()
			},
			undefined,
			undefined,
			0.5,
		)
	}
	const inputChange = (event: Event) => {
		if (!(event as InputEvent).isComposing) query()
	}
	input.addEventListener(`input`, inputChange)
	input.addEventListener(`compositionend`, query)
	const keydown = (event: KeyboardEvent) => {
		if (!visible() || event.isComposing || event.defaultPrevented) return
		if (
			event.key === `Escape` &&
			doc.querySelector(`[data-window-interaction="true"]`)
		) {
			// Keep native search-input Escape clearing behind window cancellation too.
			event.preventDefault()
			return
		}
		const target = event.target as HTMLElement
		if (isSearchShortcut(event)) {
			event.preventDefault()
			origin = target
			input.focus()
			input.select()
			return
		}
		if (history && selectedHistory?.contains(target) && event.key === `Escape`) {
			event.preventDefault()
			input.focus()
			return
		}
		if (!ui.contains(target)) return
		if (event.key === `Escape`) {
			if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
				return
			event.preventDefault()
			event.stopPropagation()
			if (target !== input) input.focus()
			else if (input.value) {
				input.value = ``
				query()
			} else {
				session.returnFocus()
				if (doc.activeElement === input) origin?.focus()
			}
			return
		}
		if (!busy) moveSearchFocus(event, results)
	}
	panel.addEventListener(`keydown`, keydown)
	const mutation = new win.MutationObserver(mask)
	mutation.observe(index, { childList: true, subtree: true })
	const visibility = new win.MutationObserver(() => {
		cancelIndex()
		cancelMatch()
		wait()
		wait = () => {}
		if (visible()) {
			if (preparing || !context.index) capture()
			else matching()
		}
	})
	visibility.observe(panel, {
		attributes: true,
		attributeFilter: [`hidden`, `data-open`],
	})
	if (context.index) matching()
	else capture()
	return {
		committed() {
			const commit = commitPaint
			commitPaint = undefined
			commit?.()
			revealHistory()
		},
		dispose() {
			disposed = true
			delete context.index
			cancelIndex()
			cancelMatch()
			wait()
			session.dispose()
			mutation.disconnect()
			visibility.disconnect()
			panel.removeEventListener(`keydown`, keydown)
			ui.removeEventListener(`click`, openLive)
			results.removeEventListener(`click`, selectResult)
		},
	}
}
