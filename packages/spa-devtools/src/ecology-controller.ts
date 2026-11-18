import type { RootStore } from "atom.io/internal"

import { captureEcologySnapshot, traceEcologyRoots } from "./ecology.ts"
import type { GraphContext, GraphItem, GraphModel } from "./ecology-graph.ts"
import { projectEcology, scheduleGraph } from "./ecology-graph.ts"
import { indexEcologySearch } from "./ecology-search.ts"
import type { EcologyPresentation } from "./EcologyView.tsx"
import { matchStateSearch, type SearchIndex } from "./search.ts"
import { isSearchShortcut, moveSearchFocus } from "./search-keys.ts"
import { createSearchSession, editorIsCurrent } from "./search-session.ts"

/** Own passive graph work, responsive search and native modal/focus lifecycles. */
export function createEcologyController(
	host: HTMLElement,
	store: RootStore,
	context: GraphContext,
	update: (patch: Partial<EcologyPresentation>) => void,
	marker: string,
): { dispose(): void; committed(): void; refresh(generatedKey?: string): void } {
	const document = host.ownerDocument
	const input = host.querySelector(`input`)!
	const panel = host.closest<HTMLElement>(`debugger-panel, main`)!
	const searchDialog =
		host.querySelector<HTMLDialogElement>(`[data-search-modal]`)!
	const guideDialog =
		host.querySelector<HTMLDialogElement>(`[data-guide-modal]`)!
	const searchButton = host.querySelector<HTMLButtonElement>(
		`[data-action="search"]`,
	)!
	const results = host.querySelector<HTMLOListElement>(
		`ecology-view [data-results]`,
	)!
	let origin: HTMLElement | null = null
	let reveal: string | undefined
	let generatedKey: string | undefined
	let disposed = false,
		preparing = false,
		busy = false
	let pendingSearch: Pick<EcologyPresentation, `hits` | `status`> | undefined
	let searchIndex: SearchIndex | undefined
	let matchedIds: ReadonlySet<string> | undefined
	let approximationLimited = false
	let cancelIndex = () => {},
		cancelMatch = () => {},
		wait = () => {}
	const visible = () =>
		!disposed && !panel.hidden && panel.dataset[`open`] !== `false`
	input.value = context.query
	const list = host.querySelector<HTMLElement>(`ecology-editor`)!
	const compact = () => panel.clientWidth > 0 && panel.clientWidth <= 650
	let cards: EcologyPresentation[`cards`] = [],
		generation = 0
	let model: GraphModel | undefined,
		cancel = () => {},
		jobs = 0
	let cameraSequence = 0
	const camera = (action: string, target?: string) => {
		update({
			cameraCommand: {
				sequence: ++cameraSequence,
				action,
				...(target ? { target } : {}),
			},
		})
	}
	const session = createSearchSession(
		panel,
		(target) =>
			host.contains(target) &&
			(!target.closest(`state-leaf`) || target.matches(`[data-graph-id]`)),
		() => {
			update({ pinnedKey: session.pinned()?.dataset[`stateKey`] })
		},
		(editor) => editorIsCurrent(store, editor),
	)
	let modal: HTMLDialogElement | undefined,
		dialogOrigin: HTMLElement | null = null
	const closeDialog = (restore = true) => {
		if (!modal) return
		const closed = modal,
			target = dialogOrigin
		modal = undefined
		dialogOrigin = null
		closed.close()
		if (!disposed) update({ dialog: null })
		if (closed === searchDialog && !compact()) searchDialog.open = true
		if (restore) {
			if (closed === searchDialog && session.pinned()) session.returnFocus()
			else if (target?.isConnected) target.focus()
		}
	}
	const openDialog = (dialog: HTMLDialogElement) => {
		if (modal === dialog) return
		closeDialog(false)
		const active = document.activeElement as HTMLElement
		dialogOrigin = searchDialog.contains(active)
			? compact()
				? searchButton
				: input
			: active
		if (dialog.open) dialog.close()
		modal = dialog
		update({ dialog: dialog === searchDialog ? `search` : `guide` })
		dialog.showModal()
		if (dialog === searchDialog) input.focus()
	}
	const focusSearch = () => {
		if (compact()) openDialog(searchDialog)
		else searchDialog.open = true
		input.focus()
	}
	const returnToSearch = () => {
		;(compact() ? searchButton : input).focus()
	}
	const syncSearchMode = () => {
		if (!compact()) {
			const wasModal = modal === searchDialog
			if (wasModal) closeDialog(false)
			searchDialog.open = true
			if (wasModal) input.focus()
		} else if (modal !== searchDialog) {
			const focused = searchDialog.contains(document.activeElement)
			searchDialog.close()
			if (focused && visible()) searchButton.focus()
		}
	}
	const resize = new document.defaultView!.ResizeObserver(syncSearchMode)
	resize.observe(panel)
	syncSearchMode()
	const familyKey = (item: GraphItem | undefined): string | undefined => {
		const key =
			item?.kind === `family`
				? item.key
				: item && `family` in item.source
					? item.source.family?.key
					: undefined
		return key && model?.all.has(`family:${key}`) ? key : undefined
	}
	const visibleId = (id: string | null | undefined): string | undefined => {
		if (!id) return undefined
		const family = familyKey(model?.all.get(id))
		return family && !context.expanded.has(family) ? `family:${family}` : id
	}
	const passive = () => {
		const selectedCard = visibleId(context.selected)
		update({
			selected: context.selected ? model?.all.get(context.selected) : undefined,
			selectedCard,
			selectedIds: model?.selection?.selectedIds ?? new Set(),
			selectionOutside:
				Boolean(context.selected) &&
				!model?.rows.some((item) => item.id === context.selected),
			traceStatus: context.traceStatus,
			expanded: new Set(context.expanded),
			traced: model?.selection?.nodes ?? context.trace,
			focused: model?.selection?.items,
			capturedAt: context.capturedAt,
		})
	}
	const select = (id: string, navigate = false) => {
		if (modal === searchDialog) closeDialog(false)
		if (context.selected !== id) {
			context.trace = new Set()
			context.traceStatus = `Not traced`
		}
		context.selected = id

		if (navigate) {
			const item = model?.all.get(id)
			if (item && `family` in item.source && item.source.family)
				context.expanded.add(item.source.family.key)
			reveal = id
		}
		project()
	}
	const paint = (value: GraphModel, chunks: number[]) => {
		const start = performance.now()
		// Commit ranked results with their graph rather than rendering an intermediate view.
		if (pendingSearch) {
			update(pendingSearch)
			pendingSearch = undefined
		}
		const focused = document.activeElement as HTMLElement
		const hadFocus = host.contains(focused)
		const focusId = focused.getAttribute(`data-graph-id`),
			focusAction = focused.getAttribute(`data-action`)
		const focusInList = list.contains(focused)
		model = value
		jobs++
		host.dataset[`jobs`] = String(jobs)
		host.dataset[`newPositions`] = String(value.newPositions)
		host.dataset[`layoutMs`] = String(
			chunks.reduce((sum, chunk) => sum + chunk, 0),
		)
		host.dataset[`maxChunkMs`] = String(Math.max(...chunks))
		const snapshot = context.snapshot!
		const countsText = `${value.atoms} atoms · ${value.selectors} selectors · ${snapshot.families.length} families / ${value.members} members · showing ${value.items.length} of ${value.all.visible.length} groups/instances · ${value.matching}${approximationLimited ? `+` : ``} matching groups/instances · ${value.rows.length} of ${value.rowCount} editor rows · ${value.edges.length} of ${snapshot.edges.length} captured edges`
		host.dataset[`counts`] = countsText
		const noticeText =
			snapshot.truncated.nodes ||
			snapshot.truncated.families ||
			snapshot.truncated.relations
				? `Capture truncated: full store totals unknown. Search covers captured metadata only. Captured metadata is a bounded prefix.`
				: `Observed snapshot ${context.capturedAt}. Paint cap: 500 nodes / 1,000 edges. Search to narrow; expand families for members.`
		// Retain bounded slots within this capture; SPA owns their nodes and hidden state.
		cards = value.items.concat(cards.slice(value.items.length))
		const rowIds = new Set(value.rows.map((item) => item.id))
		const pinnedKey = session.pinned()?.dataset[`stateKey`] ?? generatedKey
		const nextRows = [...value.rows]
		const pinned = pinnedKey ? value.all.get(`state:${pinnedKey}`) : undefined
		if (pinned && !rowIds.has(pinned.id)) {
			nextRows.push(pinned)
		}
		const edges = value.edges.map<EcologyPresentation[`edges`][number]>(
			(edge) => {
				const from = value.all.get(edge.from)!,
					to = value.all.get(edge.to)!
				const fromCard = visibleId(from.id)!,
					toCard = visibleId(to.id)!
				return {
					from,
					to,
					color: from.color,
					fromCollapsed:
						value.matches !== undefined && !value.matches.has(fromCard),
					toCollapsed: value.matches !== undefined && !value.matches.has(toCard),
					fromCard: fromCard !== from.id ? value.all.get(fromCard) : undefined,
					toCard: toCard !== to.id ? value.all.get(toCard) : undefined,
					traced: edge.traced,
				}
			},
		)
		host.dataset[`retainedCards`] = String(cards.length)
		update({
			cardSlots: cards.length,
			cylinderHeight: value.cylinderHeight,
			visibleCards: value.items.length,
			cards,
			rows: nextRows,
			rowCount: value.rowCount,
			rowIds,
			matches: value.matches,
			pinnedKey,
			edges,
			familyConnections: value.familyConnections,
			generation,
			filtered: matchedIds !== undefined,
			notice: noticeText,
			empty: !value.rows.length,
			emptyText: context.query.trim()
				? `No nodes match this search. Clear search to see the captured graph, or Refresh to recapture.`
				: `No nodes in this capture. Refresh after your application creates state.`,
		})
		passive()
		commitPaint = () => {
			const selectedFamily = familyKey(
				context.selected ? value.all.get(context.selected) : undefined,
			)
			const logicalFocusId = focusInList
				? focusId
				: focusId === context.selected ||
					  (selectedFamily && focusId === `family:${selectedFamily}`)
					? visibleId(context.selected)
					: visibleId(focusId)
			if (reveal) {
				camera(`focus`, reveal)
				const target = [
					...list.querySelectorAll<HTMLButtonElement>(`button[data-graph-id]`),
				].find((item) => item.dataset[`graphId`] === reveal)
				target?.focus()
				target?.scrollIntoView?.({ block: `nearest` })
				reveal = undefined
			} else if (
				(focusId || focusAction) &&
				(!focused.isConnected ||
					document.activeElement !== focused ||
					focused.getAttribute(`data-graph-id`) !== focusId ||
					(focusId && logicalFocusId !== focusId))
			) {
				const target = [
					...(focusInList ? list : host).querySelectorAll<HTMLElement>(
						`[data-graph-id], [data-action]`,
					),
				].find(
					(candidate) =>
						candidate.tagName === focused.tagName &&
						(focusId
							? candidate.dataset[`graphId`] === logicalFocusId
							: candidate.dataset[`action`] === focusAction),
				)
				if (target) target.focus()
				else returnToSearch()
			}
			if (
				hadFocus &&
				!focused.isConnected &&
				!focusId &&
				!focusAction &&
				!generatedKey
			)
				returnToSearch()
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
		pendingSearch = undefined
		context.query = input.value
		cancelMatch()
		cancel()
		if (preparing || !searchIndex || !visible()) return
		busy = true
		host.dataset[`ready`] = `false`
		update({ busy: true, query: context.query })
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
				pendingSearch = {
					hits: next.hits,
					status: `${context.query.trim() ? `${next.matching}${next.approximateLimited ? `+` : ``} matching captured records; ${next.hits.length} ranked results. ` : ``}Metadata only.${searchIndex!.truncatedText ? ` ${searchIndex!.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}`,
				}
				project()
			},
			undefined,
			undefined,
			4,
		)
	}
	const refresh = (generated?: string) => {
		if (generated) generatedKey = generated
		pendingSearch = undefined
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

	const action = (name: string, targetFamily?: string) => {
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		if (name === `search`) {
			focusSearch()
			return
		}
		if (name === `guide`) {
			openDialog(guideDialog)
			return
		}
		if (name === `close-dialog`) {
			closeDialog()
			return
		}
		if (name === `refresh`) {
			refresh()
			return
		}
		if (name === `more-rows`) {
			context.rowLimit = Math.min(500, (context.rowLimit ?? 50) + 50)
			project()
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
		const family = targetFamily ?? familyKey(selected)
		if (name === `expand` && family) {
			if (context.expanded.has(family)) context.expanded.delete(family)
			else context.expanded.add(family)
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
		camera(name)
	}
	const click = (event: Event) => {
		if (modal && event.target === modal) {
			const pointer = event as MouseEvent,
				bounds = modal.getBoundingClientRect()
			if (
				pointer.clientX < bounds.left ||
				pointer.clientX > bounds.right ||
				pointer.clientY < bounds.top ||
				pointer.clientY > bounds.bottom
			)
				closeDialog()
			return
		}
		const target = (event.target as Element).closest<HTMLElement>(
			`[data-graph-id], [data-action]`,
		)
		if (!target) return
		if (target.dataset[`resultId`]) {
			if (!busy) select(target.dataset[`resultId`], true)
		} else if (target.dataset[`graphId`]) select(target.dataset[`graphId`])
		else action(target.dataset[`action`]!, target.dataset[`familyKey`])
	}
	const key = (event: KeyboardEvent) => {
		if (!visible() || event.defaultPrevented || event.isComposing) return
		const target = event.target as HTMLElement
		const escape =
			event.key === `Escape` &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey
		if (escape && document.querySelector(`[data-window-interaction="true"]`)) {
			event.preventDefault()
			return
		}
		if (modal && escape) {
			event.preventDefault()
			closeDialog()
			return
		}
		if (modal === guideDialog) return
		if (isSearchShortcut(event)) {
			event.preventDefault()
			origin = target
			focusSearch()
			input.select()
			return
		}
		if (target.closest(`state-leaf`) && !target.matches(`[data-graph-id]`))
			return
		if (escape) {
			event.preventDefault()
			if (context.selected) {
				action(`clear`)
				if (results.contains(target) || list.contains(target)) returnToSearch()
			} else if (target === input) {
				if (input.value) {
					input.value = ``
					search()
				} else {
					session.returnFocus()
					if (document.activeElement === input) origin?.focus()
				}
			} else if (results.contains(target) || list.contains(target))
				returnToSearch()
			return
		}
		if (target === input || results.contains(target)) {
			if (!busy) moveSearchFocus(event, results)
			return
		}
		if (
			target.matches(`ecology-scene`) &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			(event.key === `+` || event.key === `-`)
		) {
			event.preventDefault()
			camera(event.key === `+` ? `in` : `out`)
			return
		}
		const id = target.closest<HTMLElement>(`[data-graph-id]`)?.dataset[`graphId`]
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		if (
			event.key === `Enter` &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.altKey &&
			!event.shiftKey &&
			familyKey(selected) &&
			(id === context.selected ||
				id === visibleId(context.selected) ||
				target.matches(`ecology-scene`))
		) {
			event.preventDefault()
			action(`expand`)
			return
		}
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
	const cancelDialog = (event: Event) => {
		event.preventDefault()
		if (event.currentTarget === modal) closeDialog()
	}
	host.addEventListener(`click`, click)
	panel.addEventListener(`keydown`, key)
	searchDialog.addEventListener(`cancel`, cancelDialog)
	guideDialog.addEventListener(`cancel`, cancelDialog)
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
			syncSearchMode()
			if (preparing || !searchIndex) refresh()
			else search()
		} else closeDialog(false)
	})
	visibility.observe(panel, {
		attributes: true,
		attributeFilter: [`hidden`, `data-open`],
	})
	refresh()
	return {
		refresh,
		committed() {
			const commit = commitPaint
			commitPaint = undefined
			commit?.()
			if (generatedKey && commit) {
				const leaf = [...list.querySelectorAll<HTMLElement>(`state-leaf`)].find(
					(node) => node.dataset[`stateKey`] === generatedKey,
				)
				const target =
					leaf?.querySelector<HTMLElement>(
						`json-primitive input, editor-row > button[aria-expanded]`,
					) ??
					leaf?.querySelector<HTMLElement>(`select`) ??
					leaf?.querySelector<HTMLElement>(`[data-graph-id]`)
				generatedKey = undefined
				if (target) target.focus()
				else returnToSearch()
			}
		},
		dispose() {
			disposed = true
			cancelIndex()
			cancelMatch()
			wait()
			cards = []
			visibility.disconnect()
			session.dispose()
			resize.disconnect()
			closeDialog(false)
			cancel()
			host.removeEventListener(`click`, click)
			panel.removeEventListener(`keydown`, key)
			searchDialog.removeEventListener(`cancel`, cancelDialog)
			guideDialog.removeEventListener(`cancel`, cancelDialog)
			input.removeEventListener(`input`, inputChange)
			input.removeEventListener(`compositionend`, search)
			host.querySelector(`form`)!.removeEventListener(`submit`, submit)
		},
	}
}
