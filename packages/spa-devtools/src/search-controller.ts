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

export interface SearchContext {
	query: string
	index?: SearchIndex
}
export const createSearchContext = (): SearchContext => ({ query: `` })

/** Owns only copied search data and passive DOM. The ordinary index and explicit live host stay mounted. */
export function createStateSearch(
	host: HTMLElement,
	store: RootStore,
	view: SearchView,
	context: SearchContext,
	openEditor?: (key: string, host: HTMLElement) => () => void,
): () => void {
	const history =
		view === `transactions` || view === `timelines` ? view : undefined
	const doc = host.ownerDocument,
		win = doc.defaultView!
	const panel = host.closest<HTMLElement>(`main`)!
	const index = host.querySelector<HTMLElement>(`.index`)!
	const ui = doc.createElement(`section`)
	ui.className = `state-search-ui`
	const row = doc.createElement(`div`)
	row.className = `search-row`
	const input = doc.createElement(`input`)
	input.type = `search`
	input.value = context.query
	input.setAttribute(`aria-label`, `Search ${view}`)
	input.placeholder = history
		? `Search recorded ${view}`
		: `Search ${view} and cached values`
	const button = (text: string, action: () => void): HTMLButtonElement => {
		const element = doc.createElement(`button`)
		element.type = `button`
		element.textContent = text
		element.onclick = action
		return element
	}
	const clear = button(`Clear`, () => {
		input.value = ``
		query()
		input.focus()
	})
	const refresh = button(`Refresh`, () => {
		capture()
	})
	row.append(input, clear, refresh)
	const status = doc.createElement(`p`)
	status.className = `search-status`
	status.setAttribute(`role`, `status`)
	const pin = doc.createElement(`p`)
	pin.className = `search-pin`
	const results = doc.createElement(`ol`)
	results.className = `search-results`
	results.setAttribute(`aria-label`, `${view} search results`)
	const details = doc.createElement(`section`)
	details.className = `search-details`
	ui.append(row, status, pin, results, details)
	host.prepend(ui)
	const live = doc.createElement(`section`)
	live.className = `search-live`
	host.insertBefore(live, index)
	let pendingHistory: SearchHit | undefined
	let selectedHistory: HTMLElement | undefined
	let disposeLive: (() => void) | undefined
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
			details.textContent = `Recorded event is no longer at its captured location. Refresh to update the snapshot.`
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
						`:scope > header button[aria-expanded="false"]`,
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
			revealHistory()
			return
		}

		const active = Boolean(context.query.trim())
		const keys = new Set(result?.hits.map((hit) => hit.document.key))
		const families = new Set(result?.hits.map((hit) => hit.document.family))
		const pinned = session.pinned()
		pin.textContent = pinned ? `Editing — kept visible` : ``
		for (const node of index.querySelectorAll<HTMLElement>(`.node`)) {
			node.hidden =
				active &&
				!keys.has(node.dataset[`stateKey`]!) &&
				!families.has(node.dataset[`stateKey`]!) &&
				!node.contains(pinned)
		}
		for (const leaf of index.querySelectorAll<HTMLElement>(`.state-leaf`)) {
			leaf.hidden =
				active && !keys.has(leaf.dataset[`stateKey`]!) && leaf !== pinned
		}
	}
	function mark(
		target: HTMLElement,
		text: string,
		ranges: readonly [number, number][],
	) {
		let from = 0
		for (const [start, end] of ranges) {
			target.append(doc.createTextNode(text.slice(from, start)))
			const span = doc.createElement(`mark`)
			span.textContent = text.slice(start, end)
			target.append(span)
			from = end
		}
		target.append(doc.createTextNode(text.slice(from)))
	}
	function select(hit: SearchHit) {
		if (busy) return
		if (history) {
			details.textContent = `${hit.document.detail}. Recorded preview only; no history cursor changed.`
			pendingHistory = hit
			revealHistory()
			return
		}
		details.replaceChildren()
		const heading = doc.createElement(`h2`)
		heading.textContent = hit.document.key
		const description = doc.createElement(`p`)
		description.textContent = `${hit.document.detail} · ${hit.document.value === `copied` ? `Cached simple value copied` : hit.document.value === `skipped` ? `Complex value skipped` : hit.document.value === `family` ? `Registered family; no member created` : `Value not cached; no value searched`}`
		details.append(heading, description)
		if (hit.document.kind === `family`) return
		const existing = [...host.querySelectorAll<HTMLElement>(`.state-leaf`)].find(
			(leaf) => leaf.dataset[`stateKey`] === hit.document.key,
		)
		if (existing) {
			details.append(
				button(`Return to live editor`, () => {
					existing.hidden = false
					existing.closest<HTMLElement>(`.node`)?.removeAttribute(`hidden`)
					const target = existing.querySelector<HTMLElement>(`input, button`)
					target?.focus()
				}),
			)
		} else {
			details.append(
				button(`Open live editor (may read/evaluate)`, () => {
					session.finish(null)
					if (liveKey === hit.document.key) return
					disposeLive?.()
					live.replaceChildren()
					liveKey = hit.document.key
					disposeLive = openEditor!(liveKey, live)
				}),
			)
		}
	}
	function paint(next: SearchResults) {
		const started = performance.now()
		if (next.validation) {
			status.textContent = next.validation
			return
		}
		result = next
		pendingHistory = undefined
		const fragment = doc.createDocumentFragment()
		details.replaceChildren()
		for (const hit of next.hits) {
			const item = doc.createElement(`li`)
			const target = button(``, () => {
				select(hit)
			})
			target.dataset[`searchId`] = hit.document.id
			target.title = hit.document.key
			target.setAttribute(
				`aria-label`,
				history
					? `${hit.document.key} — ${hit.document.detail}`
					: hit.document.key,
			)
			mark(target, hit.document.label, hit.ranges)
			item.append(target)
			const extra = doc.createElement(`small`)
			if (history) extra.append(`${hit.document.detail} · `)
			if (hit.valueMatch) {
				extra.append(history ? `recorded value: ` : `cached value: `)
				mark(extra, hit.valueField!.text, hit.valueRanges)
			}
			if (hit.approximate) extra.append(` · approximate match`)
			item.append(extra)
			fragment.append(item)
		}
		results.replaceChildren(fragment)
		const snapshot = context.index!
		status.textContent = `${context.query.trim() ? `${next.matching} matches in captured ${history ? `history/primitive previews` : `metadata/cached values`}; showing ${next.hits.length}. ` : ``}${snapshot.documents.length} captured records · Captured at ${`${new Date(snapshot.capturedAt).toISOString().slice(11, 19)} UTC`} · ${snapshot.uncachedValues} not cached · ${snapshot.skippedValues} complex values skipped.${snapshot.notice ? ` ${snapshot.notice}` : ``}${snapshot.partial ? ` Partial capture; more records unsearched.` : ``}${snapshot.truncatedText ? ` ${snapshot.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}${context.query.trim() && !next.matching ? ` No matches in captured ${history ? `history` : `metadata`}.` : ``}`
		mask()
		host.dataset[`commitMs`] = String(performance.now() - started)
		host.dataset[`ready`] = `true`
	}
	function matching() {
		cancelMatch()
		if (preparing || !context.index || !visible()) return
		busy = true
		results.setAttribute(`aria-busy`, `true`)
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
				results.removeAttribute(`aria-busy`)
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
		results.setAttribute(`aria-busy`, `true`)
		const started = performance.now()
		const copy =
			view === `atoms` || view === `selectors`
				? captureStateSearch(store, view)
				: captureHistorySearch(store, view)
		host.dataset[`captureMs`] = String(performance.now() - started)
		if (!copy) {
			status.textContent = `Waiting for the current transaction to commit.`
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
		status.textContent = `Preparing copied metadata and cached values…`
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
					disposeLive?.()
					disposeLive = undefined
					liveKey = undefined
					live.replaceChildren()
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
	return () => {
		disposed = true
		cancelIndex()
		cancelMatch()
		wait()
		session.dispose()
		disposeLive?.()
		mutation.disconnect()
		visibility.disconnect()
		panel.removeEventListener(`keydown`, keydown)
		ui.remove()
		live.remove()
	}
}
