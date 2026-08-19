import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"

import {
	createMosaicTextRootReader,
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicAcceptedDomainBatchEnvelope,
	type MosaicDomainCheckpointExternalRoot,
	type MosaicDomainCheckpointObjectKey,
	type MosaicDomainIdentity,
	type MosaicDomainMemberAddress,
	type MosaicTextRoot,
	type MosaicTextRootCounters,
	stageMosaicTextRootImportStream,
	stageMosaicTextRootReplace,
} from "../packages/atom.io/src/realtime/index.ts"
import {
	createMosaicDomainCheckpointCoordinator,
	createMosaicTextRootCheckpointReader,
	createMosaicTextRootCheckpointStage,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainCheckpointCoordinator,
	mosaicDomainCheckpointObjectKey,
} from "../packages/atom.io/src/realtime-server/index.ts"

export type MosaicTextRootPublication = {
	readonly externalRoot: MosaicDomainCheckpointObjectKey
	readonly root: MosaicTextRoot
}

export type MosaicTextRootScaleEdit = {
	readonly actor: string
	readonly deleted: string
	readonly end: number
	readonly id: string
	readonly inserted: string
	readonly revision: number
	readonly start: number
}

export type MosaicTextRootScaleMetrics = {
	readonly checkpointBytes: number
	readonly deliveredBytes: number
	readonly initialExternalPersistedBytes: number
	readonly importCounters: MosaicTextRootCounters
	readonly maximumLocalExternalPersistedBytes: number
	readonly maximumLocalCounters: MosaicTextRootCounters
	readonly maximumLocalValidationHashedBytes: number
	readonly maximumLocalValidationObjectReads: number
	readonly maximumLocalValidationSerializedBytes: number
	readonly maximumFullDocumentReplicas: number
	readonly maximumMemberLoads: number
	readonly maximumResidentBytes: number
	readonly revision: number
	readonly serializedBatchBytes: number
	readonly selectorInvalidations: number
}

type PublicationOperation = {
	readonly publication: MosaicTextRootPublication
	readonly type: `publish-text-root`
}

type ResidentProjection = {
	readonly end: number
	readonly revision: number
	readonly start: number
	readonly text: string
}

const zeroCounters = (): MosaicTextRootCounters => ({
	branchesVisited: 0,
	branchesWritten: 0,
	leavesVisited: 0,
	leavesWritten: 0,
	objectReads: 0,
	stagedBytes: 0,
	utf16Scanned: 0,
})

const maximumCounters = (
	left: MosaicTextRootCounters,
	right: MosaicTextRootCounters,
): MosaicTextRootCounters => ({
	branchesVisited: Math.max(left.branchesVisited, right.branchesVisited),
	branchesWritten: Math.max(left.branchesWritten, right.branchesWritten),
	leavesVisited: Math.max(left.leavesVisited, right.leavesVisited),
	leavesWritten: Math.max(left.leavesWritten, right.leavesWritten),
	objectReads: Math.max(left.objectReads, right.objectReads),
	stagedBytes: Math.max(left.stagedBytes, right.stagedBytes),
	utf16Scanned: Math.max(left.utf16Scanned, right.utf16Scanned),
})

const jsonBytes = (value: unknown): number =>
	new TextEncoder().encode(JSON.stringify(value)).byteLength

const fingerprint = (value: unknown): string =>
	createHash(`sha256`).update(JSON.stringify(value)).digest(`hex`)

class CountingCheckpointStorage extends InMemoryMosaicDomainCheckpointStorage {
	public objectReads = 0

	public override readCheckpointObject(
		...parameters: Parameters<
			InMemoryMosaicDomainCheckpointStorage[`readCheckpointObject`]
		>
	) {
		this.objectReads++
		return super.readCheckpointObject(...parameters)
	}
}

const decodedFileChunks = async function* (
	filename: string,
	deadline: number,
): AsyncIterable<string> {
	const decoder = new TextDecoder()
	for await (const chunk of createReadStream(filename, {
		highWaterMark: 128 * 1024,
	})) {
		if (performance.now() > deadline) {
			throw new Error(`Mosaic Text v3 import exceeded its document deadline.`)
		}
		const text = decoder.decode(chunk as Uint8Array, { stream: true })
		if (text.length > 0) yield text
	}
	const final = decoder.decode()
	if (final.length > 0) yield final
}

