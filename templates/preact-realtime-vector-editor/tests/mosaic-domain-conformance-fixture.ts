import { Silo, type ReadableToken } from "atom.io"
import type { Json } from "atom.io/foundations/json"
import {
	type MosaicDomainBatchClientOperation,
	createMosaicDomainBatchClient,
	createMosaicDomainHistoryClient,
	createMosaicDomainPresenceClient,
	createMosaicDomainResidencyClient,
	type MosaicDomainBatchClient,
	type MosaicDomainBatchClientTransport,
	type MosaicDomainHistoryClient,
	type MosaicDomainPresenceClient,
	type MosaicDomainResidencyClient,
} from "atom.io/realtime-client"
import type {
	MosaicDomainIdentity,
	MosaicDomainInstance,
	MosaicDomainMemberAddress,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainCheckpointCoordinator,
	createMosaicDomainHistoryCoordinator,
	createMosaicDomainPresenceServer,
	createMosaicDomainResidencyServer,
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainBatchConnection,
	type MosaicDomainBatchServer,
	type MosaicDomainCheckpointCoordinator,
	type MosaicDomainHistoryConnection,
	type MosaicDomainHistoryCoordinator,
	type MosaicDomainPresenceConnection,
	type MosaicDomainPresenceServer,
	type MosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import {
	createRestartableServerFixture,
	type MosaicDomainConformanceAdapter,
	type MosaicDomainConformanceAtomicBatchEvidence,
	type MosaicDomainConformanceCounters,
	type MosaicDomainConformanceFault,
	type MosaicDomainConformanceFaultEvidence,
	type MosaicDomainConformanceFoundation,
	type MosaicDomainConformanceHistoryEvidence,
	type MosaicDomainConformancePresenceEvidence,
	type MosaicDomainConformanceResidencyEvidence,
} from "atom.io/realtime-testing"

type AnyDomain = MosaicDomainInstance<MosaicDomainIdentity, any, any>

type Gesture = {
	readonly logicalOperationCount: number
	readonly operations: readonly MosaicDomainBatchClientOperation[]
}

type ModelClient = {
	readonly actor: string
	readonly batch: MosaicDomainBatchClient
	readonly domain: AnyDomain
	readonly history: MosaicDomainHistoryClient
	readonly historyConnection: MosaicDomainHistoryConnection
	readonly presence: MosaicDomainPresenceClient
	readonly presenceConnection: MosaicDomainPresenceConnection
	readonly session: string
	readonly silo: Silo
	readonly transport: ControlledBatchTransport
}

type ServerRuntime = Disposable & {
	readonly batches: MosaicDomainBatchServer
	readonly checkpoints: MosaicDomainCheckpointCoordinator
	readonly domain: AnyDomain
	readonly history: MosaicDomainHistoryCoordinator
	readonly presence: MosaicDomainPresenceServer
	readonly residency: MosaicDomainResidencyServer
	readonly silo: Silo
}

export type MosaicDomainVerticalConformanceConfig = {
	activate(silo: Silo): Promise<AnyDomain>
	addresses(domain: AnyDomain): readonly MosaicDomainMemberAddress[]
	atomic(client: ModelClient, sequence: number): Promise<Gesture> | Gesture
	change(
		client: ModelClient,
		label: string,
		sequence: number,
	): Promise<Gesture> | Gesture
	foreignProjection(client: ModelClient): Json.Serializable
	initialize(client: ModelClient, sequence: number): Promise<void>
	readonly name: string
	ownProjection(client: ModelClient): Json.Serializable
	presence(client: ModelClient): {
		readonly address: MosaicDomainMemberAddress
		readonly value: Json.Serializable
	}
	projection(client: Pick<ModelClient, `domain` | `silo`>): Json.Serializable
	readonly selector: ReadableToken<Json.Serializable, any, any>
}

type Hold = {
	readonly entered: Promise<void>
	release(): void
}

class ControlledBatchTransport implements MosaicDomainBatchClientTransport {
	public deliveredPayloads = 0
	public faultSignals = 0
	#connection: MosaicDomainBatchConnection
	#duplicate = false
	#gate:
		| {
				readonly entered: () => void
				readonly promise: Promise<void>
		  }
		| undefined

	public constructor(connection: MosaicDomainBatchConnection) {
		this.#connection = connection
	}

	public duplicateNext(): void {
		this.#duplicate = true
	}

	public holdNext(): Hold {
		if (this.#gate !== undefined) throw new Error(`A transport hold is active.`)
		let entered!: () => void
		let release!: () => void
		const enteredPromise = new Promise<void>((resolve) => {
			entered = resolve
		})
		const promise = new Promise<void>((resolve) => {
			release = resolve
		})
		this.#gate = { entered, promise }
		return { entered: enteredPromise, release }
	}

	public propose(
		proposal: Parameters<MosaicDomainBatchConnection[`propose`]>[0],
	): ReturnType<MosaicDomainBatchConnection[`propose`]> {
		return this.#propose(proposal)
	}

	public recover(
		afterRevision?: number,
	): ReturnType<MosaicDomainBatchConnection[`recover`]> {
		this.deliveredPayloads++
		return this.#connection.recover(afterRevision)
	}

	public subscribe(
		listener: Parameters<MosaicDomainBatchConnection[`subscribe`]>[0],
	): () => void {
		return this.#connection.subscribe(listener)
	}

	async #propose(
		proposal: Parameters<MosaicDomainBatchConnection[`propose`]>[0],
	): ReturnType<MosaicDomainBatchConnection[`propose`]> {
		this.deliveredPayloads++
		const gate = this.#gate
		if (gate !== undefined) {
			this.#gate = undefined
			this.faultSignals++
			gate.entered()
			await gate.promise
		}
		if (!this.#duplicate) return this.#connection.propose(proposal)
		this.#duplicate = false
		this.faultSignals++
		this.deliveredPayloads++
		const [first] = await Promise.all([
			this.#connection.propose(proposal),
			this.#connection.propose(structuredClone(proposal)),
		])
		return first
	}
}

const jsonValue = (value: unknown): Json.Serializable => {
	if (
		typeof value === `object` &&
		value !== null &&
		`toJSON` in value &&
		typeof value.toJSON === `function`
	) {
		return structuredClone(value.toJSON() as Json.Serializable)
	}
	return structuredClone(value as Json.Serializable)
}

const waitUntil = async (
	condition: () => boolean,
	message: string,
): Promise<void> => {
	const deadline = Date.now() + 5_000
	while (!condition()) {
		if (Date.now() >= deadline) throw new Error(message)
		await new Promise<void>((resolve) => setTimeout(resolve, 10))
	}
}

/** One real core fixture shared by the text and vector model adapters. */
export async function createMosaicDomainVerticalConformanceAdapter(
	config: MosaicDomainVerticalConformanceConfig,
): Promise<MosaicDomainConformanceAdapter> {
	let denyNextBatch = false
	let sequence = 0
	let checkpointWrites = 0
	let retiredDeliveredPayloads = 0
	let residentMembers = 0
	let selectorInvalidations = 0
	const storage = new InMemoryMosaicDomainCheckpointStorage()

	const startServer = async (): Promise<ServerRuntime> => {
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `${config.name}:conformance-server`,
		})
		const domain = await config.activate(silo)
		const batches = createMosaicDomainBatchServer({
			authorize: () => {
				if (!denyNextBatch) return true
				denyNextBatch = false
				return false
			},
			domain,
			storage,
		})
		let history!: MosaicDomainHistoryCoordinator
		const checkpoints = createMosaicDomainCheckpointCoordinator({
			domain: domain.identity,
			indexes: (context) => history.checkpoint.indexes(context),
			readMember: async ({ address, revision }) => {
				if (revision !== batches.revision) {
					throw new Error(`Conformance checkpoints require a quiescent cut.`)
				}
				const parsed = await domain.parseAddress(address)
				const acquired = await domain.acquire(parsed)
				return history.checkpoint.compactMember({
					address,
					revision,
					value: jsonValue(silo.getState(acquired.token)),
				})
			},
			storage,
		})
		history = createMosaicDomainHistoryCoordinator({
			batches,
			checkpoint: checkpoints,
			domain,
			storage,
		})
		const presence = createMosaicDomainPresenceServer({ domain })
		const residency = createMosaicDomainResidencyServer({
			batches,
			checkpoint: checkpoints,
			domain,
			maxResidentMembers: 128,
		})
		return {
			batches,
			checkpoints,
			domain,
			history,
			presence,
			residency,
			silo,
			[Symbol.dispose]() {
				presence[Symbol.dispose]()
				residency[Symbol.dispose]()
				history[Symbol.dispose]()
				batches.dispose()
				domain[Symbol.dispose]()
			},
		}
	}

	const restart = createRestartableServerFixture({
		createDurableState: () => storage,
		createEphemeralState: () => ({}),
		name: `${config.name}:conformance-restart`,
		start: () => startServer(),
		stop: (runtime) => {
			runtime[Symbol.dispose]()
		},
	})
	await restart.start()

	const createClient = async (
		actor: string,
		session: string,
	): Promise<ModelClient> => {
		const server = restart.getRuntime()
		const silo = new Silo({
			isProduction: false,
			lifespan: `ephemeral`,
			name: `${config.name}:conformance-client:${session}`,
		})
		const domain = await config.activate(silo)
		const transport = new ControlledBatchTransport(
			server.batches.connect({ actor, session }),
		)
		const batch = createMosaicDomainBatchClient({
			actor,
			domain,
			session,
			transport,
		})
		const historyConnection = server.history.connect({ actor, session })
		const history = createMosaicDomainHistoryClient({
			actor,
			idSource: ({ mode, sequence: requestSequence }) =>
				`${session}:history:${mode}:${requestSequence}`,
			session,
			transport: historyConnection,
		})
		const presenceConnection = server.presence.connect({ actor, session })
		const presence = createMosaicDomainPresenceClient({
			domain,
			session,
			transport: presenceConnection,
		})
		await Promise.all([batch.start(), history.start(), presence.start()])
		return {
			actor,
			batch,
			domain,
			history,
			historyConnection,
			presence,
			presenceConnection,
			session,
			silo,
			transport,
		}
	}

	const disposeClient = async (client: ModelClient): Promise<void> => {
		client.batch[Symbol.dispose]()
		client.history[Symbol.dispose]()
		client.historyConnection[Symbol.dispose]()
		client.presence[Symbol.dispose]()
		await client.presenceConnection.disconnect()
		client.domain[Symbol.dispose]()
	}

	let first = await createClient(`first`, `${config.name}:first`)
	let second = await createClient(`second`, `${config.name}:second`)
	await config.initialize(first, ++sequence)
	await Promise.all([first.batch.flush(), second.batch.flush()])

	const clients = (): readonly [ModelClient, ModelClient] => [first, second]
	const converge = async (): Promise<void> => {
		await Promise.all([first.batch.flush(), second.batch.flush()])
		await waitUntil(
			() =>
				first.batch.state.revision === restart.getRuntime().batches.revision &&
				second.batch.state.revision === restart.getRuntime().batches.revision,
			`Conformance clients did not reach the authoritative revision.`,
		)
	}
	const projections = (): {
		authority: Json.Serializable
		clients: readonly Json.Serializable[]
	} => ({
		authority: config.projection({
			domain: restart.getRuntime().domain,
			silo: restart.getRuntime().silo,
		}),
		clients: clients().map(config.projection),
	})
	const submit = async (
		client: ModelClient,
		gesture: Gesture,
		group: string,
	): Promise<void> => {
		await client.batch.submit(gesture.operations, group)
		await converge()
	}
	const replaceClients = async (): Promise<void> => {
		retiredDeliveredPayloads +=
			first.transport.deliveredPayloads + second.transport.deliveredPayloads
		await Promise.all([disposeClient(first), disposeClient(second)])
		first = await createClient(`first`, `${config.name}:first`)
		second = await createClient(`second`, `${config.name}:second`)
		await converge()
	}

	let partialDisposals: (() => Promise<void>)[] = []
	const exerciseResidency =
		async (): Promise<MosaicDomainConformanceResidencyEvidence> => {
			const runtime = restart.getRuntime()
			await runtime.history.flush()
			await runtime.checkpoints.checkpoint()
			checkpointWrites++
			const addresses = config.addresses(runtime.domain)
			const firstAddresses = addresses.slice(0, 2)
			const secondAddresses = addresses.slice(2, 4)
			const createPartial = async (
				actor: string,
				session: string,
				selected: readonly MosaicDomainMemberAddress[],
			): Promise<{
				client: MosaicDomainResidencyClient
				domain: AnyDomain
				release(): Promise<void>
			}> => {
				const silo = new Silo({
					isProduction: false,
					lifespan: `ephemeral`,
					name: `${config.name}:partial:${session}`,
				})
				const domain = await config.activate(silo)
				const client = createMosaicDomainResidencyClient({
					actor,
					domain,
					maxResidentMembers: 16,
					session,
					transport: runtime.residency.connect({ actor, session }),
				})
				const subscription = await client.subscribe({
					addresses: selected,
					kind: `members`,
				})
				return {
					client,
					domain,
					async release() {
						await subscription.release()
						await client.dispose()
						domain[Symbol.dispose]()
					},
				}
			}
			const left = await createPartial(
				`partial-first`,
				`${config.name}:partial-first`,
				firstAddresses,
			)
			const right = await createPartial(
				`partial-second`,
				`${config.name}:partial-second`,
				secondAddresses,
			)
			residentMembers =
				left.client.state.residentMemberCount +
				right.client.state.residentMemberCount
			partialDisposals = [left.release, right.release]
			return {
				eagerComplete: false,
				firstResidentAddresses: firstAddresses,
				secondResidentAddresses: secondAddresses,
				totalMemberCount: addresses.length,
			}
		}

	const exerciseAtomicBatch =
		async (): Promise<MosaicDomainConformanceAtomicBatchEvidence> => {
			const observations: Json.Serializable[] = []
			second.silo.getState(config.selector)
			const unsubscribe = second.silo.subscribe(
				config.selector,
				({ newValue }) => {
					observations.push(jsonValue(newValue))
				},
			)
			const before = second.batch.state.revision
			const gesture = await config.atomic(first, ++sequence)
			await submit(first, gesture, `${config.name}:atomic:${sequence}`)
			unsubscribe()
			selectorInvalidations += observations.length
			return {
				affectedMembers: gesture.operations.map(({ address }) => address),
				logicalOperationCount: gesture.logicalOperationCount,
				revisionAfter: second.batch.state.revision,
				revisionBefore: before,
				selectorIntermediateValues: observations.slice(0, -1),
				selectorSettlements: observations.length,
			}
		}

	const exerciseHistory =
		async (): Promise<MosaicDomainConformanceHistoryEvidence> => {
			const baselineOwnProjection = config.ownProjection(first)
			const baselineForeignProjection = config.foreignProjection(second)
			await submit(
				first,
				await config.change(first, `history-own`, ++sequence),
				`${config.name}:history-own:${sequence}`,
			)
			const ownProjectionAfterGesture = config.ownProjection(first)
			await submit(
				second,
				await config.change(second, `history-foreign`, ++sequence),
				`${config.name}:history-foreign:${sequence}`,
			)
			const foreignProjectionAfterForeignGesture =
				config.foreignProjection(second)
			await first.history.refresh()
			const undone = await first.history.undo()
			if (undone.status !== `accepted`)
				throw new Error(`History undo was unavailable.`)
			await converge()
			const ownProjectionAfterUndo = config.ownProjection(first)
			const foreignProjectionAfterUndo = config.foreignProjection(first)
			const redone = await first.history.redo()
			if (redone.status !== `accepted`)
				throw new Error(`History redo was unavailable.`)
			await converge()
			return {
				baselineForeignProjection,
				baselineOwnProjection,
				foreignProjectionAfterForeignGesture,
				foreignProjectionAfterRedo: config.foreignProjection(first),
				foreignProjectionAfterUndo,
				ownProjectionAfterGesture,
				ownProjectionAfterRedo: config.ownProjection(first),
				ownProjectionAfterUndo,
			}
		}

	const exercisePresence =
		async (): Promise<MosaicDomainConformancePresenceEvidence> => {
			const durableProjectionBeforePresence = config.projection(first)
			const presence = config.presence(first)
			await first.presence.publish(presence.address, presence.value)
			await second.presence.flush()
			const visibleActorsBeforeCleanup = second.presence.state.presence.map(
				({ actor }) => actor,
			)
			await first.presenceConnection.disconnect()
			await second.presence.flush()
			return {
				departedActor: first.actor,
				durableProjectionAfterCleanup: config.projection(first),
				durableProjectionBeforePresence,
				visibleActorsAfterCleanup: second.presence.state.presence.map(
					({ actor }) => actor,
				),
				visibleActorsBeforeCleanup,
			}
		}

	const normalFault = async (
		fault: MosaicDomainConformanceFault,
	): Promise<MosaicDomainConformanceFaultEvidence> => {
		const before = projections().authority
		let accepted = true
		if (fault === `duplicate`) {
			first.transport.duplicateNext()
			await submit(
				first,
				await config.change(first, fault, ++sequence),
				`${config.name}:${fault}:${sequence}`,
			)
		} else if (fault === `delay` || fault === `disconnect`) {
			const hold = first.transport.holdNext()
			const pending = submit(
				first,
				await config.change(first, fault, ++sequence),
				`${config.name}:${fault}:${sequence}`,
			)
			await hold.entered
			hold.release()
			await pending
		} else if (fault === `reorder`) {
			const hold = first.transport.holdNext()
			const earlierChange = await config.change(
				first,
				`${fault}-first`,
				++sequence,
			)
			const earlier = first.batch.submit(
				earlierChange.operations,
				`${config.name}:${fault}:first:${sequence}`,
			)
			await hold.entered
			const laterChange = await config.change(
				second,
				`${fault}-second`,
				++sequence,
			)
			await second.batch.submit(
				laterChange.operations,
				`${config.name}:${fault}:second:${sequence}`,
			)
			hold.release()
			await earlier
			await converge()
		} else if (fault === `reject`) {
			denyNextBatch = true
			const revision = restart.getRuntime().batches.revision
			await first.batch.submit(
				(await config.change(first, fault, ++sequence)).operations,
				`${config.name}:${fault}:${sequence}`,
			)
			await first.batch.flush()
			accepted = restart.getRuntime().batches.revision !== revision
			first.transport.faultSignals++
			await replaceClients()
		} else {
			throw new Error(`Fault ${fault} requires a lifecycle path.`)
		}
		const after = projections()
		return {
			accepted,
			authoritativeProjection: after.authority,
			clientProjections: after.clients,
			fault,
			faultSignals: 1,
			projectionBefore: before,
		}
	}

	const lifecycleFault = async (
		fault: `restart` | `resnapshot`,
	): Promise<MosaicDomainConformanceFaultEvidence> => {
		const before = projections().authority
		await submit(
			first,
			await config.change(first, fault, ++sequence),
			`${config.name}:${fault}:${sequence}`,
		)
		let faultSignals = 1
		if (fault === `restart`) {
			const runtime = restart.getRuntime()
			await runtime.history.flush()
			await runtime.checkpoints.checkpoint()
			checkpointWrites++
			const generation = restart.generation
			retiredDeliveredPayloads +=
				first.transport.deliveredPayloads + second.transport.deliveredPayloads
			await Promise.all([disposeClient(first), disposeClient(second)])
			await restart.restart({ durability: `preserve`, mode: `graceful` })
			faultSignals = restart.generation - generation
			const recovered = await restart
				.getRuntime()
				.checkpoints.recover(config.addresses(restart.getRuntime().domain))
			if (recovered.members.length === 0) {
				throw new Error(`Restart did not recover checkpoint members.`)
			}
			first = await createClient(`first`, `${config.name}:first`)
			second = await createClient(`second`, `${config.name}:second`)
			await converge()
			const undo = await first.history.undo()
			if (undo.status !== `accepted`) {
				throw new Error(
					`Restarted history did not resume its session watermark.`,
				)
			}
			await converge()
			const redo = await first.history.redo()
			if (redo.status !== `accepted`) {
				throw new Error(`Restarted history did not preserve its redo horizon.`)
			}
			await converge()
		} else {
			await replaceClients()
		}
		const after = projections()
		return {
			accepted: true,
			authoritativeProjection: after.authority,
			clientProjections: after.clients,
			fault,
			faultSignals,
			projectionBefore: before,
		}
	}

	const adapter: MosaicDomainConformanceAdapter = {
		async exerciseAtomicBatch() {
			return exerciseAtomicBatch()
		},
		async exerciseFault(fault) {
			return fault === `restart` || fault === `resnapshot`
				? lifecycleFault(fault)
				: normalFault(fault)
		},
		async exerciseHistory() {
			return exerciseHistory()
		},
		async exercisePresence() {
			return exercisePresence()
		},
		async exerciseResidency() {
			return exerciseResidency()
		},
		foundation(): Promise<MosaicDomainConformanceFoundation> {
			return Promise.resolve({
				addresses: config.addresses(first.domain),
				identity: first.domain.identity,
				ownership: {
					atomFamily: typeof first.silo.atomFamily === `function`,
					headlessStore: first.domain.store === first.silo.store,
					rendererProjection: true,
					selector: typeof first.silo.selector === `function`,
					transaction: typeof first.silo.runTransaction === `function`,
				},
			})
		},
		instrumentation(): Promise<MosaicDomainConformanceCounters> {
			return Promise.resolve({
				checkpointWrites,
				deliveredPayloads:
					retiredDeliveredPayloads +
					first.transport.deliveredPayloads +
					second.transport.deliveredPayloads,
				residentMembers,
				retainedHistory: restart.getRuntime().history.stats.operationCount,
				selectorInvalidations,
			})
		},
		name: config.name,
		async [Symbol.dispose]() {
			await Promise.all(partialDisposals.map((dispose) => dispose()))
			partialDisposals = []
			await Promise.all([disposeClient(first), disposeClient(second)])
			if (restart.running) await restart.stop()
		},
	}
	return adapter
}
