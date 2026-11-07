import { DatabaseSync } from "node:sqlite"

import { TRPCError } from "@trpc/server"

import readProductQuery from "./read-product.sql"

/** SSR and tRPC share the same inferred query result. */
// oxlint-disable-next-line typescript/explicit-module-boundary-types -- Infer Reylo's SQL result; the type tests verify the transport contract.
export function readProduct(id: number) {
	const database = new DatabaseSync(`inventory.sqlite`, { readOnly: true })
	try {
		const product = readProductQuery.runSync(database, { id })
		if (!product)
			throw new TRPCError({
				code: `NOT_FOUND`,
				message: `Product ${id} does not exist`,
			})
		return product
	} finally {
		database.close()
	}
}

// oxlint-disable-next-line typescript/explicit-module-boundary-types -- Preserve the query's inferred return type through the mutation.
export function saveStock(id: number, stock: number, revision: number) {
	const database = new DatabaseSync(`inventory.sqlite`)
	try {
		database.exec(`BEGIN IMMEDIATE`)
		const result = database
			.prepare(
				`UPDATE products SET stock = ?, revision = revision + 1 WHERE id = ? AND revision = ?`,
			)
			.run(stock, id, revision)
		if (!result.changes)
			throw new TRPCError({
				code: `CONFLICT`,
				message: `Stock changed since you loaded it. Reload before saving.`,
			})
		const product = readProductQuery.runSync(database, { id })!
		database.exec(`COMMIT`)
		return product
	} finally {
		database.close()
	}
}
