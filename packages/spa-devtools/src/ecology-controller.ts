import type { RootStore } from "atom.io/internal"

import { captureEcologySnapshot, traceEcologyRoots } from "./ecology.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import { graphEdgePath, projectEcology, scheduleGraph } from "./ecology-graph.ts"
import { indexEcologySearch } from "./ecology-search.ts"
import { matchStateSearch, type SearchIndex } from "./search.ts"
import { isSearchShortcut, moveSearchFocus } from "./search-keys.ts"
import { createSearchSession, editorIsCurrent } from "./search-session.ts"

let nextMarker = 0
const SVG = `http://www.w3.org/2000/svg`
/** Own one graph view. No application subscriptions, state getters or geometry observers. */
export function createEcologyController(
	host: HTMLElement,
	store: RootStore,
	context: GraphContext,
	openEditor: (key: string, host: HTMLElement) => () => void,
): () => void {
	const document = host.ownerDocument
	host.className = `ecology`
	host.innerHTML = `<section class="ecology-search"><form class="ecology-tools"><input type="search" aria-label="Search ecology" placeholder="Search keys, families, types"><button type="button" data-action="clear-query">Clear search</button><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="clear">Clear selection</button><button type="button" data-action="fit">Fit</button><button type="button" data-action="reset">Reset view</button></form><p class="ecology-counts" role="status"></p><p class="ecology-notice"></p><p class="ecology-legend">□ atom · ⬡ selector · dashed group: family · arrows: dependency → dependent · blue: traced path</p><p class="ecology-search-status" role="status"></p><ol class="ecology-results" aria-label="ecology search results"></ol><nav class="ecology-workspace" aria-label="Ecology workspace"><button type="button" data-action="view-graph" aria-pressed="true">Graph</button><button type="button" data-action="view-list" aria-pressed="false">Node list</button><button type="button" data-action="view-selection" aria-pressed="false">Selection</button></nav><section class="ecology-body"><section class="ecology-map"><nav aria-label="Graph navigation"><button type="button" data-action="left" aria-label="Pan left">←</button><button type="button" data-action="right" aria-label="Pan right">→</button><button type="button" data-action="up" aria-label="Pan up">↑</button><button type="button" data-action="down" aria-label="Pan down">↓</button><button type="button" data-action="in" aria-label="Zoom in">+</button><button type="button" data-action="out" aria-label="Zoom out">−</button></nav><svg role="group" aria-label="Observed dependency graph"></svg><details><summary>Accessible node list</summary><ul class="ecology-list"></ul></details></section><aside class="ecology-inspector" aria-label="Passive ecology inspector"></aside></section></section><section class="ecology-live-panel" hidden><header><span></span><button type="button" data-action="back">Back to passive inspector</button></header><section class="ecology-live"></section></section>`
	const input = host.querySelector(`input`)!
	const panel = host.closest<HTMLElement>(`main`)!
	const searchScope = host.querySelector<HTMLElement>(`.ecology-search`)!
	const results = host.querySelector<HTMLOListElement>(`.ecology-results`)!
	const searchStatus = host.querySelector<HTMLElement>(`.ecology-search-status`)!
	const livePanel = host.querySelector<HTMLElement>(`.ecology-live-panel`)!
	const live = livePanel.querySelector<HTMLElement>(`.ecology-live`)!
	const liveLabel = livePanel.querySelector(`span`)!
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
	const counts = host.querySelector<HTMLElement>(`.ecology-counts`)!
	const notice = host.querySelector<HTMLElement>(`.ecology-notice`)!
	const inspector = host.querySelector<HTMLElement>(`.ecology-inspector`)!
	inspector.tabIndex = -1
	const svg = host.querySelector<SVGSVGElement>(`svg`)!
	const list = host.querySelector<HTMLElement>(`.ecology-list`)!
	const marker = `ecology-arrow-${nextMarker++}`
	const workspace = host.querySelector<HTMLElement>(`.ecology-workspace`)!
	const map = host.querySelector<HTMLElement>(`.ecology-map`)!
	map.id = `${marker}-map`
	inspector.id = `${marker}-selection`
	const compact = () => panel.clientWidth > 0 && panel.clientWidth <= 650
	const workspaceView = (view: string) => {
		host.dataset[`workspace`] = view
		for (const control of workspace.querySelectorAll(`button`))
			control.setAttribute(
				`aria-pressed`,
				String(control.dataset[`action`] === `view-${view}`),
			)
		if (view === `list`) map.querySelector(`details`)!.open = true
	}
	for (const control of workspace.querySelectorAll(`button`))
		control.setAttribute(
			`aria-controls`,
			control.dataset[`action`] === `view-selection` ? inspector.id : map.id,
		)
	workspaceView(`graph`)
	const focusSelection = () => {
		workspaceView(`selection`)
		inspector.querySelector<HTMLElement>(`h2`)!.focus()
	}
	// Reuse at most 500 visible card slots across filters of one immutable capture.
	const cards: {
		group: SVGElement
		outline: SVGElement
		labels: SVGElement[]
		row: HTMLLIElement
		choose: HTMLButtonElement
	}[] = []
	const edgePaths: SVGElement[] = []
	const syncChildren = (parent: Element, children: Element[]) => {
		let next = parent.firstElementChild
		for (const child of children) {
			if (child === next) next = child.nextElementSibling
			else parent.insertBefore(child, next)
		}
		while (next) {
			const after = next.nextElementSibling
			next.remove()
			next = after
		}
	}
	let model: GraphModel | undefined,
		cancel = () => {},
		editorDispose = () => {},
		jobs = 0
	const element = <Tag extends keyof HTMLElementTagNameMap>(
		tag: Tag,
		text: string,
	): HTMLElementTagNameMap[Tag] => {
		const result = document.createElement(tag)
		result.textContent = text
		return result
	}
	const button = (text: string, action: string): HTMLButtonElement => {
		const result = element(`button`, text)
		result.type = `button`
		result.dataset[`action`] = action
		return result
	}
	const shape = (
		tag: string,
		attributes: Record<string, string>,
	): SVGElement => {
		const result = document.createElementNS(SVG, tag)
		for (const [name, value] of Object.entries(attributes))
			result.setAttribute(name, value)
		return result
	}
	const transform = () => {
		svg
			.querySelector(`.ecology-world`)
			?.setAttribute(
				`transform`,
				`translate(${context.pan.x} ${context.pan.y}) scale(${context.pan.zoom})`,
			)
	}
	const session = createSearchSession(
		panel,
		searchScope,
		() => {
			livePanel.dataset[`draftPinned`] = String(Boolean(session.pinned()))
		},
		(editor) => editorIsCurrent(store, editor),
	)
	const closeLive = () => {
		session.finish(null)
		editorDispose()
		editorDispose = () => {}
		live.replaceChildren()
		liveKey = undefined
		livePanel.hidden = true
	}
	const passive = () => {
		inspector.replaceChildren()
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		if (!selected) {
			inspector.append(
				element(
					`p`,
					context.selected
						? `Selection outside this captured snapshot`
						: `Select a node to inspect metadata without reading its value.`,
				),
			)
			return
		}
		const heading = element(`h2`, selected.key)
		heading.tabIndex = -1
		inspector.append(heading, element(`p`, selected.detail))
		const source = selected.source
		if (`memberKeys` in source) {
			inspector.append(
				element(
					`p`,
					`${source.memberCount}${source.countComplete ? `` : `+`} instantiated members`,
				),
				button(
					context.expanded.has(source.key) ? `Collapse family` : `Expand family`,
					`expand`,
				),
			)
		} else {
			inspector.append(
				element(
					`p`,
					`${source.type.startsWith(`readonly`) ? `Readonly` : `Writable`} ${source.kind}`,
				),
				element(
					`p`,
					`Dependencies: ${source.dependencies}${source.dependenciesTruncated ? ` (truncated)` : ``}`,
				),
				button(`Trace observed roots`, `trace`),
				button(`Open live editor (may read/evaluate)`, `live`),
			)
		}
		inspector.append(
			element(`p`, context.traceStatus),
			element(
				`p`,
				`Observed snapshot ${context.capturedAt}. Retained edges can be stale or partial; other dependencies may be unknown.`,
			),
		)
	}
	const select = (id: string, navigate = false) => {
		if (context.selected !== id) {
			context.trace.clear()
			context.traceStatus = `Not traced`
			for (const highlighted of svg.querySelectorAll(`.traced`))
				highlighted.classList.remove(`traced`)
		}
		context.selected = id
		for (const node of host.querySelectorAll<HTMLElement>(`[data-graph-id]`))
			node.setAttribute(`aria-pressed`, String(node.dataset[`graphId`] === id))
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
		counts.textContent = `${value.atoms} atoms · ${value.selectors} selectors · ${snapshot.families.length} families / ${value.members} members · showing ${value.items.length} of ${value.matching}${approximationLimited ? `+` : ``} matching groups/instances · ${value.edges.length} of ${snapshot.edges.length} captured edges`
		notice.textContent =
			snapshot.truncated.nodes ||
			snapshot.truncated.families ||
			snapshot.truncated.relations
				? `Capture truncated: full store totals unknown. Search covers captured metadata only. Captured counts above are exact.`
				: `Observed snapshot ${context.capturedAt}. Paint cap: 500 nodes / 1,000 edges. Search to narrow; expand families for members.`
		let world = svg.querySelector(`.ecology-world`)
		if (!world) {
			const defs = shape(`defs`, {}),
				arrow = shape(`marker`, {
					id: marker,
					markerWidth: `8`,
					markerHeight: `8`,
					refX: `9`,
					markerUnits: `userSpaceOnUse`,
					refY: `4`,
					orient: `auto`,
				})
			arrow.append(
				shape(`path`, { d: `M0 0 L8 4 L0 8 Z`, fill: `currentColor` }),
			)
			defs.append(arrow)
			world = shape(`g`, { class: `ecology-world` })
			world.append(
				shape(`g`, { class: `ecology-edges` }),
				shape(`g`, { class: `ecology-cards` }),
			)
			svg.append(defs, world)
		}
		const paths: Element[] = []
		for (const [index, edge] of value.edges.entries()) {
			const from = value.all.get(edge.from)!,
				to = value.all.get(edge.to)!
			const path = (edgePaths[index] ??= shape(`path`, {
				"marker-end": `url(#${marker})`,
			}))
			path.setAttribute(`d`, graphEdgePath(from, to))
			path.setAttribute(
				`class`,
				edge.traced ? `ecology-edge traced` : `ecology-edge`,
			)
			paths.push(path)
		}
		const nodes: Element[] = [],
			rows: Element[] = []
		for (const [index, item] of value.items.entries()) {
			const traced =
				item.kind === `family`
					? (item.source as { memberKeys: readonly string[] }).memberKeys.some(
							(key) => context.trace.has(key),
						)
					: context.trace.has(item.key)
			let card = cards[index]
			if (!card) {
				const group = shape(`g`, {
					role: `button`,
					tabindex: `0`,
				})

				const outline = shape(`path`, {}),
					labels = [
						shape(`text`, { x: `10`, y: `20` }),
						shape(`text`, { x: `10`, y: `39` }),
					]
				group.append(outline, ...labels)
				const row = element(`li`, ``),
					choose = button(``, `select`)
				row.append(choose)
				card = { group, outline, labels, row, choose }
				cards[index] = card
			}
			card.group.setAttribute(`data-graph-id`, item.id)
			card.group.setAttribute(`aria-label`, `${item.label} · ${item.detail}`)
			card.outline.setAttribute(
				`d`,
				item.kind === `selector`
					? `M12 0 L164 0 L176 26 L164 52 L12 52 L0 26 Z`
					: item.kind === `family`
						? `M8 0 H168 Q176 0 176 8 V44 Q176 52 168 52 H8 Q0 52 0 44 V8 Q0 0 8 0 Z`
						: `M0 0 H176 V52 H0 Z`,
			)
			for (const [offset, label] of [item.label, item.detail].entries()) {
				const text = card.labels[offset],
					caption = label.length > 23 ? `${label.slice(0, 22)}…` : label
				if (text.textContent !== caption) text.textContent = caption
			}
			const choose = card.choose
			choose.dataset[`graphId`] = item.id
			const caption = `${item.kind === `selector` ? `◇` : item.kind === `family` ? `▸` : `□`} ${item.label} · ${item.detail}`
			if (choose.textContent !== caption) choose.textContent = caption
			card.group.setAttribute(`transform`, `translate(${item.x} ${item.y})`)
			card.group.setAttribute(
				`class`,
				`ecology-node ${item.kind}${traced ? ` traced` : ``}`,
			)
			card.group.setAttribute(
				`aria-pressed`,
				String(item.id === context.selected),
			)
			card.choose.setAttribute(
				`aria-pressed`,
				String(item.id === context.selected),
			)
			nodes.push(card.group)
			rows.push(card.row)
		}
		host.dataset[`retainedCards`] = String(cards.length)
		syncChildren(world.children[0], paths)
		syncChildren(world.children[1], nodes)
		syncChildren(list, rows)
		transform()
		if (liveKey && definition(liveKey) !== liveDefinition) closeLive()
		passive()
		if (reveal) {
			const target = [
				...list.querySelectorAll<HTMLButtonElement>(`button`),
			].find((item) => item.dataset[`graphId`] === reveal)!
			list.closest(`details`)!.open = true
			if (compact()) focusSelection()
			else {
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
				...host.querySelectorAll<HTMLElement>(`[data-graph-id], [data-action]`),
			].find(
				(candidate) =>
					candidate.tagName === focused.tagName &&
					(focusId
						? candidate.dataset[`graphId`] === focusId
						: candidate.dataset[`action`] === focusAction),
			)
			if (target) target.focus()
			else input.focus()
		}
		host.dataset[`commitMs`] = String(performance.now() - start)
		busy = false
		results.removeAttribute(`aria-busy`)
		host.dataset[`ready`] = `true`
	}
	const project = () => {
		cancel()
		if (!visible() || !context.snapshot) return
		host.dataset[`ready`] = `false`
		cancel = scheduleGraph(
			projectEcology(context.snapshot, context, matchedIds, model),
			paint,
			undefined,
			undefined,
			2,
		)
	}
	const search = () => {
		context.query = input.value
		cancelMatch()
		cancel()
		if (preparing || !searchIndex || !visible()) return
		busy = true
		host.dataset[`ready`] = `false`
		results.setAttribute(`aria-busy`, `true`)
		const ids = new Set<string>(),
			started = performance.now()
		cancelMatch = scheduleGraph(
			matchStateSearch(searchIndex, context.query, 2_000_000, ids),
			(next, chunks) => {
				host.dataset[`matchMs`] = String(performance.now() - started)
				host.dataset[`maxMatchChunkMs`] = String(Math.max(...chunks))
				if (next.validation) {
					searchStatus.textContent = next.validation
					busy = false
					results.removeAttribute(`aria-busy`)
					host.dataset[`ready`] = `true`
					return
				}
				matchedIds = context.query.trim() ? ids : undefined
				approximationLimited = next.approximateLimited
				const fragment = document.createDocumentFragment()
				for (const hit of next.hits) {
					const row = element(`li`, ``),
						target = button(``, `result`)
					target.dataset[`resultId`] = hit.document.id
					target.setAttribute(`aria-label`, hit.document.key)
					let from = 0
					for (const [start, end] of hit.ranges) {
						target.append(
							document.createTextNode(hit.document.label.slice(from, start)),
						)
						target.append(element(`mark`, hit.document.label.slice(start, end)))
						from = end
					}
					target.append(document.createTextNode(hit.document.label.slice(from)))
					row.append(
						target,
						element(
							`small`,
							`${hit.document.detail}${hit.approximate ? ` · approximate match` : ``}`,
						),
					)
					fragment.append(row)
				}
				results.replaceChildren(fragment)
				searchStatus.textContent = `${context.query.trim() ? `${next.matching}${next.approximateLimited ? `+` : ``} matching captured records; ${next.hits.length} ranked results. ` : ``}Metadata only.${searchIndex!.truncatedText ? ` ${searchIndex!.truncatedText} text prefixes truncated.` : ``}${next.approximateLimited ? ` Approximate search limited; refine the query.` : ``}`
				project()
			},
			undefined,
			undefined,
			2,
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
		results.setAttribute(`aria-busy`, `true`)
		if (store.on.transactionApplying.state !== null) {
			searchStatus.textContent = `Waiting for the current transaction to commit.`
			wait = store.on.transactionApplying.subscribe(
				`ecology-search-${marker}`,
				(applying) => {
					if (applying === null) refresh()
				},
			)
			return
		}
		const start = performance.now()
		cards.length = 0
		edgePaths.length = 0
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
			context.trace.clear()
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
				liveLabel.textContent = `Editing ${liveKey} — kept visible during search`
				livePanel.hidden = false
				editorDispose = openEditor(liveKey, live)
			}
			live.querySelector<HTMLElement>(`input, button`)?.focus()
			return
		}
		if (name === `back`) {
			closeLive()
			passive()
			workspaceView(`selection`)
			const target =
				inspector.querySelector<HTMLElement>(`[data-action="live"]`) ?? inspector
			target.focus()
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
		if (target.closest(`.ecology-live`)) return
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
				context.trace.clear()
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
	return () => {
		disposed = true
		cancelIndex()
		cancelMatch()
		wait()
		cards.length = 0
		edgePaths.length = 0
		visibility.disconnect()
		session.dispose()
		cancel()
		editorDispose()
		host.removeEventListener(`click`, click)
		panel.removeEventListener(`keydown`, key)
		input.removeEventListener(`input`, inputChange)
		input.removeEventListener(`compositionend`, search)
		host.querySelector(`form`)!.removeEventListener(`submit`, submit)
	}
}
