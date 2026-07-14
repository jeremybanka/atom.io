import type { Canonical } from "atom.io/foundations/canonical"
import {
	clearTimelineInStore,
	createTimeline,
	createTimelineFamily,
	disposeTimelineInStore,
	findTimelineInStore,
	IMPLICIT,
	inspectTimelineInStore,
	timeTravel,
} from "atom.io/internal"

import type {
	AtomFamilyToken,
	AtomToken,
	TimelineFamilyToken,
	TimelineToken,
} from "."

export type TimelineManageable =
	| AtomFamilyToken<any, any, any>
	| AtomToken<any, any, any>
export type AtomOnly<M extends TimelineManageable> =
	M extends AtomFamilyToken<any, any>
		? AtomToken<any, any, any>
		: M extends AtomToken<any, any, any>
			? M
			: never

export type TimelineInspection = {
	at: number
	length: number
}

/**
 * Describes how one atom family is divided among the members of a timeline family.
 *
 * Returning `undefined` from `timelineKey` excludes that atom-family member from
 * every timeline.
 */
export type TimelineFamilyScope<
	TimelineKey extends Canonical,
	MemberKey extends Canonical = Canonical,
	ManagedFamily extends AtomFamilyToken<any, MemberKey, any> = AtomFamilyToken<
		any,
		MemberKey,
		any
	>,
> = {
	/** The atom family whose members will be routed. */
	family: ManagedFamily
	/** Selects the timeline key for an atom-family member. */
	timelineKey: (key: MemberKey) => TimelineKey | undefined
}

/** Options for creating a family of keyed timelines. */
export type TimelineFamilyOptions<
	TimelineKey extends Canonical,
	Scope extends TimelineFamilyScope<TimelineKey, any, any> = TimelineFamilyScope<
		TimelineKey,
		any,
		any
	>,
> = {
	/** The unique identifier of the timeline family. */
	key: string
	/** Atom families partitioned among the timeline-family members. */
	scope: readonly Scope[]
}

/**
 * Route an atom family's members into a timeline family.
 *
 * The `timelineKey` function receives each atom-family member's key. It returns
 * the key of the timeline that should record that member, or `undefined` to leave
 * the member untracked.
 *
 * An atom family can belong to only one timeline or timeline family.
 *
 * @param family - The atom family to route.
 * @param options - The function that selects a timeline key for each member.
 * @returns A scope descriptor for {@link timelineFamily}.
 */
export function scopeFamily<
	T,
	MemberKey extends Canonical,
	E,
	TimelineKey extends Canonical,
>(
	family: AtomFamilyToken<T, MemberKey, E>,
	options: {
		timelineKey: (key: MemberKey) => TimelineKey | undefined
	},
): TimelineFamilyScope<
	TimelineKey,
	MemberKey,
	AtomFamilyToken<T, MemberKey, E>
> {
	return { family, timelineKey: options.timelineKey }
}

