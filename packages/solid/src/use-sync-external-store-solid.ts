import * as Solid from "solid-js"
import { createEffect, createSignal, onCleanup } from "solid-js"

const onSettled =
	`onSettled` in Solid
		? (
				Solid as typeof Solid & {
					onSettled?: (setup: () => () => void) => void
				}
			).onSettled
		: undefined

export function useSyncExternalStore<Snapshot>(
	subscribe: (onStoreChange: () => void) => () => void,
	getSnapshot: () => Snapshot,
): () => Snapshot {
	Solid.untrack(getSnapshot)
	// Track invalidation, not the snapshot: Solid 2 interprets function values
	// as derivations, and atom.io also supports promises and mutable values.
	const options = { equals: false, ownedWrite: true } as const
	const [state, setState] = createSignal(undefined, options)
	const setup = () => {
		const update = () => {
			setState(undefined)
		}
		const unsubscribe = subscribe(update)
		update()
		return unsubscribe
	}

	if (onSettled) {
		// Solid 2's lifecycle callback returns its cleanup; unlike an effect's
		// compute phase, it permits subscription setup and signal writes.
		onSettled(setup)
	} else {
		createEffect(() => {
			onCleanup(setup())
		})
	}

	return () => {
		state()
		return getSnapshot()
	}
}
