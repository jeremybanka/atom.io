import { randomUUID } from "node:crypto"
import { DatabaseSync } from "node:sqlite"

import type { Draft } from "./model.ts"

export function readDraft(id: number): Draft {
	const database = new DatabaseSync(`:memory:`)
	try {
		// Replace this demo query with your application's server-side database.
		const row = database
			.prepare(`SELECT ? AS title, ? AS body`)
			.get(`Draft ${id}`, `A note from SQLite for document ${id}.`)!
		return {
			title: String(row.title),
			body: String(row.body),
			source: `server`,
			revision: randomUUID(),
		}
	} finally {
		database.close()
	}
}
