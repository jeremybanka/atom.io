import type * as AtomIO from "atom.io"
import type { Canonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import { findInStore } from "atom.io/internal"
import { StoreContext, useO } from "atom.io/react"
import * as RTC from "atom.io/realtime-client"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export function usePullAtomFamilyMember<
	J extends Json.Serializable,
	K extends Canonical,
>(
	family: AtomIO.RegularAtomFamilyToken<J, K>,
	subKey: NoInfer<K>,
): AtomIO.ViewOf<J> {
	const store = React.useContext(StoreContext)
	const token = findInStore(store, family, subKey)
	useRealtimeService(`pull:${token.key}`, (socket) =>
		RTC.pullAtomFamilyMember(store, socket, family, subKey),
	)
	return useO(token)
}
