import { DatabaseSync } from "node:sqlite"

import type { RealtimeSqliteStorage } from "@atom.io/realtime/server/cloudflare"
import { SqliteMosaicDomainBatchStorage } from "@atom.io/realtime/server/cloudflare"
import { testMosaicDomainBatchStorageAdapter } from "@atom.io/realtime/testing/headless"
import { expect, test } from "vitest"

function sqlite(database: DatabaseSync): RealtimeSqliteStorage {
	return {
		sql: {
			exec(query, ...bindings) {
				const rows = database.prepare(query).all(...bindings)
				return { toArray: () => rows }
			},
		},
		transactionSync(callback) {
			database.exec(`BEGIN IMMEDIATE`)
			try {
				const result = callback()
				database.exec(`COMMIT`)
				return result
			} catch (error) {
				database.exec(`ROLLBACK`)
				throw error
			}
		},
	}
}

test(`SQLite adapter passes the public batch storage conformance contract`, async () => {
	const databases: DatabaseSync[] = []
	try {
		await testMosaicDomainBatchStorageAdapter(() => {
			const db = new DatabaseSync(`:memory:`)
			databases.push(db)
			return new SqliteMosaicDomainBatchStorage(sqlite(db))
		})
	} finally {
		for (const db of databases) db.close()
	}
})

test(`reconstruction preserves durable state and capacity checks roll back without changing it`, () => {
	const db = new DatabaseSync(`:memory:`)
	try {
		const state = sqlite(db)
		const storage = new SqliteMosaicDomainBatchStorage(state, {
			maxBatchesPerDomain: 1,
		})
		const domain = {
			definition: { key: `test`, version: 1 },
			instance: `document`,
		}
		const first = {
			batch: {
				affectedMembers: [],
				actor: `actor`,
				dependencies: [],
				domain,
				group: null,
				id: `one`,
				operations: [],
				protocolVersion: 1 as const,
				sequence: 1,
				session: `session`,
			},
			revision: 1,
		}
		expect(
			storage.appendBatch({
				accepted: first,
				expectedRevision: 0,
				fingerprint: `one`,
			}).status,
		).toBe(`accepted`)
		const restarted = new SqliteMosaicDomainBatchStorage(state, {
			maxBatchesPerDomain: 1,
		})
		expect(restarted.recover(domain).tail).toEqual([first])
		expect(() =>
			restarted.appendBatch({
				accepted: {
					batch: { ...first.batch, id: `two`, sequence: 2 },
					revision: 2,
				},
				expectedRevision: 1,
				fingerprint: `two`,
			}),
		).toThrow(/capacity/)
		expect(restarted.recover(domain).headRevision).toBe(1)
		expect(restarted.receipt(domain, `two`)).toBeNull()
	} finally {
		db.close()
	}
})
