import { initTRPC } from "@trpc/server"
import { z } from "zod"

import { readProduct, saveStock } from "./inventory.ts"

const t = initTRPC.create()
export const appRouter = t.router({
	inventory: t.router({
		get: t.procedure
			.input(z.object({ id: z.number().int().positive() }))
			.query(({ input }) => readProduct(input.id)),
		setStock: t.procedure
			.input(
				z.object({
					id: z.number().int().positive(),
					stock: z.number().int().nonnegative(),
					revision: z.number().int().positive(),
				}),
			)
			.mutation(({ input }) => saveStock(input.id, input.stock, input.revision)),
	}),
})
export type AppRouter = typeof appRouter
