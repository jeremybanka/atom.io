import type { findState } from "atom.io"
import type { RootStore } from "atom.io/internal"
import {
	actUponStore,
	arbitrary,
	clearTimelineInStore,
	createMutableAtom,
	createMutableAtomFamily,
	createRegularAtom,
	createRegularAtomFamily,
	createSelectorFamily,
	createStandaloneSelector,
	createTimeline,
	createTimelineFamily,
	createTransaction,
	disposeFromStore,
	disposeTimelineInStore,
	findInStore,
	findTimelineInStore,
	getFromStore,
	IMPLICIT,
	inspectTimelineInStore,
	installIntoStore,
	resetInStore,
	setIntoStore,
	Store,
	subscribeInStore,
	timeTravel,
} from "atom.io/internal"

import type {
	AtomIOToken,
	clearTimeline,
	disposeState,
	disposeTimeline,
	findTimeline,
	getState,
	inspectTimeline,
	redo,
	setState,
	subscribe,
	timeline,
	timelineFamily,
	undo,
} from "."
import type { atom, atomFamily, mutableAtom, mutableAtomFamily } from "./atom.ts"
import type { resetState } from "./reset-state.ts"
import type { selector, selectorFamily } from "./selector.ts"
import type { runTransaction, transaction } from "./transaction.ts"

export class Silo {
	public store: RootStore
	public atom: typeof atom
	public mutableAtom: typeof mutableAtom
	public atomFamily: typeof atomFamily
	public mutableAtomFamily: typeof mutableAtomFamily
	public selector: typeof selector
	public selectorFamily: typeof selectorFamily
	public transaction: typeof transaction
	public timeline: typeof timeline
	/** {@link timelineFamily}, bound to this Silo's store. */
	public timelineFamily: typeof timelineFamily
	public findState: typeof findState
	/** {@link findTimeline}, bound to this Silo's store. */
	public findTimeline: typeof findTimeline
	public getState: typeof getState
	public setState: typeof setState
	public resetState: typeof resetState
	public disposeState: typeof disposeState
	public subscribe: typeof subscribe
	public undo: typeof undo
	public redo: typeof redo
	public clearTimeline: typeof clearTimeline
	/** {@link inspectTimeline}, bound to this Silo's store. */
	public inspectTimeline: typeof inspectTimeline
	/** {@link disposeTimeline}, bound to this Silo's store. */
	public disposeTimeline: typeof disposeTimeline
	public runTransaction: typeof runTransaction
	public install: (tokens: AtomIOToken[], store?: RootStore) => void

	public constructor(config: Store[`config`], fromStore: Store | null = null) {
		const s = (this.store = new Store(config, fromStore) as RootStore)
		this.atom = ((options: Parameters<typeof atom>[0]) =>
			createRegularAtom(s, options, undefined)) as typeof atom
		this.mutableAtom = (options: Parameters<typeof mutableAtom>[0]) =>
			createMutableAtom(s, options, undefined)
		this.atomFamily = ((options: Parameters<typeof atomFamily>[0]) =>
			createRegularAtomFamily(s, options)) as typeof atomFamily
		this.mutableAtomFamily = ((
			options: Parameters<typeof mutableAtomFamily>[0],
		) => createMutableAtomFamily(s, options)) as typeof mutableAtomFamily
		this.selector = ((options: Parameters<typeof selector>[0]) =>
			createStandaloneSelector(s, options)) as typeof selector
		this.selectorFamily = ((options: Parameters<typeof selectorFamily>[0]) =>
			createSelectorFamily(s, options)) as typeof selectorFamily
		this.transaction = (options) => createTransaction(s, options)
		this.timeline = (options) => createTimeline(s, options)
		this.timelineFamily = ((options: Parameters<typeof timelineFamily>[0]) =>
			createTimelineFamily(s, options)) as typeof timelineFamily
		this.findState = ((...params: Parameters<typeof findState>) =>
			findInStore(s, ...params)) as typeof findState
		this.findTimeline = ((family: any, key: any) =>
			findTimelineInStore(s, family, key)) as typeof findTimeline
		this.getState = ((...params: Parameters<typeof getState>) =>
			getFromStore(s, ...params)) as typeof getState
		this.setState = ((...params: Parameters<typeof setState>) => {
			setIntoStore(s, ...params)
		}) as typeof setState
		this.resetState = ((...params: Parameters<typeof resetState>) => {
			resetInStore(s, ...params)
		}) as typeof resetState
		this.disposeState = ((...params: Parameters<typeof disposeState>) => {
			disposeFromStore(s, ...params)
		}) as typeof disposeState
		this.subscribe = ((...params: [any, any, any?] | [any, any, any, any?]) => {
			if (params[0].type === `timeline_family`) {
				return subscribeInStore(s, params[0], params[1], params[2], params[3])
			}
			return subscribeInStore(s, params[0], params[1], params[2])
		}) as typeof subscribe
		const resolveTimeline = (params: readonly [any] | readonly [any, any]) =>
			params.length === 1
				? params[0]
				: findTimelineInStore(s, params[0], params[1])
		this.undo = ((...params: [any] | [any, any]) => {
			timeTravel(s, `undo`, resolveTimeline(params))
		}) as typeof undo
		this.redo = ((...params: [any] | [any, any]) => {
			timeTravel(s, `redo`, resolveTimeline(params))
		}) as typeof redo
		this.clearTimeline = ((...params: [any] | [any, any]) => {
			clearTimelineInStore(s, resolveTimeline(params))
		}) as typeof clearTimeline
		this.inspectTimeline = ((...params: [any] | [any, any]) =>
			inspectTimelineInStore(
				s,
				resolveTimeline(params),
			)) as typeof inspectTimeline
		this.disposeTimeline = ((...params: [any] | [any, any]) => {
			if (params.length === 1) {
				disposeTimelineInStore(s, params[0])
			} else {
				disposeTimelineInStore(s, params[0], params[1])
			}
		}) as typeof disposeTimeline
		this.runTransaction = (token, id = arbitrary()) => actUponStore(s, token, id)
		this.install = (tokens, source = IMPLICIT.STORE) => {
			installIntoStore(tokens, s, source)
		}
	}
}
