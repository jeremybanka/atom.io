import type { Resumption } from "@atom.io/resumable"
import { resumable } from "@atom.io/resumable"

export function greeting(scope?: Resumption): string | Promise<string> {
	return resumable(
		{
			key: `greeting`,
			server: async () => {
				const { DatabaseSync } = await import(`node:sqlite`)
				const database = new DatabaseSync(`:memory:`)
				try {
					return String(
						database.prepare(`SELECT 'Hello from SQLite' AS message`).get()![
							`message`
						],
					)
				} finally {
					database.close()
				}
			},
			client: () => `Hello from the browser`,
		},
		scope,
	)
}
