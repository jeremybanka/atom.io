import type { RigidState } from "@atom.io/realtime"
import type { RigidStateClient } from "@atom.io/realtime/client"
import type { Json } from "atom.io/foundations/json"
import { useSyncExternalStore } from "react"

/** Observe a shared headless controller; the application owns its lifecycle. */
export function useRigidState<Value extends Json.Serializable>(
	client: RigidStateClient<Value>,
): RigidState<Value> {
	return useSyncExternalStore(
		client.subscribe,
		() => client.state,
		() => client.state,
	)
}
