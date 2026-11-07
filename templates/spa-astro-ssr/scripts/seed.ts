import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

const database = new DatabaseSync(`inventory.sqlite`)
try {
	database.exec(readFileSync(new URL(`../schema.sql`, import.meta.url), `utf8`))
	const insert = database.prepare(
		`INSERT OR IGNORE INTO products (id, sku, name, stock) VALUES (?, ?, ?, ?)`,
	)
	insert.run(1, `COF-250`, `House blend · 250 g`, 24)
	insert.run(2, `TEA-100`, `Breakfast tea · 100 g`, 18)
} finally {
	database.close()
}
