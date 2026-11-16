import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainIdentity,
} from "@atom.io/realtime"

import type {
	MosaicDomainBatchAppendRequest,
	MosaicDomainBatchAppendResult,
	MosaicDomainBatchReceipt,
	MosaicDomainBatchRecovery,
	MosaicDomainBatchStorageAdapter,
} from "../mosaic-domain-batch-storage.ts"

/** Supported by SQLite-backed DurableObjectStorage. No Worker global is captured. */
export type RealtimeSqliteStorage = {
	readonly sql: {
		exec(
			query: string,
			...bindings: (string | number | null)[]
		): { toArray(): Record<string, unknown>[] }
	}
	transactionSync<Value>(callback: () => Value): Value
}
const domainKey = (domain: MosaicDomainIdentity): string =>
	JSON.stringify([
		domain.definition.key,
		domain.definition.version,
		domain.instance,
	])

/**
 * Atomic durable batches for bounded streams. This adapter intentionally refuses
 * growth at its configured limit; it does not pretend to implement checkpoint GC.
 */
export class SqliteMosaicDomainBatchStorage implements MosaicDomainBatchStorageAdapter {
	readonly #storage: RealtimeSqliteStorage
	readonly #maxBatches: number
	readonly #maxBatchBytes: number
	readonly #maxDomains: number

	public constructor(
		storage: RealtimeSqliteStorage,
		options: {
			readonly maxBatchesPerDomain?: number
			readonly maxBatchBytes?: number
			readonly maxDomains?: number
		} = {},
	) {
		this.#storage = storage
		this.#maxBatches = options.maxBatchesPerDomain ?? 1_000
		this.#maxBatchBytes = options.maxBatchBytes ?? 262_144
		this.#maxDomains = options.maxDomains ?? 16
		for (const limit of [
			this.#maxBatches,
			this.#maxBatchBytes,
			this.#maxDomains,
		])
			if (!Number.isSafeInteger(limit) || limit < 1)
				throw new Error(`SQLite realtime limits must be positive safe integers.`)
		storage.transactionSync(() => {
			storage.sql.exec(
				`CREATE TABLE IF NOT EXISTS atom_io_rt_domains (domain TEXT PRIMARY KEY, revision INTEGER NOT NULL)`,
			)
			storage.sql.exec(
				`CREATE TABLE IF NOT EXISTS atom_io_rt_batches (domain TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL, fingerprint TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(domain,id), UNIQUE(domain,revision))`,
			)
			storage.sql.exec(
				`CREATE TABLE IF NOT EXISTS atom_io_rt_operations (domain TEXT NOT NULL, id TEXT NOT NULL, PRIMARY KEY(domain,id))`,
			)
			storage.sql.exec(
				`CREATE TABLE IF NOT EXISTS atom_io_rt_sessions (domain TEXT NOT NULL, session TEXT NOT NULL, sequence INTEGER NOT NULL, PRIMARY KEY(domain,session))`,
			)
		})
	}

