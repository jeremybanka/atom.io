import type {
	FamilyLimitOptions,
	ReadableToken,
	StateLifecycleEvent,
} from "atom.io"
import type { Canonical } from "atom.io/json"
import { stringifyJson } from "atom.io/json"

import { disposeAtom } from "../atom"
import { newest } from "../lineage"
import { disposeSelector } from "../selector"
import type { ReadableFamily } from "../state-types"
import { deposit, type Store } from "../store"

export type FamilyMemberLimit = {
	maxMembers: number
	members: ReadableToken<any, any, any>[]
	whenFull: NonNullable<FamilyLimitOptions[`whenFull`]>
}

export function createFamilyMemberLimit(
	options: FamilyLimitOptions,
): FamilyMemberLimit | undefined {
	if (options.maxMembers === undefined) {
		return undefined
	}
	if (!Number.isInteger(options.maxMembers) || options.maxMembers < 0) {
		throw new Error(`Family option "maxMembers" must be a non-negative integer.`)
	}
	return {
		maxMembers: options.maxMembers,
		members: [],
		whenFull: options.whenFull ?? `block`,
	}
}

export function trackFamilyMembers(family: ReadableFamily<any, any, any>): void {
	if (!family.limit) {
		return
	}

	family.subject.subscribe(
		`family-limit:${family.key}`,
		(event: StateLifecycleEvent<ReadableToken<any, any, any>>) => {
			const { token } = event
			if (token.family?.key !== family.key) {
				return
			}
			const memberIndex = family.limit?.members.findIndex(
				(member) => member.family?.subKey === token.family?.subKey,
			)
			if (memberIndex === undefined) {
				return
			}
			if (memberIndex !== -1) {
				family.limit?.members.splice(memberIndex, 1)
			}
			if (event.type === `state_creation`) {
				family.limit?.members.push(token)
			}
		},
	)
}

export function enforceFamilyMemberLimit(
	store: Store,
	family: ReadableFamily<any, any, any>,
	key: Canonical,
): void {
	const { limit } = family
	if (!limit) {
		return
	}

	syncFamilyMembers(store, family)
	if (limit.members.length < limit.maxMembers) {
		return
	}

	if (limit.whenFull === `evict_oldest`) {
		const oldestMember = limit.members[0]
		if (oldestMember) {
			disposeFamilyMember(store, oldestMember)
			syncFamilyMembers(store, family)
			if (limit.members.length < limit.maxMembers) {
				return
			}
		}
	}

	const subKey = stringifyJson(key)
	throw new Error(
		`Failed to create member "${family.key}(${subKey})" because ${family.type} "${family.key}" already has its maximum of ${limit.maxMembers} members.`,
	)
}

function syncFamilyMembers(
	store: Store,
	family: ReadableFamily<any, any, any>,
): void {
	const { limit } = family
	if (!limit) {
		return
	}
	limit.members = limit.members.filter((member) => memberExists(store, member))
	const knownMemberKeys = new Set(limit.members.map((member) => member.key))
	const target = newest(store)
	for (const state of [
		...target.atoms.values(),
		...target.writableSelectors.values(),
		...target.readonlySelectors.values(),
	]) {
		if (state.family?.key !== family.key || knownMemberKeys.has(state.key)) {
			continue
		}
		const token = deposit(state) as ReadableToken<any, any, any>
		limit.members.push(token)
		knownMemberKeys.add(token.key)
	}
}

function memberExists(
	store: Store,
	token: ReadableToken<any, any, any>,
): boolean {
	const target = newest(store)
	switch (token.type) {
		case `atom`:
		case `mutable_atom`:
			return target.atoms.has(token.key)
		case `writable_held_selector`:
		case `writable_pure_selector`:
			return target.writableSelectors.has(token.key)
		case `readonly_held_selector`:
		case `readonly_pure_selector`:
			return target.readonlySelectors.has(token.key)
	}
}

function disposeFamilyMember(
	store: Store,
	token: ReadableToken<any, any, any>,
): void {
	switch (token.type) {
		case `atom`:
		case `mutable_atom`:
			disposeAtom(store, token)
			break
		case `writable_held_selector`:
		case `writable_pure_selector`:
		case `readonly_held_selector`:
		case `readonly_pure_selector`:
			disposeSelector(store, token)
			break
	}
}
