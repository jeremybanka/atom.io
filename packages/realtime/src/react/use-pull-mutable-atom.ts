import { StoreContext, useO } from "@atom.io/react"
import type { VersionedMutablePullOptions } from "@atom.io/realtime"
import * as RTC from "@atom.io/realtime/client"
import type * as AtomIO from "atom.io"
import type { AsJSON, SignalFrom, Transceiver } from "atom.io/internal"
import * as React from "react"

import { useRealtimeService } from "./use-realtime-service.ts"

export function usePullMutable<T extends Transceiver<any, any, any>>(
	token: AtomIO.MutableAtomToken<T>,
	options?: VersionedMutablePullOptions<AsJSON<T>, SignalFrom<T>>,
): T {
	const store = React.useContext(StoreContext)
	useRealtimeService(
		`${options ? `versioned-pull` : `pull`}:${token.key}`,
		(socket) => RTC.pullMutableAtom(store, socket, token, options),
	)
	return useO(token)
}
