import type {
	disposeState,
	editRelations,
	findRelations,
	findState,
	getInternalRelations,
	getState,
	resetState,
	setState,
	TransactionToken,
} from "atom.io"
import { MapOverlay } from "atom.io/foundations/overlays"

import { arbitrary } from "../arbitrary.ts"
import { disposeFromStore, findInStore } from "../families/index.ts"
import { getEnvironmentData } from "../get-environment-data.ts"
import { getFromStore } from "../get-state/index.ts"
import {
	editRelationsInStore,
	findRelationsInStore,
	getInternalRelationsFromStore,
} from "../join/index.ts"
import { newest } from "../lineage.ts"
import { getJsonTokenFromStore } from "../mutable/index.ts"
import { resetInStore, setIntoStore } from "../set-state/index.ts"
import type { Fn } from "../utility-types.ts"
import { actUponStore } from "./act-upon-store.ts"
import { getEpochNumberOfAction } from "./get-epoch-number.ts"
import type { ChildStore, RootStore } from "./is-root-store.ts"
import { isRootStore } from "./is-root-store.ts"
import { getQueuedTransactionBase } from "./transaction-commit-context.ts"
import type { TransactionProgress } from "./transaction-meta-progress.ts"

export function buildTransaction(
	store: RootStore,
	token: TransactionToken<any>,
	params: any[],
	id: string,
): ChildStore {
	const parent = newest(store)
	const base = isRootStore(parent)
		? (getQueuedTransactionBase(store) ?? parent)
		: parent
	const childBase: Omit<ChildStore, `transactionMeta`> = {
		parent,
		child: null,
		on: base.on,
		loggers: base.loggers,
		logger: base.logger,
		config: base.config,
		atoms: new MapOverlay(base.atoms),
		atomsThatAreDefault: new Set(base.atomsThatAreDefault),
		families: new MapOverlay(base.families),
		joins: new MapOverlay(base.joins),
		operation: { open: false },
		readonlySelectors: new MapOverlay(base.readonlySelectors),
		timelines: new MapOverlay(base.timelines),
		timelineTopics: base.timelineTopics.overlay(),
		trackers: new Map(),
		transactions: new MapOverlay(base.transactions),
		selectorAtoms: base.selectorAtoms.overlay(),
		selectorGraph: base.selectorGraph.overlay(),
		writableSelectors: new MapOverlay(base.writableSelectors),
		valueMap: new MapOverlay(base.valueMap),
		defaults: base.defaults,
		disposalTraces: store.disposalTraces.copy(),
		molecules: new MapOverlay(base.molecules),
		moleculeGraph: base.moleculeGraph.overlay(),
		moleculeData: base.moleculeData.overlay(),
		keyRefsInJoins: base.keyRefsInJoins.overlay(),
		miscResources: new MapOverlay(base.miscResources),
	}
	const epoch = getEpochNumberOfAction(store, token.key)

	const transactionMeta: TransactionProgress<Fn> = {
		phase: `building`,
		update: {
			type: `transaction_outcome`,
			token,
			id,
			epoch: epoch === undefined ? Number.NaN : epoch + 1,
			timestamp: Date.now(),
			subEvents: [],
			params,
			output: undefined,
		},
		toolkit: {
			get: ((...ps: Parameters<typeof getState>) =>
				getFromStore(child, ...ps)) as typeof getState,
			set: ((...ps: Parameters<typeof setState>) => {
				setIntoStore(child, ...ps)
			}) as typeof setState,
			reset: ((...ps: Parameters<typeof resetState>) => {
				resetInStore(child, ...ps)
			}) as typeof resetState,
			run: (t, identifier = arbitrary()) => actUponStore(child, t, identifier),
			find: ((...ps: Parameters<typeof findState>) =>
				findInStore(store, ...ps)) as typeof findState,
			json: (t) => getJsonTokenFromStore(child, t),
			dispose: ((...ps: Parameters<typeof disposeState>) => {
				disposeFromStore(child, ...ps)
			}) as typeof disposeState,
			env: () => getEnvironmentData(child),
			relations: {
				edit: ((...ps: Parameters<typeof editRelations>) => {
					editRelationsInStore(child, ...ps)
				}) as typeof editRelations,
				find: ((...ps: Parameters<typeof findRelations>) => {
					return findRelationsInStore(child, ...ps)
				}) as typeof findRelations,
				internal: ((...ps: Parameters<typeof getInternalRelations>) => {
					return getInternalRelationsFromStore(child, ...ps)
				}) as typeof getInternalRelations,
			},
		},
	}
	const child: ChildStore = Object.assign(childBase, {
		transactionMeta,
	})
	parent.child = child
	try {
		store.logger.info(
			`🛫`,
			`transaction`,
			token.key,
			`building with params:`,
			params,
		)
	} catch (error) {
		parent.child = null
		throw error
	}
	return child
}
