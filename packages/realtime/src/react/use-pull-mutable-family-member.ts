import { StoreContext, useO } from "@atom.io/react"
import type { VersionedMutablePullOptions } from "@atom.io/realtime"
import * as RTC from "@atom.io/realtime/client"
import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { AsJSON, SignalFrom, Transceiver } from "atom.io/internal"
import { findInStore } from "atom.io/internal"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export function usePullMutableAtomFamilyMember<
	T extends Transceiver<any, any, any>,
	K extends Canonical,
>(
	familyToken: AtomIO.MutableAtomFamilyToken<T, K>,
	key: NoInfer<K>,
	options?: VersionedMutablePullOptions<AsJSON<T>, SignalFrom<T>>,
): T {
	const store = React.useContext(StoreContext)
	const token = findInStore(store, familyToken, key)
	useRealtimeService(
		`${options ? `versioned-pull` : `pull`}:${token.key}`,
		(socket) => {
			return RTC.pullMutableAtomFamilyMember(
				store,
				socket,
				familyToken,
				key,
				options,
			)
		},
	)
	return useO(token)
}
