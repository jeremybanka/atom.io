import { resumable } from "resumability"

export function title(): string | Promise<string> {
	return resumable({
		key: `title`,
		server: async () => {
			const { DatabaseSync } = await import(`node:sqlite`)
			const database = new DatabaseSync(`:memory:`)
			try {
				return database.prepare(`SELECT 'Database constant' AS title`).get()![
					`title`
				] as string
			} finally {
				database.close()
			}
		},
	})
}
