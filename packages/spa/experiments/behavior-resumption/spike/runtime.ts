import type { RegularAtomToken } from "atom.io"
import {
	createRegularAtom,
	getFromStore,
	setIntoStore,
	Store,
	subscribeToState,
} from "atom.io/internal"

import { readCapture, readSnapshot, validateId } from "./schema.ts"

export interface ResumedCell {
	get(): number
	set(next: number | ((value: number) => number)): void
}

interface Stats {
	stores: number
	cells: number
	bindings: number
	handlerCalls: number
	domWrites: number
}
declare global {
	interface Window {
		__resumeStats?: Stats
	}
}

// No store, atom, DOM scan or component execution when this module is evaluated.
let store: Store | undefined
const cells = new Map<string, ResumedCell>()
const stats: Stats = {
	stores: 0,
	cells: 0,
	bindings: 0,
	handlerCalls: 0,
	domWrites: 0,
}
window.__resumeStats = stats

function resumeCell(id: string): ResumedCell {
	validateId(id)
	const existing = cells.get(id)
	if (existing) return existing
	const script = document.getElementById(`resume-state-${id}`)
	if (
		!(script instanceof HTMLScriptElement) ||
		script.type !== `application/json`
	) {
		throw new Error(`resume: missing cell ${id}`)
	}
	const snapshot = readSnapshot(script.textContent ?? ``)
	// Bind only dedicated numeric text containers. Preserve SSR comments and node identity.
	const nodes = snapshot.text.map((targetId) => {
		const target = document.getElementById(targetId)
		if (!target || target.children.length > 0)
			throw new Error(`resume: invalid text target ${targetId}`)
		const text = [...target.childNodes].filter(
			(node) => node.nodeType === Node.TEXT_NODE,
		)
		if (text.length !== 1 || target.textContent !== String(snapshot.value)) {
			throw new Error(`resume: stale text target ${targetId}`)
		}
		return text[0] as Text
	})
	if (!store) {
		store = new Store({
			name: `resume-spike-client`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		stats.stores++
	}
	const boundStore = store
	const token: RegularAtomToken<number> = createRegularAtom(
		boundStore,
		{
			key: id,
			default: snapshot.value,
		},
		undefined,
	)
	subscribeToState(boundStore, token, `resume:text:${id}`, ({ newValue }) => {
		for (const node of nodes) {
			if (node.isConnected && node.data !== String(newValue)) {
				node.data = String(newValue)
				stats.domWrites++
			}
		}
	})
	stats.cells++
	stats.bindings += nodes.length
	const cell: ResumedCell = {
		get: () => getFromStore(boundStore, token),
		set: (next) => {
			const value =
				typeof next === `function` ? next(getFromStore(boundStore, token)) : next
			if (!Number.isFinite(value))
				throw new Error(`resume: expected a finite number`)
			setIntoStore(boundStore, token, value)
		},
	}
	cells.set(id, cell)
	return cell
}

/** Explicit captured references, not serialized arbitrary JS closures. */
export function capture(element: Element): ResumedCell[] {
	stats.handlerCalls++
	return readCapture(element.getAttribute(`data-resume-capture`) ?? ``).map(
		resumeCell,
	)
}