export class MosaicTextRootScaleClient {
	readonly #buffer = new Map<number, MosaicAcceptedDomainBatchEnvelope>()
	readonly #resident = new Map<string, ResidentProjection>()
	readonly #redo: MosaicTextRootScaleEdit[] = []
	readonly #undo: MosaicTextRootScaleEdit[] = []
	#publication: MosaicTextRootPublication | null = null
	#revision = 0

	public constructor(
		public readonly id: string,
		public readonly service: MosaicTextRootScaleService,
	) {}

	public deliver(accepted: MosaicAcceptedDomainBatchEnvelope): void {
		if (accepted.revision <= this.#revision) return
		this.#buffer.set(accepted.revision, accepted)
		while (this.#buffer.has(this.#revision + 1)) {
			const next = this.#buffer.get(this.#revision + 1)!
			this.#buffer.delete(next.revision)
			const operation = next.batch.operations[0]?.operation as
				| PublicationOperation
				| undefined
			if (operation?.type !== `publish-text-root`) {
				throw new Error(`A scale client received an invalid publication.`)
			}
			this.#publication = structuredClone(operation.publication)
			this.#revision = next.revision
			this.#resident.clear()
		}
	}

	public resnapshot(): void {
		this.#buffer.clear()
		this.#publication = this.service.publication
		this.#revision = this.service.revision
		this.#resident.clear()
	}

	public async hydrate(start: number, end: number): Promise<ResidentProjection> {
		if (
			this.#publication === null ||
			this.#revision !== this.service.revision ||
			this.#publication.externalRoot !== this.service.publication.externalRoot
		) {
			this.resnapshot()
		}
		const key = `${start}:${end}`
		const cached = this.#resident.get(key)
		if (cached !== undefined) return cached
		const text = await this.service.readRange(start, end)
		const projection = { end, revision: this.#revision, start, text }
		this.#resident.set(key, projection)
		while (this.#resident.size > 2) {
			this.#resident.delete(this.#resident.keys().next().value!)
		}
		this.service.observeResidency(
			[...this.#resident.values()].reduce(
				(total, item) => total + jsonBytes(item.text),
				0,
			),
		)
		return projection
	}

	public async commit(
		options: Omit<MosaicTextRootScaleEdit, `actor` | `deleted` | `revision`>,
	): Promise<MosaicAcceptedDomainBatchEnvelope> {
		const accepted = await this.service.replace({ ...options, actor: this.id })
		this.#undo.push(this.service.edits.at(-1)!)
		this.#redo.length = 0
		return accepted
	}

	public async undo(id: string): Promise<MosaicAcceptedDomainBatchEnvelope> {
		const target = this.#undo.pop()
		if (target === undefined) throw new Error(`Nothing remains to undo.`)
		const accepted = await this.service.replace({
			actor: this.id,
			end: target.start + target.inserted.length,
			id,
			inserted: target.deleted,
			start: target.start,
		})
		this.#redo.push(target)
		return accepted
	}

	public async redo(id: string): Promise<MosaicAcceptedDomainBatchEnvelope> {
		const target = this.#redo.pop()
		if (target === undefined) throw new Error(`Nothing remains to redo.`)
		const accepted = await this.service.replace({
			actor: this.id,
			end: target.start + target.deleted.length,
			id,
			inserted: target.inserted,
			start: target.start,
		})
		this.#undo.push(this.service.edits.at(-1)!)
		return accepted
	}

	public get history(): { readonly redo: number; readonly undo: number } {
		return { redo: this.#redo.length, undo: this.#undo.length }
	}

	public get publication(): MosaicTextRootPublication | null {
		return this.#publication === null ? null : structuredClone(this.#publication)
	}

	public get residentRanges(): readonly {
		readonly end: number
		readonly start: number
	}[] {
		return [...this.#resident.values()].map(({ end, start }) => ({ end, start }))
	}

	public get revision(): number {
		return this.#revision
	}
}

export class MosaicTextRootScaleService {
	readonly #address: MosaicDomainMemberAddress
	readonly #clients = new Set<MosaicTextRootScaleClient>()
	readonly #identity: MosaicDomainIdentity
	readonly #sequences = new Map<string, number>()
	#storage: InMemoryMosaicDomainCheckpointStorage
	#checkpoint: MosaicDomainCheckpointCoordinator
	#checkpointBytes = 0
	#deliveredBytes = 0
	#initialExternalPersistedBytes = 0
	#maximumLocalExternalPersistedBytes = 0
	#headBatchId: string | null = null
	#importCounters = zeroCounters()
	#maximumLocalCounters = zeroCounters()
	#maximumFullDocumentReplicas = 1
	#maximumMemberLoads = 0
	#maximumResidentBytes = 0
	#maximumValidationHashedBytes = 0
	#maximumValidationObjectReads = 0
	#maximumValidationSerializedBytes = 0
	#publication: MosaicTextRootPublication | null = null
	#revision = 0
	#selectorInvalidations = 0
	#serializedBatchBytes = 0
	public readonly edits: MosaicTextRootScaleEdit[] = []
	public readonly transcript: string[] = []

	private constructor(instance: string) {
		this.#identity = {
			definition: { key: `mosaic-text-root-scale`, version: 3 },
			instance,
		}
		this.#address = {
			domain: this.#identity,
			key: `root`,
			member: `source`,
		}
		this.#storage = new CountingCheckpointStorage({
			maxRecentReceipts: 4_096,
			maxSessionWatermarks: 128,
		})
		this.#checkpoint = this.#createCheckpoint()
	}

