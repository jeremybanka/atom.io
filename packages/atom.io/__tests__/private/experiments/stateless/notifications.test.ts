import type { Loadable } from "atom.io"
import { atom, getState, resetState, subscribe } from "atom.io"
import { clearStore, IMPLICIT } from "atom.io/internal"
import postgres from "postgres"
import { expectTypeOf, vitest } from "vitest"

import { DatabaseManager } from "./database.node.ts"
import backendPid from "./queries/backend-pid.sql"
import deleteCountry from "./queries/delete-country.sql"
import getCountry from "./queries/get-country.sql"
import insertCountry from "./queries/insert-country.sql"
import updateCountry from "./queries/update-country.sql"
import type {
	CountryDirectory,
	CountryLookup,
} from "./reactive-countries.node.ts"
import { connectCountryDirectory } from "./reactive-countries.node.ts"

const dbManager = new DatabaseManager()

// Check Reylo's schema-derived row shape, nullability, and key cardinality.
expectTypeOf(getCountry.run).returns.resolves.toEqualTypeOf<{
	id: number
	name: string | null
} | null>()

beforeAll(async () => {
	await dbManager.createDatabase()
})

beforeEach(async () => {
	await dbManager.createSampleTables()
	await dbManager.insertSampleData()
	await dbManager.setupTriggersAndNotifications()
})

afterEach(async () => {
	clearStore(IMPLICIT.STORE)
	await dbManager.dropSampleTables()
})

afterAll(async () => {
	await dbManager.dropDatabase()
})

function connectDatabase() {
	const env = dbManager.env
	return postgres({
		host: env[`PGHOST`],
		port: Number(env[`PGPORT`]),
		user: env[`PGUSER`],
		database: env[`PGDATABASE`],
		max: 1,
	})
}

