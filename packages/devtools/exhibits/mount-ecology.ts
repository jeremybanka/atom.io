import "@atom.io/devtools/css"

import { mountEcology } from "@atom.io/devtools/ecology"
import type { RootStore } from "atom.io/internal"

export function attachEcology(host: HTMLElement, store: RootStore): () => void {
	return mountEcology(host, { store }).dispose
}
