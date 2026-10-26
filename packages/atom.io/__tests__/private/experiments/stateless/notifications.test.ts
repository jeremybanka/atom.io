import type { Loadable } from "atom.io"
import { atom, getState, resetState, subscribe } from "atom.io"
import { clearStore, IMPLICIT } from "atom.io/internal"
import postgres from "postgres"
import { vitest } from "vitest"

import { DatabaseManager } from "./database.node.ts"

const dbManager = new DatabaseManager()

beforeAll(async () => {
	await dbManager.createDatabase()
	await dbManager.createSampleTables()
	await dbManager.insertSampleData()
	await dbManager.setupTriggersAndNotifications()
})

afterAll(async () => {
	clearStore(IMPLICIT.STORE)
	await dbManager.dropDatabase()
})

it(`refreshes an atom from a committed notification on another connection`, async () => {
	const env = dbManager.env
	const options = {
		host: env[`PGHOST`],
		port: Number(env[`PGPORT`]),
		user: env[`PGUSER`],
		database: env[`PGDATABASE`],
		max: 1,
	}
	const writer = postgres(options)
	const reader = postgres(options)
	let unsubscribe: (() => void) | undefined

	try {
		const writerPid = await writer`SELECT pg_backend_pid() AS pid`
		const readerPid = await reader`SELECT pg_backend_pid() AS pid`
		expect(writerPid[0]?.[`pid`]).not.toBe(readerPid[0]?.[`pid`])

		const countryNameAtom = atom<Loadable<string>>({
			key: `countryName`,
			default: async () => {
				const rows = await reader<{ name: string }[]>`
					SELECT name FROM countries WHERE id = 1
				`
				const row = rows[0]
				if (!row) throw new Error(`Country 1 is missing`)
				return row.name
			},
		})
		expect(await getState(countryNameAtom)).toBe(`USA`)

		const observedNames: string[] = []
		unsubscribe = subscribe(countryNameAtom, ({ newValue }) => {
			if (typeof newValue === `string`) observedNames.push(newValue)
		})

		const notifications: string[] = []
		// Await LISTEN registration before writing. postgres.js dedicates a
		// separate connection to notifications, leaving reader queries available.
		await reader.listen(`table_update`, (message) => {
			notifications.push(message)
			if (message === `countries,1`) resetState(countryNameAtom)
		})

		const rollback = new Error(`Roll back the first change`)
		await expect(
			writer.begin(async (transaction) => {
				await transaction`UPDATE countries SET name = 'Rolled back' WHERE id = 1`
				throw rollback
			}),
		).rejects.toBe(rollback)

		await writer.begin(async (transaction) => {
			await transaction`UPDATE countries SET name = 'United States' WHERE id = 1`
			// A second connection still sees the old row until COMMIT.
			expect(await reader`SELECT name FROM countries WHERE id = 1`).toEqual([
				{ name: `USA` },
			])
			expect(await getState(countryNameAtom)).toBe(`USA`)
			expect(notifications).toEqual([])
			expect(observedNames).toEqual([])
		})

		// Only the notification callback invalidates the atom. Poll the observer,
		// not the database, so a missing notification or refresh fails the test.
		await vitest.waitFor(() => {
			expect(observedNames).toEqual([`United States`])
		})
		expect(notifications).toEqual([`countries,1`])
		expect(await getState(countryNameAtom)).toBe(`United States`)
	} finally {
		unsubscribe?.()
		await Promise.all([writer.end(), reader.end()])
	}
})
