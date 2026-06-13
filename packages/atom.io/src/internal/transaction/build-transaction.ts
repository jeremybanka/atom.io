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
import type { TransactionProgress } from "./transaction-meta-progress.ts"

export function buildTransaction(
	store: RootStore,
	token: TransactionToken<any>,
	params: any[],
	id: string,
): ChildStore {
	const parent = newest(store)
	const childBase: Omit<ChildStore, `transactionMeta`> = {
		parent,
		child: null,
		on: parent.on,
		loggers: parent.loggers,
		logger: parent.logger,
		config: parent.config,
		atoms: new MapOverlay(parent.atoms),
		atomsThatAreDefault: new Set(parent.atomsThatAreDefault),
		families: new MapOverlay(parent.families),
		joins: new MapOverlay(parent.joins),
		operation: { open: false },
		readonlySelectors: new MapOverlay(parent.readonlySelectors),
		timelines: new MapOverlay(parent.timelines),
		timelineTopics: parent.timelineTopics.overlay(),
		trackers: new Map(),
		transactions: new MapOverlay(parent.transactions),
		selectorAtoms: parent.selectorAtoms.overlay(),
		selectorGraph: parent.selectorGraph.overlay(),
		writableSelectors: new MapOverlay(parent.writableSelectors),
		valueMap: new MapOverlay(parent.valueMap),
		defaults: parent.defaults,
		disposalTraces: store.disposalTraces.copy(),
		molecules: new MapOverlay(parent.molecules),
		moleculeGraph: parent.moleculeGraph.overlay(),
		moleculeData: parent.moleculeData.overlay(),
		keyRefsInJoins: parent.keyRefsInJoins.overlay(),
		miscResources: new MapOverlay(parent.miscResources),
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
	store.logger.info(
		`🛫`,
		`transaction`,
		token.key,
		`building with params:`,
		params,
	)
	return child
}
