import { initTRPC } from "@trpc/server"
import { z } from "zod"

import { readDraft } from "./drafts.ts"

const t = initTRPC.create()
export const appRouter = t.router({
	drafts: t.router({
		get: t.procedure
			.input(z.object({ id: z.number().int().positive() }))
			.query(({ input }) => readDraft(input.id)),
	}),
})
export type AppRouter = typeof appRouter
