import type {
	AtomLifecycleEvent,
	AtomToken,
	FamilyMetadata,
	TimelineFamilyOptions,
	TimelineFamilyScope,
	TimelineFamilyToken,
	TimelineManageable,
	TimelineToken,
} from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { parseJson, stringifyJson } from "atom.io/foundations/json"
import type { Subject } from "atom.io/foundations/subject"

import { newest } from "../lineage.ts"
import { getUpdateToken } from "../mutable/index.ts"
import { deposit, type Store, withdraw } from "../store/index.ts"
import type { RootStore } from "../transaction/index.ts"
import { isChildStore } from "../transaction/index.ts"
import {
	addAtomToTimeline,
	createTimeline,
	handleStateLifecycleEvent,
	type Timeline,
} from "./create-timeline.ts"

export type TimelineFamily<K extends Canonical, M extends TimelineManageable> = {
	type: `timeline_family`
	key: string
	install: (store: RootStore) => void
	options: TimelineFamilyOptions<K>
	routes: Map<string, TimelineFamilyScope<K, any, any>>
	routedAtoms: Map<string, Map<string, AtomToken<any, any, any>>>
	subscriptions: Map<string, () => void>
	create: <Key extends K>(key: Key, data?: Timeline<M>) => TimelineToken<M, Key>
}

function timelineMemberIdentity<K extends Canonical>(
	familyKey: string,
	key: K,
): { family: FamilyMetadata<K>; key: string; subKey: string } {
	const subKey = stringifyJson(key)
	return {
		family: { key: familyKey, subKey },
		key: `${familyKey}(${subKey})`,
		subKey,
	}
}

function timelineTopicKey(
	store: Store,
	token: AtomToken<any, any, any>,
): string {
	if (token.type === `mutable_atom`) {
		return getUpdateToken(withdraw(store, token)).key
	}
	return token.key
}

function routeAtom<K extends Canonical, M extends TimelineManageable>(
	store: RootStore,
	family: TimelineFamily<K, M>,
	event: AtomLifecycleEvent<AtomToken<any, any, any>>,
): void {
	const target = newest(store)
	if (isChildStore(target)) {
		return
	}
	const atomToken = event.token
	const atomFamily = atomToken.family
	if (!atomFamily) {
		return
	}
	const route = family.routes.get(atomFamily.key)
	if (!route) {
		return
	}
	const memberKey = parseJson(atomFamily.subKey)
	const timelineKey = route.timelineKey(memberKey)
	if (timelineKey === undefined) {
		return
	}
	const { key: fullTimelineKey, subKey } = timelineMemberIdentity(
		family.key,
		timelineKey,
	)
	let bucket = family.routedAtoms.get(subKey)
	if (event.type === `atom_creation`) {
		if (!bucket) {
			bucket = new Map()
			family.routedAtoms.set(subKey, bucket)
		}
		bucket.set(atomToken.key, atomToken)
	}

	const timeline = target.timelines.get(fullTimelineKey)
	if (timeline) {
		handleStateLifecycleEvent(store, event, timeline)
	}

	if (event.type === `atom_disposal`) {
		bucket?.delete(atomToken.key)
		if (bucket?.size === 0) {
			family.routedAtoms.delete(subKey)
		}
	}
}