function resolveTimeline<K extends Canonical, M extends TimelineManageable>(
	...params:
		| [token: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): TimelineToken<M> {
	return params.length === 1
		? params[0]
		: findTimelineInStore(IMPLICIT.STORE, params[0], params[1])
}

/**
 * Inspect a timeline's current history position.
 * @param timelineToken - A {@link TimelineToken}
 * @overload Timeline
 */
export function inspectTimeline(
	timelineToken: TimelineToken<any>,
): TimelineInspection
/**
 * Inspect a member of a timeline family, creating it if needed.
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @overload Timeline Family Member
 */
export function inspectTimeline<
	K extends Canonical,
	M extends TimelineManageable,
>(family: TimelineFamilyToken<K, M>, key: NoInfer<K>): TimelineInspection
export function inspectTimeline<
	K extends Canonical,
	M extends TimelineManageable,
>(
	...params:
		| [timelineToken: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): TimelineInspection {
	return inspectTimelineInStore(IMPLICIT.STORE, resolveTimeline(...params))
}

/**
 * If there is an update ahead of the cursor (in the future of this {@link timelineToken}), apply it and move the cursor to the next update
 * @param timelineToken - A {@link TimelineToken}
 * @overload Timeline
 */
export function redo(timelineToken: TimelineToken<any>): void
/**
 * Replay the next update in a timeline-family member, creating it if needed.
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @overload Timeline Family Member
 */
export function redo<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): void
export function redo<K extends Canonical, M extends TimelineManageable>(
	...params:
		| [timelineToken: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): void {
	timeTravel(IMPLICIT.STORE, `redo`, resolveTimeline(...params))
}
/**
 * Reverse the last update on the {@link timelineToken} and move the cursor to the previous update
 * @param timelineToken - A {@link TimelineToken}
 * @overload Timeline
 */
export function undo(timelineToken: TimelineToken<any>): void
/**
 * Reverse the last update in a timeline-family member, creating it if needed.
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @overload Timeline Family Member
 */
export function undo<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): void
export function undo<K extends Canonical, M extends TimelineManageable>(
	...params:
		| [timelineToken: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): void {
	timeTravel(IMPLICIT.STORE, `undo`, resolveTimeline(...params))
}
/**
 * Remove all recorded history from the {@link timelineToken} and reset its cursor to the beginning
 * @param timelineToken - A {@link TimelineToken}
 * @overload Timeline
 */
export function clearTimeline(timelineToken: TimelineToken<any>): void
/**
 * Remove all history from a timeline-family member, creating it if needed.
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @overload Timeline Family Member
 */
export function clearTimeline<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): void
export function clearTimeline<K extends Canonical, M extends TimelineManageable>(
	...params:
		| [timelineToken: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): void {
	clearTimelineInStore(IMPLICIT.STORE, resolveTimeline(...params))
}

/**
 * Permanently dispose of a timeline and its recorded history.
 * @param timelineToken - The timeline to dispose of.
 * @overload Timeline
 */
export function disposeTimeline(timelineToken: TimelineToken<any>): void
/**
 * Permanently dispose of a timeline-family member and its recorded history.
 *
 * If the member does not exist, it will not be created.
 *
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @overload Timeline Family Member
 */
export function disposeTimeline<
	K extends Canonical,
	M extends TimelineManageable,
>(family: TimelineFamilyToken<K, M>, key: NoInfer<K>): void
export function disposeTimeline<
	K extends Canonical,
	M extends TimelineManageable,
>(
	...params:
		| [timelineToken: TimelineToken<M>]
		| [family: TimelineFamilyToken<K, M>, key: NoInfer<K>]
): void {
	if (params.length === 1) {
		disposeTimelineInStore(IMPLICIT.STORE, params[0])
	} else {
		disposeTimelineInStore(IMPLICIT.STORE, params[0], params[1])
	}
}

export type TimelineOptions<ManagedAtom extends TimelineManageable> = {
	/** The unique identifier of the timeline */
	key: string
	/** The managed atoms (and families of atoms) to record */
	scope: ManagedAtom[]
}

/**
 * Create a timeline, a mechanism for recording, undoing, and replaying changes to groups of atoms
 * @param options - {@link TimelineOptions}
 * @returns A reference to the timeline created: a {@link TimelineToken}
 */
export function timeline<ManagedAtom extends TimelineManageable>(
	options: TimelineOptions<ManagedAtom>,
): TimelineToken<ManagedAtom> {
	return createTimeline(IMPLICIT.STORE, options)
}

/**
 * Create a family of independent timelines, keyed and scoped by atom families.
 *
 * Timeline-family members are created only when they are first used. Existing and
 * future atom-family members are routed to them by the descriptors from
 * {@link scopeFamily}.
 *
 * @param options - {@link TimelineFamilyOptions}
 * @returns A reference to the timeline family created: a {@link TimelineFamilyToken}
 */
export function timelineFamily<
	K extends Canonical,
	Scope extends TimelineFamilyScope<K, any, any> = TimelineFamilyScope<
		K,
		any,
		any
	>,
>(
	options: TimelineFamilyOptions<K, Scope>,
): TimelineFamilyToken<K, Scope[`family`]> {
	return createTimelineFamily(IMPLICIT.STORE, options)
}

/**
 * Find a member of a timeline family, creating it if needed.
 *
 * Repeated calls with the same family and key return the same serializable token.
 *
 * @param family - A {@link TimelineFamilyToken}.
 * @param key - The key of the timeline-family member.
 * @returns A reference to the timeline-family member: a {@link TimelineToken}
 */
export function findTimeline<K extends Canonical, M extends TimelineManageable>(
	family: TimelineFamilyToken<K, M>,
	key: NoInfer<K>,
): TimelineToken<M, K> {
	return findTimelineInStore(IMPLICIT.STORE, family, key)
}
