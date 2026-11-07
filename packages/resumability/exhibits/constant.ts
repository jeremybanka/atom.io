import { resumable } from "resumability"

export function warehouseName(): string | Promise<string> {
	return resumable({
		key: [`warehouse-name`, 1],
		server: async () => {
			const { DatabaseSync } = await import(`node:sqlite`)
			const database = new DatabaseSync(`inventory.sqlite`, { readOnly: true })
			try {
				return String(
					database.prepare(`SELECT name FROM warehouses WHERE id = ?`).get(1)![
						`name`
					],
				)
			} finally {
				database.close()
			}
		},
	})
}
