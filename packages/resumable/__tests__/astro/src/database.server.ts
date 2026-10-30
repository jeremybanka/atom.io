import { DatabaseSync } from "node:sqlite"

export function readProduct(id: number): string {
	const database = new DatabaseSync(`:memory:`)
	try {
		return database
			.prepare(`SELECT ? AS value`)
			.get(`SERVER_ONLY_SQLITE_SENTINEL:${id}`)![`value`] as string
	} finally {
		database.close()
	}
}
