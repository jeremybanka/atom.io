import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const database = new DatabaseSync(`drafts.sqlite`)
try {
	database.exec(readFileSync(new URL(`../schema.sql`, import.meta.url), `utf8`))
	const insert = database.prepare(
		`INSERT OR IGNORE INTO drafts (id, title, body) VALUES (?, ?, ?)`,
	)
	for (const id of [1, 2])
		insert.run(id, `Draft ${id}`, `A note from SQLite for document ${id}.`)
} finally {
	database.close()
}
