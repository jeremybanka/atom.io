import { fetchRequestHandler } from "@trpc/server/adapters/fetch"
import type { APIRoute } from "astro"

import { appRouter } from "../../../server/router.ts"

export const ALL: APIRoute = ({ request }) =>
	fetchRequestHandler({
		endpoint: `/api/trpc`,
		req: request,
		router: appRouter,
		createContext: () => ({}),
	})