	public appendBatch(
		request: MosaicDomainBatchAppendRequest,
	): MosaicDomainBatchAppendResult {
		const { accepted, fingerprint, expectedRevision } = request
		const batch = accepted.batch
		const domain = domainKey(batch.domain)
		if (typeof fingerprint !== `string` || fingerprint.length > 1_024)
			throw new Error(`Invalid SQLite batch fingerprint.`)
		const payload = JSON.stringify(accepted)
		if (new TextEncoder().encode(payload).length > this.#maxBatchBytes)
			throw new Error(`SQLite realtime batch byte limit exceeded.`)
		return this.#storage.transactionSync(() => {
			const sql = this.#storage.sql
			const existing = this.receipt(batch.domain, batch.id)
			if (existing)
				return existing.fingerprint === fingerprint
					? { accepted: existing.accepted, status: `duplicate` }
					: { collision: `batch`, id: batch.id, status: `collision` }
			for (const operation of batch.operations)
				if (
					sql
						.exec(
							`SELECT id FROM atom_io_rt_operations WHERE domain=? AND id=?`,
							domain,
							operation.id,
						)
						.toArray().length
				)
					return {
						collision: `operation`,
						id: operation.id,
						status: `collision`,
					}
			const current = sql
				.exec(`SELECT revision FROM atom_io_rt_domains WHERE domain=?`, domain)
				.toArray()[0]
			const revision = Number(current?.[`revision`] ?? 0)
			if (expectedRevision !== revision)
				return { actualRevision: revision, status: `stale` }
			if (
				accepted.revision !== revision + 1 ||
				!Number.isSafeInteger(accepted.revision)
			)
				throw new Error(
					`SQLite realtime append revision must immediately follow the head.`,
				)
			const session = JSON.stringify([batch.actor, batch.session])
			const watermark = Number(
				sql
					.exec(
						`SELECT sequence FROM atom_io_rt_sessions WHERE domain=? AND session=?`,
						domain,
						session,
					)
					.toArray()[0]?.[`sequence`] ?? 0,
			)
			if (batch.sequence <= watermark)
				return { actualSequence: watermark, status: `retired` }
			if (batch.sequence !== watermark + 1)
				return { actualSequence: watermark, status: `sequence-gap` }
			if (revision >= this.#maxBatches)
				throw new Error(
					`SQLite realtime stream capacity exhausted; migrate or archive this resource.`,
				)
			if (
				!current &&
				Number(
					sql
						.exec(`SELECT COUNT(*) AS count FROM atom_io_rt_domains`)
						.toArray()[0]?.[`count`],
				) >= this.#maxDomains
			)
				throw new Error(`SQLite realtime domain capacity exhausted.`)
			// All identity reservations and the head advance commit in one transaction.
			for (const operation of batch.operations)
				sql.exec(
					`INSERT INTO atom_io_rt_operations(domain,id) VALUES (?,?)`,
					domain,
					operation.id,
				)
			sql.exec(
				`INSERT INTO atom_io_rt_batches(domain,id,revision,fingerprint,payload) VALUES (?,?,?,?,?)`,
				domain,
				batch.id,
				accepted.revision,
				fingerprint,
				payload,
			)
			sql.exec(
				`INSERT INTO atom_io_rt_sessions(domain,session,sequence) VALUES (?,?,?) ON CONFLICT(domain,session) DO UPDATE SET sequence=excluded.sequence`,
				domain,
				session,
				batch.sequence,
			)
			sql.exec(
				`INSERT INTO atom_io_rt_domains(domain,revision) VALUES (?,?) ON CONFLICT(domain) DO UPDATE SET revision=excluded.revision`,
				domain,
				accepted.revision,
			)
			return { accepted: structuredClone(accepted), status: `accepted` }
		})
	}

	public receipt(
		domain: MosaicDomainIdentity,
		batchId: string,
	): MosaicDomainBatchReceipt | null {
		const row = this.#storage.sql
			.exec(
				`SELECT payload,fingerprint FROM atom_io_rt_batches WHERE domain=? AND id=?`,
				domainKey(domain),
				batchId,
			)
			.toArray()[0]
		return row
			? {
					accepted: JSON.parse(
						String(row[`payload`]),
					) as MosaicAcceptedDomainBatchEnvelope,
					fingerprint: String(row[`fingerprint`]),
				}
			: null
	}

	public recover(
		domain: MosaicDomainIdentity,
		afterRevision = 0,
	): MosaicDomainBatchRecovery {
		if (!Number.isSafeInteger(afterRevision) || afterRevision < 0)
			throw new Error(`Recovery revision must be non-negative.`)
		return this.#storage.transactionSync(() => {
			const key = domainKey(domain)
			const headRevision = Number(
				this.#storage.sql
					.exec(`SELECT revision FROM atom_io_rt_domains WHERE domain=?`, key)
					.toArray()[0]?.[`revision`] ?? 0,
			)
			const rows = this.#storage.sql
				.exec(
					`SELECT payload FROM atom_io_rt_batches WHERE domain=? AND revision>? ORDER BY revision`,
					key,
					afterRevision,
				)
				.toArray()
			const tail = rows.map(
				(row) =>
					JSON.parse(
						String(row[`payload`]),
					) as MosaicAcceptedDomainBatchEnvelope,
			)
			for (let index = 0; index < tail.length; index++)
				if (tail[index].revision !== afterRevision + index + 1)
					throw new Error(`SQLite realtime recovery tail has a gap.`)
			if (tail.length !== Math.max(0, headRevision - afterRevision))
				throw new Error(`SQLite realtime recovery tail is incomplete.`)
			return { headRevision, tail }
		})
	}
}
