import { createRouterClient } from "@orpc/server"

import { server } from "./server.ts"

export const client = createRouterClient(server)

export type { Profile, Row, RowListView, RowStatus } from "./server.ts"
