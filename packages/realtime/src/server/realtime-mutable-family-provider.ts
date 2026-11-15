import { employSocket, isRigidRecord } from "@atom.io/realtime"
import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { stringified } from "atom.io/foundations/json"
import { stringifyJson } from "atom.io/foundations/json"
import type { Transceiver } from "atom.io/internal"
import {
	findInStore,
	getFromStore,
	IMPLICIT,
	subscribeToState,
} from "atom.io/internal"

import { provideMutableStream } from "./provide-mutable-stream.ts"
import type { ServerConfig } from "./server-connection-types.ts"

const isAvailable = <K extends Canonical>(
	exposedSubKeys: Iterable<K>,
	subKey: K,
): boolean => {
	for (const exposedSubKey of exposedSubKeys) {
		if (stringifyJson(exposedSubKey) === stringifyJson(subKey)) {
			return true
		}
	}
	return false
}

export type MutableFamilyProvider = ReturnType<
	typeof realtimeMutableFamilyProvider
>
export function realtimeMutableFamilyProvider({
	socket,
	consumer,
	store = IMPLICIT.STORE,
}: ServerConfig) {
	return function mutableFamilyProvider<
		T extends Transceiver<any, any, any>,
		K extends Canonical,
	>(
		family: AtomIO.MutableAtomFamilyToken<T, K>,
		index:
			| AtomIO.ReadableToken<Iterable<NoInfer<K>> | null>
			| Iterable<NoInfer<K>>,
	): () => void {
		const [dynamicIndex, staticIndex]:
			| [AtomIO.ReadableToken<Iterable<NoInfer<K>> | null>, undefined]
			| [undefined, Iterable<NoInfer<K>>] = (() => {
			if (typeof index === `object` && `key` in index && `type` in index) {
				return [index, undefined] as const
			}
			return [undefined, index] as const
		})()

		const coreSubscriptions = new Set<() => void>()
		const clearCoreSubscriptions = () => {
			for (const unsub of coreSubscriptions) unsub()
			coreSubscriptions.clear()
		}
		const requestedFamilyMembers = new Map<
			stringified<K>,
			{ key: K; metadata: unknown; stopWatchingForUnsubscribe: () => void }
		>()
		const familyMemberSubscriptions = new Map<
			stringified<K>,
			ReturnType<typeof provideMutableStream>
		>()
		const clearFamilySubscriptions = () => {
			for (const unsub of familyMemberSubscriptions.values()) unsub()
			familyMemberSubscriptions.clear()
			for (const request of requestedFamilyMembers.values()) {
				request.stopWatchingForUnsubscribe()
			}
			requestedFamilyMembers.clear()
		}

		const fillUnsubRequest = (serializedKey: stringified<K>) => {
			const request = requestedFamilyMembers.get(serializedKey)
			request?.stopWatchingForUnsubscribe()
			requestedFamilyMembers.delete(serializedKey)
			const unsub = familyMemberSubscriptions.get(serializedKey)
			if (unsub) {
				unsub()
				familyMemberSubscriptions.delete(serializedKey)
			}
		}

		const exposeFamilyMembers = (subKey: K) => {
			const serializedKey = stringifyJson(subKey)
			if (familyMemberSubscriptions.has(serializedKey)) {
				familyMemberSubscriptions.get(serializedKey)?.resnapshot()
				return
			}
			const token = findInStore(store, family, subKey)
			getFromStore(store, token)
			familyMemberSubscriptions.set(
				serializedKey,
				provideMutableStream(
					store,
					socket,
					token,
					requestedFamilyMembers.get(serializedKey)?.metadata,
				),
			)
		}

		const reconcileFamilyMembers = (exposedSubKeys: Iterable<K> | null) => {
			const availableKeys =
				exposedSubKeys === null
					? null
					: new Set([...exposedSubKeys].map(stringifyJson))
			for (const [serializedKey, request] of requestedFamilyMembers) {
				const shouldExpose = availableKeys?.has(serializedKey) === true
				const isExposed = familyMemberSubscriptions.has(serializedKey)
				if (shouldExpose && !isExposed) {
					exposeFamilyMembers(request.key)
				} else if (!shouldExpose && isExposed) {
					familyMemberSubscriptions.get(serializedKey)?.()
					familyMemberSubscriptions.delete(serializedKey)
					socket.emit(`unavailable:${family.key}`, request.key)
				}
			}
		}

		const start = () => {
			store.logger.info(
				`👀`,
				`user`,
				consumer,
				`can subscribe to family "${family.key}"`,
			)
			coreSubscriptions.add(
				employSocket(socket, `sub:${family.key}`, (subKey: K, metadata) => {
					const serializedKey = stringifyJson(subKey)
					if (!requestedFamilyMembers.has(serializedKey)) {
						const token = findInStore(store, family, subKey)
						const stopWatchingForUnsubscribe = employSocket(
							socket,
							`unsub:${token.key}`,
							() => {
								fillUnsubRequest(serializedKey)
							},
						)
						requestedFamilyMembers.set(serializedKey, {
							key: subKey,
							metadata,
							stopWatchingForUnsubscribe,
						})
					}
					const request = requestedFamilyMembers.get(serializedKey)!
					const previousNonce = isRigidRecord(request.metadata)
						? request.metadata[`subscription`]
						: undefined
					const nextNonce = isRigidRecord(metadata)
						? metadata[`subscription`]
						: undefined
					if (previousNonce !== nextNonce) {
						familyMemberSubscriptions.get(serializedKey)?.()
						familyMemberSubscriptions.delete(serializedKey)
						request.metadata = metadata
					}
					let exposedSubKeys: Iterable<K> | null
					if (dynamicIndex) {
						exposedSubKeys = getFromStore(store, dynamicIndex)
					} else {
						exposedSubKeys = staticIndex
					}
					const shouldExpose =
						exposedSubKeys && isAvailable(exposedSubKeys, subKey)
					if (shouldExpose) {
						store.logger.info(
							`👀`,
							`user`,
							consumer,
							`is approved for a subscription to`,
							subKey,
							`in family "${family.key}"`,
						)
						exposeFamilyMembers(subKey)
					} else {
						store.logger.info(
							`❌`,
							`user`,
							consumer,
							`is denied for a subscription to`,
							subKey,
							`in family "${family.key}"`,
						)
						socket.emit(`unavailable:${family.key}`, subKey)
					}
				}),
			)
			if (dynamicIndex) {
				coreSubscriptions.add(
					subscribeToState(
						store,
						dynamicIndex,
						`expose-family:${family.key}:${socket.id}`,
						({ newValue: newExposedSubKeys }) => {
							store.logger.info(
								`👀`,
								`user`,
								consumer,
								`has the following keys available for family "${family.key}"`,
								newExposedSubKeys,
							)
							reconcileFamilyMembers(newExposedSubKeys)
						},
					),
				)
			}
		}

		start()

		return () => {
			clearCoreSubscriptions()
			clearFamilySubscriptions()
		}
	}
}
