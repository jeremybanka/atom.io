import type { RootStore } from "atom.io/internal"
import { type FutureActivity, observeStore } from "atom.io/introspection"

import {
	captureEcologySnapshot,
	ecologyLoadState,
	type EcologyNode,
	ecologyValue,
} from "./ecology.ts"
import type { GraphContext, GraphItem, GraphModel } from "./ecology-graph.ts"
import { projectEcology, scheduleGraph } from "./ecology-graph.ts"
import { indexEcologySearch } from "./ecology-search.ts"
import type { EcologyPresentation } from "./EcologyView.tsx"
import type { WorkerPanelConnection } from "./mount-worker.ts"
import { matchStateSearch, type SearchIndex } from "./search.ts"
import { isSearchShortcut, moveSearchFocus } from "./search-keys.ts"
import { createSearchSession, editorIsCurrent } from "./search-session.ts"
import { scheduleTask } from "./task.ts"

/** Own passive graph work, responsive search and native modal/focus lifecycles. */
export function createEcologyController(
	host: HTMLElement,
	panel: HTMLElement,
	store: RootStore,
	context: GraphContext,
	update: (patch: Partial<EcologyPresentation>) => void,
	marker: string,
	worker?: WorkerPanelConnection,
): { dispose(): void; committed(): void; refresh(generatedKey?: string): void } {
	const document = host.ownerDocument
	const input = host.querySelector(`input`)!
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
	let generation = 0
	let model: GraphModel | undefined,
		cancel = () => {},
		jobs = 0
	let capturedNodes = new Map<string, EcologyNode>()
	let needsCapture = false
	let activityRevision = 0
	const changedCards = new Set<string>()
	const futureChanges = new Map<string, Set<FutureActivity>>()
	let cancelLive: (() => void) | undefined
	let stopObserving: (() => void) | undefined
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
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		const selectedCard = visibleId(context.selected)
		const family = familyKey(selected)
		update({
			selected,
			selectedCard,
			hasSelectedFamily: family !== undefined,
			...(family === undefined
				? {}
				: { familyExpanded: context.expanded.has(family) }),
			hasSelection: Boolean(context.selected),
			selectedIds: model?.selection?.selectedIds ?? new Set(),
			selectionOutside:
				Boolean(context.selected) &&
				!model?.rows.some((item) => item.id === context.selected),
			expanded: new Set(context.expanded),
			traced: model?.selection?.nodes ?? new Set(),
			focused: model?.selection?.items,
		})
	}
	const select = (id: string, navigate = false) => {
		if (modal === searchDialog) closeDialog(false)
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
		const focusInMapActions = hadFocus && focused.closest(`ecology-map-actions`)
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
					id: JSON.stringify([edge.from, edge.to]),
					source: fromCard,
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
		host.dataset[`retainedCards`] = String(value.items.length)
		// Settle the toolbar in the graph commit instead of scheduling another layout pass.
		update({
			busy: false,
			cylinderHeight: value.cylinderHeight,
			cards: value.items,
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
			} else if (focusInMapActions && focused.closest(`[inert]`)) {
				const scene = host.querySelector<HTMLElement>(`ecology-scene`)
				if (scene) scene.focus({ preventScroll: true })
				else returnToSearch()
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
					if (model?.snapshot !== context.snapshot) {
						project()
						return
					}
					busy = false
					update({ busy: false })
					host.dataset[`ready`] = `true`
					scheduleLive()
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
		needsCapture = false
		generation++
		context.snapshot =
			worker?.ecology() ??
			captureEcologySnapshot(store, {
				maxNodes: 10_000,
				maxFamilies: 10_000,
				maxRelations: 50_000,
			})
		capturedNodes = new Map(
			context.snapshot.nodes.map((node) => [node.key, node]),
		)
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
	const scheduleLive = () => {
		if (
			cancelLive ||
			!visible() ||
			(!changedCards.size && (!needsCapture || busy))
		)
			return
		cancelLive = scheduleTask(() => {
			cancelLive = undefined
			if (!visible()) return
			if (changedCards.size) {
				const activity = { revision: ++activityRevision, at: performance.now() }
				update({
					activity: new Map(
						[...changedCards].map((id) => {
							const future = futureChanges.get(id)
							return [id, future ? { ...activity, future } : activity]
						}),
					),
				})
				changedCards.clear()
				futureChanges.clear()
			}
			if (needsCapture && !busy) refresh()
		})
	}
	const startObserving = () => {
		stopObserving ??= observeStore(store, (changes) => {
			if (!visible()) return
			const focusedLeaf =
				document.activeElement?.closest<HTMLElement>(`state-leaf`)
			const focusedKey = focusedLeaf?.dataset[`stateKey`]
			const markState = (key: string, previous?: EcologyNode) => {
				const definition =
					store.atoms.get(key) ??
					store.readonlySelectors.get(key) ??
					store.writableSelectors.get(key)
				if (definition) changedCards.add(`state:${key}`)
				else if (focusedLeaf && key === focusedKey && host.contains(focusedLeaf))
					returnToSearch()
				const family = (definition ?? previous)?.family?.key
				if (family) changedCards.add(`family:${family}`)
				return definition
			}
			for (const key of changes.values) {
				const previous = capturedNodes.get(key)
				if (!previous && !changes.states.has(key)) continue
				const definition = markState(key, previous)
				const events = changes.futures.get(key)
				if (definition && (events || context.completedLoads.has(definition))) {
					const { status } = ecologyLoadState(store, key)
					if (status || events?.has(`rejected`))
						context.completedLoads.delete(definition)
					else if (events?.has(`resolved`))
						context.completedLoads.add(definition)
					else if (events?.has(`started`))
						context.completedLoads.delete(definition)
				}
				if (events) {
					const id = `state:${key}`
					let pending = futureChanges.get(id)
					if (!pending || events.has(`started`))
						futureChanges.set(id, (pending = new Set()))
					for (const event of events) pending.add(event)
				}
				if (!previous) continue
				const before = previous.value
				const after = ecologyValue(store, key)
				if (
					before.status !== after.status ||
					(before.status === `cached` &&
						after.status === `cached` &&
						before.type !== after.type)
				)
					needsCapture = true
			}
			for (const key of changes.dependencies) {
				const previous = capturedNodes.get(key)
				if (!previous) continue
				markState(key, previous)
				needsCapture = true
			}
			for (const key of changes.states) markState(key, capturedNodes.get(key))
			for (const key of changes.families) changedCards.add(`family:${key}`)
			needsCapture ||= changes.states.size > 0 || changes.families.size > 0
			scheduleLive()
		})
	}
	const stopLive = () => {
		stopObserving?.()
		stopObserving = undefined
		cancelLive?.()
		cancelLive = undefined
		changedCards.clear()
		futureChanges.clear()
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
			project()
			return
		}
		const family = targetFamily ?? familyKey(selected)
		if (name === `expand` && family) {
			if (context.expanded.has(family)) context.expanded.delete(family)
			else context.expanded.add(family)
			project()
		}
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
		if (escape && panel.dataset[`windowInteraction`] === `true`) {
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
			startObserving()
			refresh()
		} else {
			stopLive()
			closeDialog(false)
		}
	})
	visibility.observe(panel, {
		attributes: true,
		attributeFilter: [`hidden`, `data-open`],
	})
	if (visible()) {
		startObserving()
		refresh()
	}
	const stopWorker = worker?.subscribeEcology(() => {
		needsCapture = true
		scheduleLive()
	})
	return {
		refresh,
		committed() {
			const commit = commitPaint
			commitPaint = undefined
			commit?.()
			if (commit) scheduleLive()
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
			stopWorker?.()
			stopLive()
			cancelIndex()
			cancelMatch()
			wait()
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
