import type { ServerConfig } from "atom.io/realtime-server"
import {
	realtimeStateProvider,
	realtimeStateReceiver,
} from "atom.io/realtime-server"

import { sharedCountAtom, sharedCountSchema } from "./declare-rigid-state"

declare const connection: ServerConfig

const provide = realtimeStateProvider(connection)
const receive = realtimeStateReceiver(connection)

const stopProviding = provide(sharedCountAtom)
const stopReceiving = receive(sharedCountSchema, sharedCountAtom)

export const stopSharedCount = (): void => {
	stopReceiving()
	stopProviding()
}
