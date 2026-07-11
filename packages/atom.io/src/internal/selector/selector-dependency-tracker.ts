import type { Store } from "../store/index.ts"

export class SelectorDependencyTracker {
	public readonly covered: Set<string> = new Set()

	private readonly directDependencies = new Set<string>()
	private readonly rootAtoms = new Set<string>()
	private readonly selectorKey: string

	public constructor(selectorKey: string) {
		this.selectorKey = selectorKey
	}

	public begin(): void {
		this.covered.clear()
		this.directDependencies.clear()
		this.rootAtoms.clear()
	}

	public recordDirectDependency(target: Store, dependencyKey: string): void {
		this.directDependencies.add(dependencyKey)
		if (
			target.selectorGraph.getContent(dependencyKey, this.selectorKey)
				?.source === dependencyKey
		) {
			return
		}
		target.selectorGraph.set(dependencyKey, this.selectorKey, {
			source: dependencyKey,
		})
	}

	public recordRootAtom(target: Store, atomKey: string): void {
		this.rootAtoms.add(atomKey)
		if (!target.selectorAtoms.has(this.selectorKey, atomKey)) {
			target.selectorAtoms.set(this.selectorKey, atomKey)
		}
	}

	public finish(target: Store): void {
		const previousDependencies = target.selectorGraph.getRelationEntries({
			downstreamSelectorKey: this.selectorKey,
		})
		for (const [dependencyKey, { source }] of previousDependencies) {
			if (
				source !== this.selectorKey &&
				!this.directDependencies.has(dependencyKey)
			) {
				target.selectorGraph.delete(dependencyKey, this.selectorKey)
			}
		}

		const previousRootAtoms = target.selectorAtoms.getRelatedKeys(this.selectorKey)
		if (previousRootAtoms) {
			for (const atomKey of previousRootAtoms) {
				if (!this.rootAtoms.has(atomKey)) {
					target.selectorAtoms.delete(this.selectorKey, atomKey)
				}
			}
		}
	}
}
