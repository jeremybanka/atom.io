import type { RootStore } from "atom.io/internal"

import { captureEcologySnapshot, traceEcologyRoots } from "./ecology.ts"
import type { GraphContext, GraphModel } from "./ecology-graph.ts"
import { graphEdgePath, projectEcology, scheduleGraph } from "./ecology-graph.ts"

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
	host.innerHTML = `<form class="ecology-tools"><input aria-label="Search ecology" placeholder="Search keys, families, types"><button type="button" data-action="refresh">Refresh</button><button type="button" data-action="clear">Clear selection</button><button type="button" data-action="fit">Fit</button><button type="button" data-action="reset">Reset view</button></form><p class="ecology-counts" role="status"></p><p class="ecology-notice"></p><p class="ecology-legend">□ atom · ⬡ selector · dashed group: family · arrows: dependency → dependent · blue: traced path</p><section class="ecology-body"><section class="ecology-map"><nav aria-label="Graph navigation"><button type="button" data-action="left" aria-label="Pan left">←</button><button type="button" data-action="right" aria-label="Pan right">→</button><button type="button" data-action="up" aria-label="Pan up">↑</button><button type="button" data-action="down" aria-label="Pan down">↓</button><button type="button" data-action="in" aria-label="Zoom in">+</button><button type="button" data-action="out" aria-label="Zoom out">−</button></nav><svg role="group" aria-label="Observed dependency graph"></svg><details><summary>Accessible node list</summary><ul class="ecology-list"></ul></details></section><aside class="ecology-inspector" aria-label="Passive ecology inspector"></aside></section>`
	const input = host.querySelector(`input`)!
	input.value = context.query
	const counts = host.querySelector<HTMLElement>(`.ecology-counts`)!
	const notice = host.querySelector<HTMLElement>(`.ecology-notice`)!
	const inspector = host.querySelector<HTMLElement>(`.ecology-inspector`)!
	const svg = host.querySelector<SVGSVGElement>(`svg`)!
	const list = host.querySelector<HTMLElement>(`.ecology-list`)!
	const marker = `ecology-arrow-${nextMarker++}`
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
	const passive = () => {
		editorDispose()
		editorDispose = () => {}
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
		inspector.append(element(`h2`, selected.key), element(`p`, selected.detail))
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
	const select = (id: string) => {
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
		counts.textContent = `${value.atoms} atoms · ${value.selectors} selectors · ${snapshot.families.length} families / ${value.members} members · showing ${value.items.length} of ${value.matching} matching groups/instances · ${value.edges.length} of ${snapshot.edges.length} captured edges`
		notice.textContent =
			snapshot.truncated.nodes ||
			snapshot.truncated.families ||
			snapshot.truncated.relations
				? `Capture truncated: full store totals unknown. Search narrows the painted snapshot only. Captured counts above are exact.`
				: `Observed snapshot ${context.capturedAt}. Paint cap: 500 nodes / 1,000 edges. Search to narrow; expand families for members.`
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
		arrow.append(shape(`path`, { d: `M0 0 L8 4 L0 8 Z`, fill: `currentColor` }))
		defs.append(arrow)
		const world = shape(`g`, { class: `ecology-world` })
		for (const edge of value.edges) {
			const from = value.all.get(edge.from)!,
				to = value.all.get(edge.to)!
			world.append(
				shape(`path`, {
					d: graphEdgePath(from, to),
					class: edge.traced ? `ecology-edge traced` : `ecology-edge`,
					"marker-end": `url(#${marker})`,
				}),
			)
		}
		const fragment = document.createDocumentFragment()
		for (const item of value.items) {
			const traced =
				item.kind === `family`
					? (item.source as { memberKeys: readonly string[] }).memberKeys.some(
							(key) => context.trace.has(key),
						)
					: context.trace.has(item.key)
			const group = shape(`g`, {
				transform: `translate(${item.x} ${item.y})`,
				class: `ecology-node ${item.kind}${traced ? ` traced` : ``}`,
				role: `button`,
				tabindex: `0`,
				"aria-label": `${item.label} · ${item.detail}`,
				"aria-pressed": String(item.id === context.selected),
				"data-graph-id": item.id,
			})
			group.append(
				item.kind === `selector`
					? shape(`path`, { d: `M12 0 L164 0 L176 26 L164 52 L12 52 L0 26 Z` })
					: shape(`rect`, {
							width: `176`,
							height: `52`,
							rx: item.kind === `family` ? `8` : `3`,
						}),
			)
			for (const [label, y] of [
				[item.label, 20],
				[item.detail, 39],
			] as const) {
				const text = shape(`text`, { x: `10`, y: String(y) })
				text.textContent = label.length > 23 ? `${label.slice(0, 22)}…` : label
				group.append(text)
			}
			world.append(group)
			const row = element(`li`, ``),
				choose = button(
					`${item.kind === `selector` ? `◇` : item.kind === `family` ? `▸` : `□`} ${item.label} · ${item.detail}`,
					`select`,
				)
			choose.dataset[`graphId`] = item.id
			choose.setAttribute(`aria-pressed`, String(item.id === context.selected))
			row.append(choose)
			fragment.append(row)
		}
		svg.replaceChildren(defs, world)
		list.replaceChildren(fragment)
		transform()
		passive()
		if ((focusId || focusAction) && !focused.isConnected) {
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
		host.dataset[`ready`] = `true`
	}
	const project = () => {
		cancel()
		host.dataset[`ready`] = `false`
		cancel = scheduleGraph(projectEcology(context.snapshot!, context), paint)
	}
	const refresh = () => {
		cancel()
		const start = performance.now()
		context.snapshot = captureEcologySnapshot(store, {
			maxNodes: 10_000,
			maxFamilies: 10_000,
			maxRelations: 50_000,
		})
		context.capturedAt = new Date().toLocaleTimeString()
		host.dataset[`snapshotMs`] = String(performance.now() - start)
		project()
	}
	const action = (name: string) => {
		const selected = context.selected
			? model?.all.get(context.selected)
			: undefined
		if (name === `refresh`) {
			refresh()
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
			editorDispose()
			inspector.replaceChildren(button(`Back to passive inspector`, `back`))
			const target = element(`section`, ``)
			target.className = `ecology-live`
			inspector.append(target)
			editorDispose = openEditor(selected.key, target)
			return
		}
		if (name === `back`) {
			passive()
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
		if (target.dataset[`graphId`]) select(target.dataset[`graphId`])
		else action(target.dataset[`action`]!)
	}
	const search = () => {
		context.query = input.value
		project()
	}
	const key = (event: KeyboardEvent) => {
		if ((event.target as Element).closest(`.ecology-live`)) return
		if (event.key === `Escape`) {
			event.preventDefault()
			context.trace.clear()
			context.traceStatus = `Not traced`
			project()
		}
		const id = (event.target as Element).closest<HTMLElement>(`g[data-graph-id]`)
			?.dataset[`graphId`]
		if (id && (event.key === `Enter` || event.key === ` `)) {
			event.preventDefault()
			select(id)
		}
	}
	const submit = (event: Event) => {
		event.preventDefault()
	}
	host.addEventListener(`click`, click)
	host.addEventListener(`keydown`, key)
	input.addEventListener(`input`, search)
	host.querySelector(`form`)!.addEventListener(`submit`, submit)
	refresh()
	return () => {
		cancel()
		editorDispose()
		host.removeEventListener(`click`, click)
		host.removeEventListener(`keydown`, key)
		input.removeEventListener(`input`, search)
		host.querySelector(`form`)!.removeEventListener(`submit`, submit)
	}
}