	public static async open(
		filename: string,
		options: { readonly deadline?: number } = {},
	): Promise<MosaicTextRootScaleService> {
		const instance = createHash(`sha256`)
			.update(filename)
			.digest(`hex`)
			.slice(0, 24)
		const service = new MosaicTextRootScaleService(instance)
		const stage = createMosaicTextRootCheckpointStage({
			baseRevision: 1,
			domain: service.#identity,
			proposal: service.#proposal(`import`, 1),
			storage: service.#storage,
		})
		const imported = await stageMosaicTextRootImportStream(
			stage,
			decodedFileChunks(filename, options.deadline ?? Number.POSITIVE_INFINITY),
		)
		const external = await stage.stage(imported.root)
		service.#importCounters = imported.counters
		service.#initialExternalPersistedBytes = external.persistedBytes
		await service.#publish(
			{ externalRoot: external.rootKey, root: imported.root },
			`import`,
			`importer`,
		)
		service.transcript.push(`atomic-import:revision-1`)
		return service
	}

	#createCheckpoint(): MosaicDomainCheckpointCoordinator {
		return createMosaicDomainCheckpointCoordinator({
			domain: this.#identity,
			externalRoots: () =>
				this.#publication === null ? [] : [this.#publication.externalRoot],
			limits: {
				maxExternalBytes: 1024 * 1024 * 1024,
				maxExternalReads: 8,
			},
			readMember: () => {
				if (this.#publication === null) {
					throw new Error(`The Mosaic Text v3 publication is absent.`)
				}
				return this.#publication
			},
			storage: this.#storage,
		})
	}

	#proposal(id: string, revision: number) {
		return {
			expiresAfterRevision: revision,
			expiresAt: Date.now() + 5 * 60_000,
			id: `text-stage:${id}`,
			minimumRevision: this.#revision,
			retentionEpochs: 8,
		}
	}

	#storageReads(): number {
		return this.#storage instanceof CountingCheckpointStorage
			? this.#storage.objectReads
			: 0
	}

	async #publish(
		publication: MosaicTextRootPublication,
		id: string,
		actor: string,
	): Promise<MosaicAcceptedDomainBatchEnvelope> {
		const staged = await this.#storage.readCheckpointObject(
			this.#identity,
			publication.externalRoot,
		)
		if (
			staged?.kind !== `external-root` ||
			mosaicDomainCheckpointObjectKey(staged) !== publication.externalRoot ||
			staged.baseRevision !== this.#revision + 1 ||
			staged.depth > 64 ||
			staged.bytes > 1024 * 1024 * 1024
		) {
			throw new Error(`A Mosaic Text v3 staged publication is invalid.`)
		}
		const sequence = (this.#sequences.get(actor) ?? 0) + 1
		const operation: PublicationOperation = {
			publication,
			type: `publish-text-root`,
		}
		const accepted: MosaicAcceptedDomainBatchEnvelope = {
			batch: {
				affectedMembers: [this.#address],
				actor,
				dependencies: this.#headBatchId === null ? [] : [this.#headBatchId],
				domain: this.#identity,
				group: id,
				id,
				operations: [
					{
						address: this.#address,
						id: `${id}:root`,
						model: { key: `mosaic-text-root`, version: 3 },
						operation,
					},
				],
				protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
				sequence,
				session: actor,
			},
			revision: this.#revision + 1,
		}
		const appended = await this.#storage.appendBatch({
			accepted,
			checkpointProposals: [
				{
					id: `text-stage:${id}`,
					rootKey: publication.externalRoot,
				},
			],
			expectedRevision: this.#revision,
			fingerprint: fingerprint(accepted.batch),
		})
		if (appended.status !== `accepted` && appended.status !== `duplicate`) {
			throw new Error(`Mosaic Text v3 append failed: ${appended.status}.`)
		}
		this.#publication = structuredClone(publication)
		this.#revision = appended.accepted.revision
		this.#headBatchId = appended.accepted.batch.id
		this.#sequences.set(actor, sequence)
		this.#serializedBatchBytes = Math.max(
			this.#serializedBatchBytes,
			jsonBytes(appended.accepted),
		)
		this.#selectorInvalidations++
		const checkpoint = await this.#checkpoint.checkpoint()
		this.#checkpointBytes = Math.max(
			this.#checkpointBytes,
			checkpoint.persistedBytes,
		)
		for (const client of this.#clients) {
			this.#deliveredBytes = Math.max(
				this.#deliveredBytes,
				jsonBytes(appended.accepted),
			)
			client.deliver(appended.accepted)
		}
		return appended.accepted
	}

	public connect(id: string): MosaicTextRootScaleClient {
		const client = new MosaicTextRootScaleClient(id, this)
		client.resnapshot()
		this.#clients.add(client)
		this.#deliveredBytes = Math.max(
			this.#deliveredBytes,
			jsonBytes(this.publication),
		)
		return client
	}

	public disconnect(client: MosaicTextRootScaleClient): void {
		this.#clients.delete(client)
	}

	public async replace(options: {
		readonly actor: string
		readonly end: number
		readonly id: string
		readonly inserted: string
		readonly start: number
	}): Promise<MosaicAcceptedDomainBatchEnvelope> {
		if (jsonBytes(options.inserted) > 256 * 1024) {
			throw new Error(
				`A Mosaic Text v3 edit exceeds its operation safety limit.`,
			)
		}
		const current = this.publication
		const reader = createMosaicTextRootCheckpointReader({
			checkpoint: this.#checkpoint,
			rootKey: current.externalRoot,
		})
		const beforeReads = this.#storageReads()
		const validationBefore = this.#storage.stats(this.#identity)
		const deleted = (
			await createMosaicTextRootReader(reader).readRange(current.root, {
				end: options.end,
				start: options.start,
			})
		).text
		const stage = createMosaicTextRootCheckpointStage({
			baseRevision: this.#revision + 1,
			domain: this.#identity,
			previous: reader,
			previousRootKey: current.externalRoot,
			proposal: this.#proposal(options.id, this.#revision + 1),
			storage: this.#storage,
		})
		const mutation = await stageMosaicTextRootReplace(
			stage,
			current.root,
			{ end: options.end, start: options.start },
			options.inserted,
		)
		const external = await stage.stage(mutation.root)
		const validationAfter = this.#storage.stats(this.#identity)
		this.#maximumLocalExternalPersistedBytes = Math.max(
			this.#maximumLocalExternalPersistedBytes,
			external.persistedBytes,
		)
		this.#maximumLocalCounters = maximumCounters(
			this.#maximumLocalCounters,
			mutation.counters,
		)
		this.#maximumValidationHashedBytes = Math.max(
			this.#maximumValidationHashedBytes,
			validationAfter.externalValidationHashedBytes -
				validationBefore.externalValidationHashedBytes,
		)
		this.#maximumValidationObjectReads = Math.max(
			this.#maximumValidationObjectReads,
			validationAfter.externalValidationObjectReads -
				validationBefore.externalValidationObjectReads,
		)
		this.#maximumValidationSerializedBytes = Math.max(
			this.#maximumValidationSerializedBytes,
			validationAfter.externalValidationSerializedBytes -
				validationBefore.externalValidationSerializedBytes,
		)
		const accepted = await this.#publish(
			{ externalRoot: external.rootKey, root: mutation.root },
			options.id,
			options.actor,
		)
		this.#maximumMemberLoads = Math.max(
			this.#maximumMemberLoads,
			this.#storageReads() - beforeReads,
		)
		this.edits.push({
			actor: options.actor,
			deleted,
			end: options.end,
			id: options.id,
			inserted: options.inserted,
			revision: accepted.revision,
			start: options.start,
		})
		return accepted
	}

	public async readRange(start: number, end: number): Promise<string> {
		if (end - start === this.length && this.length > 256 * 1024) {
			this.#maximumFullDocumentReplicas = Math.max(
				this.#maximumFullDocumentReplicas,
				2,
			)
		}
		const beforeReads = this.#storageReads()
		const reader = createMosaicTextRootCheckpointReader({
			checkpoint: this.#checkpoint,
			rootKey: this.publication.externalRoot,
		})
		const result = await createMosaicTextRootReader(reader).readRange(
			this.publication.root,
			{ end, start },
		)
		this.#maximumMemberLoads = Math.max(
			this.#maximumMemberLoads,
			this.#storageReads() - beforeReads,
			result.counters.objectReads,
		)
		this.#deliveredBytes = Math.max(
			this.#deliveredBytes,
			jsonBytes(result.text) + jsonBytes(this.publication.root),
		)
		return result.text
	}

	public async resolveBoundary(
		offset: number,
		affinity: `left` | `right`,
	): Promise<number> {
		const beforeReads = this.#storageReads()
		const reader = createMosaicTextRootCheckpointReader({
			checkpoint: this.#checkpoint,
			rootKey: this.publication.externalRoot,
		})
		const result = await createMosaicTextRootReader(reader).resolveUtf16Boundary(
			this.publication.root,
			offset,
			affinity,
		)
		this.#maximumMemberLoads = Math.max(
			this.#maximumMemberLoads,
			this.#storageReads() - beforeReads,
			result.counters.objectReads,
		)
		return result.offset
	}

	public async restart(): Promise<void> {
		this.#storage = this.#storage.restart()
		this.#checkpoint = this.#createCheckpoint()
		const recovered = await this.#checkpoint.recover([this.#address])
		const publication = recovered.members[0]?.value as
			| MosaicTextRootPublication
			| undefined
		if (
			publication?.root.version !== 3 ||
			!(recovered.root.externalRoots ?? []).includes(publication.externalRoot)
		) {
			throw new Error(`Mosaic Text v3 restart recovery failed.`)
		}
		this.#publication = structuredClone(publication)
		this.#revision = recovered.root.revision
		this.transcript.push(`restart:checkpoint-root-plus-bounded-tail`)
	}

	public observeResidency(bytes: number): void {
		this.#maximumResidentBytes = Math.max(this.#maximumResidentBytes, bytes)
	}

	public get identity(): MosaicDomainIdentity {
		return structuredClone(this.#identity)
	}

	public get frontierBatchId(): string | null {
		return this.#headBatchId
	}

	public get length(): number {
		return this.publication.root.reference?.summary.utf16Units ?? 0
	}

	public get metrics(): MosaicTextRootScaleMetrics {
		return {
			checkpointBytes: this.#checkpointBytes,
			deliveredBytes: this.#deliveredBytes,
			initialExternalPersistedBytes: this.#initialExternalPersistedBytes,
			importCounters: this.#importCounters,
			maximumLocalExternalPersistedBytes:
				this.#maximumLocalExternalPersistedBytes,
			maximumLocalCounters: this.#maximumLocalCounters,
			maximumLocalValidationHashedBytes: this.#maximumValidationHashedBytes,
			maximumLocalValidationObjectReads: this.#maximumValidationObjectReads,
			maximumLocalValidationSerializedBytes:
				this.#maximumValidationSerializedBytes,
			maximumFullDocumentReplicas: this.#maximumFullDocumentReplicas,
			maximumMemberLoads: this.#maximumMemberLoads,
			maximumResidentBytes: this.#maximumResidentBytes,
			revision: this.#revision,
			selectorInvalidations: this.#selectorInvalidations,
			serializedBatchBytes: this.#serializedBatchBytes,
		}
	}

	public get publication(): MosaicTextRootPublication {
		if (this.#publication === null) {
			throw new Error(`Mosaic Text v3 has no publication.`)
		}
		return structuredClone(this.#publication)
	}

	public get revision(): number {
		return this.#revision
	}
}

export const isExternalTextRoot = (
	value: unknown,
): value is MosaicDomainCheckpointExternalRoot =>
	typeof value === `object` &&
	value !== null &&
	`kind` in value &&
	value.kind === `external-root`
