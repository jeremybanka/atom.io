import type { Setter, WritableFamilyToken, WritableToken } from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import { parseJson } from "atom.io/foundations/json"

import { getFamilyOfToken } from "../families/get-family-of-token.ts"
import { seekInStore } from "../families/index.ts"
import { mintInStore, MUST_CREATE } from "../families/mint-in-store.ts"
import type { OpenOperation } from "../operation.ts"
import { closeOperation, openOperation } from "../operation.ts"
import type { WritableFamily } from "../state-types.ts"
import { type Store, withdraw } from "../store/index.ts"
import { dispatchOrDeferStateUpdate } from "./dispatch-state-update.ts"
import { resetAtomOrSelector } from "./reset-atom-or-selector.ts"
import { RESET_STATE } from "./reset-in-store.ts"
import { setAtomOrSelector } from "./set-atom-or-selector.ts"

export type ProtoUpdate<T> = { oldValue?: T; newValue: T }

export const OWN_OP: unique symbol = Symbol(`OWN_OP`)
export const JOIN_OP: unique symbol = Symbol(`JOIN_OP`)

export function operateOnStore<T, TT extends T, K extends Canonical, E>(
	opMode: typeof JOIN_OP | typeof OWN_OP,
	store: Store,
	...params:
		| [
				token: WritableFamilyToken<T, K, E>,
				key: NoInfer<K>,
				value: Setter<TT> | TT | typeof RESET_STATE,
		  ]
		| [
				token: WritableToken<T, any, E>,
				value: Setter<TT> | TT | typeof RESET_STATE,
		  ]
): void {
	let existingToken: WritableToken<T, K, E> | undefined
	let brandNewToken: WritableToken<T, K, E> | undefined
	let token: WritableToken<T, K, E>
	let family: WritableFamily<T, K, E> | undefined
	let key: K | null
	let value: Setter<TT> | TT | typeof RESET_STATE
	if (params.length === 2) {
		token = params[0]
		value = params[1]
		if (`family` in token) {
			family = getFamilyOfToken(store, token)
			key = parseJson(token.family.subKey)
			existingToken = seekInStore(store, family, key)
			if (!existingToken) {
				token = brandNewToken = mintInStore(MUST_CREATE, store, family, key)
			} else {
				token = existingToken
			}
		}
	} else {
		family = withdraw(store, params[0])
		key = params[1]
		value = params[2]
		existingToken = seekInStore(store, family, key)
		if (!existingToken) {
			token = brandNewToken = mintInStore(MUST_CREATE, store, family, key)
		} else {
			token = existingToken
		}
	}

	const action = value === RESET_STATE ? `reset` : `set`

	let target: Store & { operation: OpenOperation }

	if (opMode === OWN_OP) {
		const result = openOperation(store, token)
		const rejected = typeof result === `number`
		if (rejected) {
			const rejectionTime = result
			const unsubscribe = store.on.operationClose.subscribe(
				`waiting to ${action} "${token.key}" at T-${rejectionTime}`,
				function waitUntilOperationCloseToSetState() {
					unsubscribe()
					store.logger.info(
						`🟢`,
						token.type,
						token.key,
						`resuming deferred`,
						action,
						`from T-${rejectionTime}`,
					)
					operateOnStore(opMode, store, token, value)
				},
			)
			return
		}
		target = result
	} else {
		target = store as Store & { operation: OpenOperation }
	}

	if (`counterfeit` in token && `family` in token) {
		const subKey = token.family.subKey
		const disposal = store.disposalTraces.buffer.find(
			(item) => item?.key === subKey,
		)
		store.logger.error(
			`❌`,
			token.type,
			token.key,
			`could not be`,
			action,
			`because key`,
			subKey,
			`is not allocated.`,
			disposal
				? `this key was previously disposed:${disposal.trace}`
				: `(no previous disposal trace found)`,
		)
		return
	}

	const state = withdraw(target, token)
	let protoUpdate: ProtoUpdate<E | T>
	if (value === RESET_STATE) {
		protoUpdate = resetAtomOrSelector(target, state)
	} else {
		protoUpdate = setAtomOrSelector(target, state, value)
	}

	const isNewlyCreated = Boolean(brandNewToken)
	dispatchOrDeferStateUpdate(target, state, protoUpdate, isNewlyCreated, family)

	if (opMode === OWN_OP) {
		closeOperation(target)
	}
}
