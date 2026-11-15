import type { RootStore } from "atom.io/internal"

import { scheduleGraph } from "./ecology-graph.ts"
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
import { createSearchSession } from "./search-session.ts"

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
	openEditor: (key: string, host: HTMLElement) => () => void,
): () => void {
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
	input.placeholder = `Search ${view} and cached values`
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
	let disposeLive: (() => void) | undefined
	let liveKey: string | undefined
	let result: SearchResults | undefined
	let cancel = () => {}
	let wait = () => {}
	let disposed = false,
		busy = false
	let origin: HTMLElement | null = null
	const visible = () =>
		!disposed && !panel.hidden && panel.dataset[`open`] !== `false`
	const session = createSearchSession(panel, ui, mask, (editor) => {
		const key = editor.closest<HTMLElement>(`.state-leaf`)!.dataset[`stateKey`]!
		const definition = () =>
			store.atoms.get(key) ??
			store.readonlySelectors.get(key) ??
			store.writableSelectors.get(key)
		const state = definition(),
			value = store.valueMap.get(key),
			cached = store.valueMap.has(key)
		return () =>
			definition() === state &&
			store.valueMap.has(key) === cached &&
			Object.is(store.valueMap.get(key), value)
	})
	function mask() {
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
					disposeLive = openEditor(liveKey, live)
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
		results.replaceChildren()
		details.replaceChildren()
		for (const hit of next.hits) {
			const item = doc.createElement(`li`)
			const target = button(``, () => {
				select(hit)
			})
			target.dataset[`searchId`] = hit.document.id
			target.title = hit.document.key
			target.setAttribute(`aria-label`, hit.document.key)
			mark(target, hit.document.label, hit.ranges)
			item.append(target)
			const extra = doc.createElement(`small`)
			if (hit.valueMatch) {
				extra.append(`cached value: `)
				mark(
					extra,
					hit.document.fields.find((field) => field.kind === `value`)!.text,
					hit.valueRanges,
				)
			}
			if (hit.approximate) extra.append(` · approximate match`)
			item.append(extra)
			results.append(item)
		}
		const snapshot = context.index!
		status.textContent = `${context.query.trim() ? `${next.matching} matches in captured metadata/cached values; showing ${next.hits.length}. ` : ``}${snapshot.documents.length} captured records · Captured at ${new Date(snapshot.capturedAt).toLocaleTimeString()} · ${snapshot.uncachedValues} not cached · ${snapshot.skippedValues} complex values skipped.${snapshot.partial ? ` Partial capture; more records unsearched.` : ``}${snapshot.truncatedText ? ` ${snapshot.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}${context.query.trim() && !next.matching ? ` No matches in captured metadata.` : ``}`
		mask()
		host.dataset[`commitMs`] = String(performance.now() - started)
		host.dataset[`ready`] = `true`
	}
	function matching() {
		if (!context.index || !visible()) return
		busy = true
		results.setAttribute(`aria-busy`, `true`)
		host.dataset[`ready`] = `false`
		const started = performance.now()
		cancel = scheduleGraph(
			matchStateSearch(context.index, context.query),
			(next, chunks) => {
				host.dataset[`matchMs`] = String(
					chunks.reduce((sum, value) => sum + value, 0),
				)
				host.dataset[`matchElapsedMs`] = String(performance.now() - started)
				host.dataset[`maxMatchChunkMs`] = String(Math.max(...chunks))
				busy = false
				results.removeAttribute(`aria-busy`)
				paint(next)
			},
		)
	}
	function query() {
		cancel()
		context.query = input.value
		matching()
	}
	function capture() {
		cancel()
		wait()
		wait = () => {}
		if (!visible()) return
		busy = true
		results.setAttribute(`aria-busy`, `true`)
		const started = performance.now()
		const copy = captureStateSearch(store, view)
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
		cancel = scheduleGraph(indexStateSearch(copy), (indexed, chunks) => {
			host.dataset[`indexMs`] = String(
				chunks.reduce((sum, value) => sum + value, 0),
			)
			host.dataset[`indexElapsedMs`] = String(
				performance.now() - started - Number(host.dataset[`captureMs`]),
			)
			host.dataset[`maxIndexChunkMs`] = String(Math.max(...chunks))
			context.index = indexed
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
		})
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
		const editable =
			target.matches(
				`input, textarea, select, [contenteditable]:not([contenteditable="false"])`,
			) || target.isContentEditable
		if (
			((event.ctrlKey || event.metaKey) &&
				event.shiftKey &&
				!event.altKey &&
				event.key.toLowerCase() === `f`) ||
			(!editable &&
				!event.ctrlKey &&
				!event.metaKey &&
				!event.altKey &&
				!event.shiftKey &&
				event.key === `/`)
		) {
			event.preventDefault()
			origin = target
			input.focus()
			input.select()
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
		if (busy || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
			return
		const buttons = [...results.querySelectorAll<HTMLButtonElement>(`button`)]
		const at = buttons.indexOf(target as HTMLButtonElement)
		let next: number
		if (event.key === `ArrowDown`) next = (at + 1) % buttons.length
		else if (event.key === `ArrowUp`) next = (at < 1 ? buttons.length : at) - 1
		else if (at !== -1 && event.key === `Home`) next = 0
		else if (at !== -1 && event.key === `End`) next = buttons.length - 1
		else return
		if (buttons[next]) {
			event.preventDefault()
			buttons[next].focus()
		}
	}
	panel.addEventListener(`keydown`, keydown)
	const mutation = new win.MutationObserver(mask)
	mutation.observe(index, { childList: true, subtree: true })
	const visibility = new win.MutationObserver(() => {
		cancel()
		wait()
		wait = () => {}
		if (visible()) {
			if (context.index) matching()
			else capture()
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
		cancel()
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
