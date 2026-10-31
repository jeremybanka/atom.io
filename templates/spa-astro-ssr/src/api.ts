import { createTRPCClient, httpLink } from "@trpc/client"
import type { inferRouterOutputs } from "@trpc/server"

import type { AppRouter } from "./server/router.ts"

export type Draft = inferRouterOutputs<AppRouter>[`drafts`][`get`]
export const api = createTRPCClient<AppRouter>({
	links: [httpLink({ url: `/api/trpc` })],
})
