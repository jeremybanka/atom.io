import type { RootStore } from "atom.io/internal"

import { captureEcologySnapshot, traceEcologyRoots } from "./ecology.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import { graphEdgePath, projectEcology, scheduleGraph } from "./ecology-graph.ts"
import { indexEcologySearch } from "./ecology-search.ts"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { matchStateSearch, type SearchIndex } from "./search.ts"
import { isSearchShortcut, moveSearchFocus } from "./search-keys.ts"
import { createSearchSession, editorIsCurrent } from "./search-session.ts"

/** Own one graph view. No application subscriptions, state getters or geometry observers. */
export function createEcologyController(
	host: HTMLElement,
	store: RootStore,
	context: GraphContext,
	update: (patch: Partial<EcologyPresentation>) => void,
	marker: string,
): { dispose(): void; committed(): void } {
	const document = host.ownerDocument
	const input = host.querySelector(`input`)!
	const panel = host.closest<HTMLElement>(`debugger-panel, main`)!
	const searchScope = host.querySelector<HTMLElement>(`ecology-search`)!
	const results = host.querySelector<HTMLOListElement>(
		`ecology-view [data-results]`,
	)!
	const livePanel = host.querySelector<HTMLElement>(`ecology-live-panel`)!
	const live = livePanel.querySelector<HTMLElement>(`ecology-live`)!
	let liveKey: string | undefined
	let liveDefinition: unknown
	let origin: HTMLElement | null = null
	let reveal: string | undefined
	let disposed = false,
		preparing = false,
		busy = false
	let searchIndex: SearchIndex | undefined
	let matchedIds: ReadonlySet<string> | undefined
	let approximationLimited = false
	let cancelIndex = () => {},
		cancelMatch = () => {},
		wait = () => {}
	const visible = () =>
		!disposed && !panel.hidden && panel.dataset[`open`] !== `false`
	const definition = (key: string) =>
		store.atoms.get(key) ??
		store.readonlySelectors.get(key) ??
		store.writableSelectors.get(key)
	input.value = context.query
	const inspector = host.querySelector<HTMLElement>(`ecology-body > aside`)!
	const svg = host.querySelector<SVGSVGElement>(`svg`)!
	const list = host.querySelector<HTMLElement>(`ecology-map ul`)!
	const map = host.querySelector<HTMLElement>(`ecology-map`)!
	const compact = () => panel.clientWidth > 0 && panel.clientWidth <= 650
	const workspaceView = (view: string) => {
		update({ workspace: view })
		if (view === `list`) map.querySelector(`details`)!.open = true
	}
	workspaceView(`graph`)
	let focusHeading = false,
		focusLive = false,
		focusBack = false
	const focusSelection = () => {
		focusHeading = true
		workspaceView(`selection`)
	}
	let cards: EcologyPresentation[`cards`] = [],
		edges: EcologyPresentation[`edges`] = [],
		generation = 0
	let model: GraphModel | undefined,
		cancel = () => {},
		jobs = 0
	const transform = () => {
		update({ pan: { ...context.pan } })
	}
	const session = createSearchSession(
		panel,
		searchScope,
		() => {
			update({ draftPinned: Boolean(session.pinned()) })
		},
		(editor) => editorIsCurrent(store, editor),
	)
	const closeLive = () => {
		session.finish(null)

		liveKey = undefined
		update({ liveKey: undefined })
	}
	const passive = () => {
		update({
			selected: context.selected ? model?.all.get(context.selected) : undefined,
			selectionOutside:
				Boolean(context.selected) &&
				!model?.items.some((item) => item.id === context.selected),
			traceStatus: context.traceStatus,
			expanded: new Set(context.expanded),
			traced: context.trace,
			capturedAt: context.capturedAt,
		})
	}
	const select = (id: string, navigate = false) => {
		if (context.selected !== id) {
			context.trace = new Set()
			context.traceStatus = `Not traced`
		}
		context.selected = id

		passive()
		if (!navigate && compact()) focusSelection()
		if (navigate) {
			reveal = id
			project()
		}
	}
	const paint = (value: GraphModel, chunks: number[]) => {
		const start = performance.now()
		const focused = document.activeElement as HTMLElement
		const hadFocus = host.contains(focused)
		const focusId = focused.getAttribute(`data-graph-id`),
			focusAction = focused.getAttribute(`data-action`)
		model = value
		jobs++
		host.dataset[`jobs`] = String(jobs)
		host.dataset[`newPositions`] = String(value.newPositions)
		host.dataset[`layoutMs`] = String(
			chunks.reduce((sum, chunk) => sum + chunk, 0),
		)
		host.dataset[`maxChunkMs`] = String(Math.max(...chunks))
		const snapshot = context.snapshot!
		const countsText = `${value.atoms} atoms · ${value.selectors} selectors · ${snapshot.families.length} families / ${value.members} members · showing ${value.items.length} of ${value.matching}${approximationLimited ? `+` : ``} matching groups/instances · ${value.edges.length} of ${snapshot.edges.length} captured edges`
		const noticeText =
			snapshot.truncated.nodes ||
			snapshot.truncated.families ||
			snapshot.truncated.relations
				? `Capture truncated: full store totals unknown. Search covers captured metadata only. Captured counts above are exact.`
				: `Observed snapshot ${context.capturedAt}. Paint cap: 500 nodes / 1,000 edges. Search to narrow; expand families for members.`
		// Retain bounded slots within this capture; SPA owns their nodes and hidden state.
		cards = value.items.concat(cards.slice(value.items.length))
		edges = value.edges
			.map((edge) => ({
				path: graphEdgePath(value.all.get(edge.from)!, value.all.get(edge.to)!),
				traced: edge.traced,
			}))
			.concat(edges.slice(value.edges.length))
		host.dataset[`retainedCards`] = String(cards.length)
		update({
			cardSlots: cards.length,
			edgeSlots: edges.length,
			visibleCards: value.items.length,
			visibleEdges: value.edges.length,
			cards,
			edges,
			generation,
			counts: countsText,
			notice: noticeText,
			truncated:
				snapshot.truncated.nodes ||
				snapshot.truncated.families ||
				snapshot.truncated.relations,
			empty: !value.items.length,
			emptyText: context.query.trim()
				? `No nodes match this search. Clear search to see the captured graph, or Refresh to recapture.`
				: `No nodes in this capture. Refresh after your application creates state.`,
		})
		transform()
		if (liveKey && definition(liveKey) !== liveDefinition) closeLive()
		passive()
		commitPaint = () => {
			if (reveal) {
				const target = [
					...list.querySelectorAll<HTMLButtonElement>(`button`),
				].find((item) => item.dataset[`graphId`] === reveal)!
				list.closest(`details`)!.open = true
				if (compact()) {
					workspaceView(`selection`)
					focusHeading = true
				} else {
					target.focus()
					target.scrollIntoView?.({ block: `nearest` })
				}
				reveal = undefined
			} else if (
				(focusId || focusAction) &&
				(!focused.isConnected ||
					document.activeElement !== focused ||
					focused.getAttribute(`data-graph-id`) !== focusId)
			) {
				const target = [
					...host.querySelectorAll<HTMLElement>(
						`[data-graph-id], [data-action]`,
					),
				].find(
					(candidate) =>
						candidate.tagName === focused.tagName &&
						(focusId
							? candidate.dataset[`graphId`] === focusId
							: candidate.dataset[`action`] === focusAction),
				)
				;(target ?? input).focus()
			}
			if (hadFocus && !focused.isConnected && !focusId && !focusAction)
				input.focus()
			host.dataset[`commitMs`] = String(performance.now() - start)
			busy = false
			update({ busy: false })
			host.dataset[`ready`] = `true`
		}
	}
	let commitPaint: (() => void) | undefined

	const project = () => {
		cancel()
		if (!visible() || !context.snapshot) return
		host.dataset[`ready`] = `false`
		cancel = scheduleGraph(
			projectEcology(context.snapshot, context, matchedIds, model),
			paint,
			undefined,
			undefined,
			4,
		)
	}
	const search = () => {
		context.query = input.value
		cancelMatch()
		cancel()
		if (preparing || !searchIndex || !visible()) return
		busy = true
		host.dataset[`ready`] = `false`
		update({ busy: true })
		const ids = new Set<string>(),
			started = performance.now()
		cancelMatch = scheduleGraph(
			matchStateSearch(searchIndex, context.query, 2_000_000, ids),
			(next, chunks) => {
				host.dataset[`matchMs`] = String(performance.now() - started)
				host.dataset[`maxMatchChunkMs`] = String(Math.max(...chunks))
				if (next.validation) {
					update({ status: next.validation })
					busy = false
					update({ busy: false })
					host.dataset[`ready`] = `true`
					return
				}
				matchedIds = context.query.trim() ? ids : undefined
				approximationLimited = next.approximateLimited
				update({ hits: next.hits })
				update({
					status: `${context.query.trim() ? `${next.matching}${next.approximateLimited ? `+` : ``} matching captured records; ${next.hits.length} ranked results. ` : ``}Metadata only.${searchIndex!.truncatedText ? ` ${searchIndex!.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}`,
				})
				project()
			},
			undefined,
			undefined,
			4,
		)
	}
	const refresh = () => {
		cancelIndex()
		cancelMatch()
		cancel()
		wait()
		wait = () => {}
		if (!visible()) return
		preparing = true
		busy = true
		host.dataset[`ready`] = `false`
		update({ busy: true })
		if (store.on.transactionApplying.state !== null) {
			update({ status: `Waiting for the current transaction to commit.` })
			wait = store.on.transactionApplying.subscribe(
				`ecology-search-${marker}`,
				(applying) => {
					if (applying === null) refresh()
				},
			)
			return
		}
		const start = performance.now()
		cards = []
		edges = []
		generation++
		context.snapshot = captureEcologySnapshot(store, {
			maxNodes: 10_000,
			maxFamilies: 10_000,
			maxRelations: 50_000,
		})
		context.capturedAt = new Date().toLocaleTimeString()
		host.dataset[`snapshotMs`] = String(performance.now() - start)
		cancelIndex = scheduleGraph(
			indexEcologySearch(context.snapshot),
			(index, chunks) => {
				searchIndex = index
				preparing = false
				host.dataset[`maxIndexChunkMs`] = String(Math.max(...chunks))
				search()
			},
			undefined,
			undefined,
			0.5,
		)
	}

	const action = (name: string) => {
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		if (name === `refresh`) {
			refresh()
			return
		}
		if (name.startsWith(`view-`)) {
			workspaceView(name.slice(5))
			return
		}
		if (name === `clear-query`) {
			input.value = ``
			search()
			input.focus()
			return
		}
		if (name === `clear`) {
			context.selected = null
			context.trace = new Set()
			context.traceStatus = `Not traced`
			project()
			return
		}
		if (name === `expand` && selected?.kind === `family`) {
			if (context.expanded.has(selected.key))
				context.expanded.delete(selected.key)
			else context.expanded.add(selected.key)
			project()
			return
		}
		if (name === `trace` && selected && selected.kind !== `family`) {
			const trace = traceEcologyRoots(context.snapshot!, selected.key)
			context.trace = new Set(trace.visitedKeys)
			context.traceStatus = `Retained trace: ${trace.status}; ${trace.rootKeys.length} atom roots${trace.rootKeys.length ? `: ${trace.rootKeys.slice(0, 8).join(`, `)}` : ``}; ${trace.unresolvedKeys.length} unresolved; ${trace.cycleKeys.length} cycle back-edges. Other dependencies may be unknown.`
			project()
			return
		}
		if (name === `live` && selected && selected.kind !== `family`) {
			if (liveKey !== selected.key) {
				closeLive()
				liveKey = selected.key
				liveDefinition = definition(liveKey)
				update({ liveKey })
			}
			const target = live.querySelector<HTMLElement>(`input, button`)
			focusLive = !target
			target?.focus()
			return
		}
		if (name === `back`) {
			closeLive()
			passive()
			workspaceView(`selection`)
			focusBack = true
			return
		}

		if (name === `reset`) context.pan = { x: 0, y: 0, zoom: 1 }
		if (name === `fit` && model?.items.length) {
			const width = Math.max(...model.items.map((item) => item.x + 200)),
				height = Math.max(...model.items.map((item) => item.y + 76))
			context.pan = {
				x: 0,
				y: 0,
				zoom: Math.max(
					0.02,
					Math.min(
						(svg.clientWidth || 300) / width,
						(svg.clientHeight || 300) / height,
						1,
					),
				),
			}
		}
		if (name === `left`) context.pan.x -= 80
		if (name === `right`) context.pan.x += 80
		if (name === `up`) context.pan.y -= 80
		if (name === `down`) context.pan.y += 80
		if (name === `in`) context.pan.zoom = Math.min(3, context.pan.zoom * 1.25)
		if (name === `out`)
			context.pan.zoom = Math.max(0.02, context.pan.zoom / 1.25)
		transform()
	}
	const click = (event: Event) => {
		const target = (event.target as Element).closest<HTMLElement>(
			`[data-graph-id], [data-action]`,
		)
		if (!target) return
		if (target.dataset[`resultId`]) {
			if (!busy) select(target.dataset[`resultId`], true)
		} else if (target.dataset[`graphId`]) select(target.dataset[`graphId`])
		else action(target.dataset[`action`]!)
	}
	const key = (event: KeyboardEvent) => {
		if (!visible() || event.defaultPrevented || event.isComposing) return
		const target = event.target as HTMLElement
		if (isSearchShortcut(event)) {
			event.preventDefault()
			origin = target
			input.focus()
			input.select()
			return
		}
		if (target.closest(`ecology-live`)) return
		if (
			event.key === `Escape` &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey
		) {
			if (document.querySelector(`[data-window-interaction="true"]`)) {
				event.preventDefault()
				return
			}
			event.preventDefault()
			if (target === input) {
				if (input.value) {
					input.value = ``
					search()
				} else {
					session.returnFocus()
					if (document.activeElement === input) origin?.focus()
				}
			} else if (
				results.contains(target) ||
				list.contains(target) ||
				target === inspector.querySelector(`h2`)
			)
				input.focus()
			else {
				context.trace = new Set()
				context.traceStatus = `Not traced`
				project()
			}
			return
		}
		if (target === input || results.contains(target)) {
			if (!busy) moveSearchFocus(event, results)
			return
		}
		const id =
			target.closest<HTMLElement>(`g[data-graph-id]`)?.dataset[`graphId`]
		if (id && (event.key === `Enter` || event.key === ` `)) {
			event.preventDefault()
			select(id)
		}
	}
	const inputChange = (event: Event) => {
		if (!(event as InputEvent).isComposing) search()
	}

	const submit = (event: Event) => {
		event.preventDefault()
	}
	host.addEventListener(`click`, click)
	panel.addEventListener(`keydown`, key)
	input.addEventListener(`input`, inputChange)
	input.addEventListener(`compositionend`, search)
	host.querySelector(`form`)!.addEventListener(`submit`, submit)
	const visibility = new document.defaultView!.MutationObserver(() => {
		cancel()
		cancelIndex()
		cancelMatch()
		wait()
		wait = () => {}
		if (visible()) {
			if (preparing || !searchIndex) refresh()
			else search()
		}
	})
	visibility.observe(panel, {
		attributes: true,
		attributeFilter: [`hidden`, `data-open`],
	})
	refresh()
	return {
		committed() {
			const commit = commitPaint
			commitPaint = undefined
			commit?.()
			if (focusLive) {
				focusLive = false
				live.querySelector<HTMLElement>(`input, button`)?.focus()
			}
			if (focusBack) {
				focusBack = false
				const target =
					inspector.querySelector<HTMLElement>(`[data-action="live"]`) ??
					inspector
				target.focus()
			}
			if (focusHeading) {
				focusHeading = false
				inspector.querySelector<HTMLElement>(`h2`)?.focus()
			}
		},
		dispose() {
			disposed = true
			cancelIndex()
			cancelMatch()
			wait()
			cards = []
			edges = []
			visibility.disconnect()
			session.dispose()
			cancel()
			host.removeEventListener(`click`, click)
			panel.removeEventListener(`keydown`, key)
			input.removeEventListener(`input`, inputChange)
			input.removeEventListener(`compositionend`, search)
			host.querySelector(`form`)!.removeEventListener(`submit`, submit)
		},
	}
}
