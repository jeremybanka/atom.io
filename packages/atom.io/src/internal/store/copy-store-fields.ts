import type { Store } from "./store.ts"

// Reset from a fresh Store without replacing references held by callers.
// Keep this in sync with Store's own fields; copy-store-fields.test.ts checks it.
export function copyStoreFields(target: Store, source: Store): void {
	target.parent = source.parent
	target.child = source.child
	target.valueMap = source.valueMap
	target.defaults = source.defaults
	target.atoms = source.atoms
	target.writableSelectors = source.writableSelectors
	target.readonlySelectors = source.readonlySelectors
	target.atomsThatAreDefault = source.atomsThatAreDefault
	target.selectorAtoms = source.selectorAtoms
	target.selectorGraph = source.selectorGraph
	target.trackers = source.trackers
	target.families = source.families
	target.joins = source.joins
	target.transactions = source.transactions
	target.transactionMeta = source.transactionMeta
	target.timelines = source.timelines
	target.timelineFamilies = source.timelineFamilies
	target.timelineTopics = source.timelineTopics
	target.disposalTraces = source.disposalTraces
	target.molecules = source.molecules
	target.moleculeGraph = source.moleculeGraph
	target.moleculeData = source.moleculeData
	target.keyRefsInJoins = source.keyRefsInJoins
	target.miscResources = source.miscResources
	target.on = source.on
	target.operation = source.operation
	target.config = source.config
	target.loggers = source.loggers
	target.logger = source.logger
}
