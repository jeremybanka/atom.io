import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json, stringified } from "atom.io/foundations/json"
import { stringifyJson } from "atom.io/foundations/json"
import {
	findInStore,
	getFromStore,
	IMPLICIT,
	subscribeToState,
} from "atom.io/internal"
import { employSocket } from "atom.io/realtime"

import type { ServerConfig } from "."

export type FamilyProvider = ReturnType<typeof realtimeAtomFamilyProvider>
export function realtimeAtomFamilyProvider({
	socket,
	consumer,
	store = IMPLICIT.STORE,
}: ServerConfig) {
	return function familyProvider<
		J extends Json.Serializable,
		K extends Canonical,
	>(
		family: AtomIO.RegularAtomFamilyToken<J, K>,
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
			{ key: K; stopWatchingForUnsubscribe: () => void }
		>()
		const familyMemberSubscriptions = new Map<stringified<K>, () => void>()
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
			if (familyMemberSubscriptions.has(serializedKey)) return
			const token = findInStore(store, family, subKey)
			getFromStore(store, token)
			socket.emit(`serve:${token.key}`, getFromStore(store, token))
			familyMemberSubscriptions.set(
				serializedKey,
				subscribeToState(
					store,
					token,
					`expose-family:${family.key}:${socket.id}`,
					({ newValue }) => {
						socket.emit(`serve:${token.key}`, newValue)
					},
				),
			)
		}

		const isAvailable = (exposedSubKeys: Iterable<K>, subKey: K): boolean => {
			for (const exposedSubKey of exposedSubKeys) {
				if (stringifyJson(exposedSubKey) === stringifyJson(subKey)) {
					return true
				}
			}
			return false
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
				employSocket(socket, `sub:${family.key}`, (subKey: K) => {
					const serializedKey = stringifyJson(subKey)
					if (!requestedFamilyMembers.has(serializedKey)) {
						const token = findInStore(store, family, subKey)
						const stopWatchingForUnsubscribe = employSocket(
							socket,
							`unsub:${token.key}`,
							() => {
								store.logger.info(
									`🙈`,
									`user`,
									consumer,
									`unsubscribed from state "${token.key}"`,
								)
								fillUnsubRequest(serializedKey)
							},
						)
						requestedFamilyMembers.set(serializedKey, {
							key: subKey,
							stopWatchingForUnsubscribe,
						})
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
