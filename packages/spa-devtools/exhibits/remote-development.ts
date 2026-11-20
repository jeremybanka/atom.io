import {
	type DevtoolsStoreTransport,
	exposeDevtoolsStore,
} from "@atom.io/spa-devtools/remote"
import type { Silo } from "atom.io"

/** Called with a transport factory for an already authorized development session. */
export function attachDevelopmentDevtools(
	silo: Silo,
	connect: () => DevtoolsStoreTransport,
): (() => void) | undefined {
	if (process.env[`NODE_ENV`] !== `development`) return
	return exposeDevtoolsStore(connect(), silo, { access: `control` })
}
