import { resumable } from "resumability"

export function readCount(): number | Promise<number> {
	return resumable({
		key: `count`,
		server: async () => {
			const { Database } = await import(`bun:sqlite`)
			using database = new Database(`:memory:`)
			return database.query<{ count: number }, []>(`SELECT 42 AS count`).get()!
				.count
		},
		client: () => 7,
	})
}
