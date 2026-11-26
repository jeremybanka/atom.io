import type { Server } from "node:http"

import { attachDevtoolsWebSocket } from "@atom.io/devtools/standalone"
import type { Silo } from "atom.io"

export function enableDevtoolsControl(
	server: Server,
	silo: Silo,
	token: string,
): () => void {
	return attachDevtoolsWebSocket(server, silo, {
		token,
		productionAccess: `control`,
	})
}