it(`refreshes an atom from a committed notification on another connection`, async () => {
	const writer = connectDatabase()
	const reader = connectDatabase()
	let unsubscribe: (() => void) | undefined

	try {
		const writerPid = await backendPid.run(writer)
		const readerPid = await backendPid.run(reader)
		expect(writerPid.pid).not.toBe(readerPid.pid)

		const countryNameAtom = atom<Loadable<string | null>>({
			key: `countryName`,
			default: async () => {
				const row = await getCountry.run(reader, { id: 1 })
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
				await updateCountry.run(transaction, { id: 1, name: `Rolled back` })
				throw rollback
			}),
		).rejects.toBe(rollback)

		await writer.begin(async (transaction) => {
			await updateCountry.run(transaction, { id: 1, name: `United States` })
			// A second connection still sees the old row until COMMIT.
			expect(await getCountry.run(reader, { id: 1 })).toEqual({
				id: 1,
				name: `USA`,
			})
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

it(`keeps two independent country directories reactive to SQL inserts, updates, and deletes`, async () => {
	const writer = connectDatabase()
	const readers = [connectDatabase(), connectDatabase()]
	const directories: CountryDirectory[] = []
	const unsubscribers: (() => void)[] = []

	try {
		for (const [index, reader] of readers.entries()) {
			directories.push(
				await connectCountryDirectory(reader, `directory-${index}`),
			)
		}
		expect(directories[0]?.silo.store).not.toBe(directories[1]?.silo.store)

		const observers = await Promise.all(
			directories.map(async (directory) => {
				const { silo, countryAtoms, countryNamesSelector } = directory
				expect(await silo.getState(countryNamesSelector)).toBe(
					`USA, Canada, Mexico`,
				)
				expect(await silo.getState(countryAtoms, 1)).toEqual({
					id: 1,
					name: `USA`,
				})
				const canada = await silo.getState(countryAtoms, 2)
				// A cached miss becomes a real row when another connection inserts it.
				expect(await silo.getState(countryAtoms, 4)).toBeNull()
				const names: string[] = []
				const usa: CountryLookup[] = []
				const brazil: CountryLookup[] = []
				const canadaUpdates = vitest.fn()
				unsubscribers.push(
					silo.subscribe(countryNamesSelector, ({ newValue }) => {
						if (typeof newValue === `string`) names.push(newValue)
					}),
					silo.subscribe(silo.findState(countryAtoms, 1), ({ newValue }) => {
						if (!(newValue instanceof Promise)) usa.push(newValue)
					}),
					silo.subscribe(silo.findState(countryAtoms, 4), ({ newValue }) => {
						if (!(newValue instanceof Promise)) brazil.push(newValue)
					}),
					silo.subscribe(silo.findState(countryAtoms, 2), canadaUpdates),
				)
				return { directory, names, usa, brazil, canada, canadaUpdates }
			}),
		)

		// These writes know nothing about atom.io. Assertions only observe the
		// subscribers: no application polling, manual reset, or setState calls.
		await insertCountry.run(writer, { name: `Brazil` })
		await vitest.waitFor(
			() => {
				for (const observer of observers) {
					expect(observer.names).toEqual([`USA, Canada, Mexico, Brazil`])
					expect(observer.brazil).toEqual([{ id: 4, name: `Brazil` }])
				}
			},
			{ timeout: 3000 },
		)

		await updateCountry.run(writer, { id: 1, name: `United States` })
		await vitest.waitFor(
			() => {
				for (const observer of observers) {
					expect(observer.names.at(-1)).toBe(
						`United States, Canada, Mexico, Brazil`,
					)
					expect(observer.usa).toEqual([{ id: 1, name: `United States` }])
				}
			},
			{ timeout: 3000 },
		)

		await deleteCountry.run(writer, { id: 4 })
		await vitest.waitFor(
			() => {
				for (const observer of observers) {
					expect(observer.names.at(-1)).toBe(`United States, Canada, Mexico`)
					expect(observer.brazil).toEqual([{ id: 4, name: `Brazil` }, null])
				}
			},
			{ timeout: 3000 },
		)

		for (const observer of observers) {
			const { silo, countryAtoms } = observer.directory
			expect(silo.getState(countryAtoms, 2)).toBe(observer.canada)
			expect(observer.canadaUpdates).not.toHaveBeenCalled()
		}
	} finally {
		for (const unsubscribe of unsubscribers) unsubscribe()
		try {
			await Promise.all(directories.map((directory) => directory.close()))
		} finally {
			await Promise.all([writer.end(), ...readers.map((reader) => reader.end())])
		}
	}
})

it(`stops refreshing a closed directory and reads a fresh snapshot when reopened`, async () => {
	const writer = connectDatabase()
	const reader = connectDatabase()
	const directories: CountryDirectory[] = []
	const unsubscribers: (() => void)[] = []

	try {
		const directory = await connectCountryDirectory(reader, `closed-directory`)
		directories.push(directory)
		const { silo, countryAtoms, countryNamesSelector } = directory
		expect(await silo.getState(countryNamesSelector)).toBe(`USA, Canada, Mexico`)
		const cachedCountry = await silo.getState(countryAtoms, 1)
		const updates = vitest.fn()
		unsubscribers.push(silo.subscribe(countryNamesSelector, updates))
		await directory.close()
		directories.pop()

		await updateCountry.run(writer, { id: 1, name: `United States` })
		const reopened = await connectCountryDirectory(reader, `reopened-directory`)
		directories.push(reopened)
		expect(await reopened.silo.getState(reopened.countryNamesSelector)).toBe(
			`United States, Canada, Mexico`,
		)
		const reopenedNames: string[] = []
		unsubscribers.push(
			reopened.silo.subscribe(reopened.countryNamesSelector, ({ newValue }) => {
				if (typeof newValue === `string`) reopenedNames.push(newValue)
			}),
		)
		await insertCountry.run(writer, { name: `Brazil` })
		await vitest.waitFor(
			() => {
				expect(reopenedNames).toEqual([`United States, Canada, Mexico, Brazil`])
			},
			{ timeout: 3000 },
		)
		// The new listener has processed the next commit; the old one stayed quiet.
		expect(silo.getState(countryAtoms, 1)).toBe(cachedCountry)
		expect(silo.getState(countryNamesSelector)).toBe(`USA, Canada, Mexico`)
		expect(updates).not.toHaveBeenCalled()
	} finally {
		for (const unsubscribe of unsubscribers) unsubscribe()
		try {
			await Promise.all(directories.map((directory) => directory.close()))
		} finally {
			await Promise.all([writer.end(), reader.end()])
		}
	}
})
