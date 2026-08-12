type Inspector = {
	label: string
	read: () => unknown
}

const stringify = (value: unknown): string => {
	try {
		const result = JSON.stringify(value, null, 2)
		return result === undefined ? String(value) : result
	} catch (error) {
		return `[inspection failed: ${String(error)}]`
	}
}

/** A collection of lazily evaluated state selectors used only on failure. */
export class RealtimeTestInspectors {
	readonly #inspectors = new Set<Inspector>()

	/** Register selected application state for timeout diagnostics. */
	register(label: string, read: () => unknown): () => void {
		const inspector = { label, read }
		this.#inspectors.add(inspector)
		return () => this.#inspectors.delete(inspector)
	}

	/** Render all registered selectors without allowing one failed selector to hide others. */
	transcript(): string {
		if (this.#inspectors.size === 0) return `[no selected state registered]`
		return [...this.#inspectors]
			.map(({ label, read }) => {
				try {
					return `${label}: ${stringify(read())}`
				} catch (error) {
					return `${label}: [inspection threw: ${String(error)}]`
				}
			})
			.join(`\n`)
	}
}