function addScope<K extends Canonical, M extends TimelineManageable>(
	store: RootStore,
	family: TimelineFamily<K, M>,
	scope: TimelineFamilyScope<K, any, any>,
): void {
	const atomFamilyKey = scope.family.key
	if (family.routes.has(atomFamilyKey)) {
		store.logger.error(
			`❌`,
			`timeline_family`,
			family.key,
			`Failed to add atom family "${atomFamilyKey}" more than once.`,
		)
		return
	}
	const owner = store.timelineTopics.getRelatedKey(atomFamilyKey)
	if (owner && owner !== family.key) {
		store.logger.error(
			`❌`,
			`timeline_family`,
			family.key,
			`Failed to add atom family "${atomFamilyKey}" because it already belongs to timeline owner "${owner}".`,
		)
		return
	}
	for (const atom of store.atoms.values()) {
		if (atom.family?.key !== atomFamilyKey) {
			continue
		}
		const atomOwner = store.timelineTopics.getRelatedKey(
			timelineTopicKey(store, atom),
		)
		if (atomOwner && atomOwner !== family.key) {
			store.logger.error(
				`❌`,
				`timeline_family`,
				family.key,
				`Failed to add atom family "${atomFamilyKey}" because member "${atom.key}" already belongs to timeline "${atomOwner}".`,
			)
			return
		}
	}

	family.routes.set(atomFamilyKey, scope)
	store.timelineTopics.set(
		{ timelineKey: family.key, topicKey: atomFamilyKey },
		{ topicType: `atom_family` },
	)
	const atomFamily = withdraw(store, scope.family)
	const subject = atomFamily.subject as unknown as Subject<
		AtomLifecycleEvent<AtomToken<any, any, any>>
	>
	family.subscriptions.set(
		atomFamilyKey,
		subject.subscribe(`timeline-family:${family.key}`, (event) => {
			routeAtom(store, family, event)
		}),
	)
	for (const atom of store.atoms.values()) {
		if (atom.family?.key === atomFamilyKey) {
			routeAtom(store, family, {
				type: `atom_creation`,
				token: deposit(atom),
				timestamp: Date.now(),
			})
		}
	}
}

export function createTimelineFamily<
	K extends Canonical,
	Scope extends TimelineFamilyScope<K, any, any>,
>(
	store: RootStore,
	options: TimelineFamilyOptions<K, Scope>,
): TimelineFamilyToken<K, Scope[`family`]> {
	const token: TimelineFamilyToken<K, Scope[`family`]> = {
		key: options.key,
		type: `timeline_family`,
	}
	if (store.timelineFamilies.has(options.key)) {
		return token
	}

	const family: TimelineFamily<K, Scope[`family`]> = {
		type: `timeline_family`,
		key: options.key,
		options,
		routes: new Map(),
		routedAtoms: new Map(),
		subscriptions: new Map(),
		install: (target) => createTimelineFamily(target, options),
		create: (key, data) => createTimelineFamilyMember(store, token, key, data),
	}
	store.timelineFamilies.set(options.key, family)
	for (const scope of options.scope) {
		addScope(store, family, scope)
	}
	return token
}

export function createTimelineFamilyMember<
	K extends Canonical,
	M extends TimelineManageable,
	Key extends K,
>(
	store: RootStore,
	familyToken: TimelineFamilyToken<K, M>,
	key: Key,
	data?: Timeline<M>,
): TimelineToken<M, Key> {
	const existing = seekTimelineInStore(store, familyToken, key)
	if (existing) {
		return existing as TimelineToken<M, Key>
	}
	const family = withdraw(store, familyToken)
	const identity = timelineMemberIdentity(family.key, key)
	const token = createTimeline<M>(
		store,
		{ key: identity.key, scope: [] },
		data,
		identity.family,
	) as TimelineToken<M, Key>
	const timeline = withdraw(store, token)
	timeline.install = (target) => {
		if (!target.timelineFamilies.has(family.key)) {
			family.install(target)
		}
		createTimelineFamilyMember(target, familyToken, key, timeline)
	}
	const bucket = family.routedAtoms.get(identity.subKey)
	if (bucket) {
		for (const atomToken of bucket.values()) {
			addAtomToTimeline(store, atomToken, timeline)
		}
	}
	return token
}

export function seekTimelineInStore<
	K extends Canonical,
	M extends TimelineManageable,
>(
	store: Store,
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): TimelineToken<M, K> | undefined {
	const identity = timelineMemberIdentity(family.key, key)
	const timeline = newest(store).timelines.get(identity.key)
	return timeline ? (deposit(timeline) as TimelineToken<M, K>) : undefined
}

export function findTimelineInStore<
	K extends Canonical,
	M extends TimelineManageable,
>(
	store: RootStore,
	familyToken: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): TimelineToken<M, K> {
	const family = withdraw(store, familyToken)
	return family.create(key)
}
