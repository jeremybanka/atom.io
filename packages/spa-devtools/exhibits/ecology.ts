import {
	captureEcologySnapshot,
	type EcologyRootTrace,
	type EcologySnapshot,
	traceEcologyRoots,
} from "@atom.io/spa-devtools"
import type { Silo } from "atom.io"

export function inspectEcology(
	store: Silo[`store`],
	selectorKey: string,
): { snapshot: EcologySnapshot; trace: EcologyRootTrace } {
	const snapshot = captureEcologySnapshot(store, {
		// Application-node allowance; reserved debugger records use the bounded inspection headroom.
		maxNodes: 1_000,
		maxFamilies: 1_000,
		maxRelations: 5_000,
	})
	const trace = traceEcologyRoots(snapshot, selectorKey, { maxWork: 50_000 })
	return { snapshot, trace }
}
