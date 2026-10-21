import { useSingleEffect } from "@atom.io/react"
import type { Socket } from "@atom.io/realtime"
import * as React from "react"

import { RealtimeContext, type RealtimeServiceKey } from "./realtime-context.tsx"

export function useRealtimeService(
	key: RealtimeServiceKey,
	create: (socket: Socket) => () => void,
): void {
	const { socket, services } = React.useContext(RealtimeContext)
	useSingleEffect(() => {
		let service = services?.get(key)
		if (service) {
			++service.consumerCount
		} else if (socket) {
			const dispose = create(socket)
			service = { consumerCount: 1, dispose }
			services?.set(key, service)
		}
		return () => {
			if (service) {
				--service.consumerCount
				if (service.consumerCount === 0) {
					service.dispose?.()
					services?.delete(key)
				}
			}
		}
	}, [socket, key])
}
