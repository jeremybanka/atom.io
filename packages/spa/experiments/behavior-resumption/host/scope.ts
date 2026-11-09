import { readCell, textTargets } from "./dom.ts"
import { readCapture } from "./schema.ts"

export interface NumericState {
	get(): number
	set(value: number): void
	subscribe(write: (value: number) => void): () => void
}
/** One private state owner per behavior scope. No existing-store interop is implied. */
export interface StateAdapter {
	create(id: string, value: number): NumericState
	dispose(): void
}
export interface ResumedCell {
	get(): number
	set(next: number | ((value: number) => number)): void
}
export interface BehaviorStats {
	cells: number
	bindings: number
	handlerCalls: number
	domWrites: number
}
export interface BehaviorScope {
	capture(element: Element): ResumedCell[]
	dispose(): void
}
/** The host owns harvesting, binding and cleanup; the injected adapter owns state. */
export function createBehaviorScope(
	document: Document,
	state: StateAdapter,
	stats: BehaviorStats,
): BehaviorScope {
	const cells = new Map<string, ResumedCell>()
	const subscriptions: (() => void)[] = []
	let disposed = false
	const assertActive = () => {
		if (disposed) throw new Error(`resume: disposed behavior scope`)
	}
	function resumeCell(id: string): ResumedCell {
		const existing = cells.get(id)
		if (existing) return existing
		const snapshot = readCell(document, id)
		const nodes = textTargets(document, snapshot)
		const value = state.create(id, snapshot.value)
		subscriptions.push(
			value.subscribe((next) => {
				if (disposed) return
				for (const node of nodes) {
					if (node.isConnected && node.data !== String(next)) {
						node.data = String(next)
						stats.domWrites++
					}
				}
			}),
		)
		stats.cells++
		stats.bindings += nodes.length
		const cell: ResumedCell = {
			get() {
				assertActive()
				return value.get()
			},
			set(next) {
				assertActive()
				const result = typeof next === `function` ? next(value.get()) : next
				if (!Number.isFinite(result))
					throw new Error(`resume: expected a finite number`)
				value.set(result)
			},
		}
		cells.set(id, cell)
		return cell
	}
	return {
		capture(element) {
			assertActive()
			if (element.ownerDocument !== document)
				throw new Error(`resume: wrong document owner`)
			stats.handlerCalls++
			return readCapture(element.getAttribute(`data-resume-capture`) ?? ``).map(
				resumeCell,
			)
		},
		dispose() {
			if (disposed) return
			disposed = true
			const errors: unknown[] = []
			for (const unsubscribe of subscriptions) {
				try {
					unsubscribe()
				} catch (error) {
					errors.push(error)
				}
			}
			subscriptions.length = 0
			cells.clear()
			try {
				state.dispose()
			} catch (error) {
				errors.push(error)
			}
			if (errors.length)
				throw new AggregateError(errors, `resume: cleanup failed`)
		},
	}
}
