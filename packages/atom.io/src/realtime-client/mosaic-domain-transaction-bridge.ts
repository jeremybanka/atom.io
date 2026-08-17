import type {
	AtomToken,
	TransactionCommitEvent,
	TransactionSubEvent,
	TransactionToken,
} from "atom.io"
import { unpackCanonical } from "atom.io/foundations/canonical"
import type { Json } from "atom.io/foundations/json"
import {
	MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
	type MosaicDomainBatchEnvelope,
	type MosaicDomainBatchMemberOperation,
	type MosaicDomainIdentity,
	type MosaicDomainInstance,
	type MosaicDomainMember,
	type MosaicDomainMemberAddress,
	mosaicDomainMemberAddressKey,
	type MosaicDomainMemberModel,
	mosaicDomainMemberModelIdentity,
	prepareCommittedMosaicDomainBatch,
} from "atom.io/realtime"

import {
	adoptCommittedMosaicDomainBatchClientOptimism,
	type MosaicDomainBatchClient,
	type MosaicDomainBatchClientAdoptionContext,
} from "./mosaic-domain-batch-client.ts"

export type MosaicDomainTransactionBridgeOptions = {
	readonly client: MosaicDomainBatchClient
	readonly domain: MosaicDomainInstance<any, any, any>
	/** Outermost application transactions whose commits become Domain batches. */
	readonly transactions: readonly TransactionToken<any>[]
}

export type MosaicDomainTransactionBridge = Disposable & {
	/** Wait for captured commits and the batch client's current delivery work. */
	flush(): Promise<void>
	readonly problem: Error | null
	/** Retry the first retained preparation failure, preserving commit order. */
	retry(): Promise<void>
}

type OwnedMember = {
	readonly address: MosaicDomainMemberAddress
	readonly member: MosaicDomainMember & {
		readonly model: MosaicDomainMemberModel
	}
}

type Candidate = OwnedMember & {
	readonly event: Extract<TransactionSubEvent, { type: `atom_update` }>
}

let nextBridgeSubscription = 0

function memberAddress(
	domain: MosaicDomainInstance<any, any, any>,
	name: string,
	member: MosaicDomainMember,
	token: AtomToken<any, any, any>,
	tracker: boolean,
): MosaicDomainMemberAddress | null {
	const expectedKey = tracker ? `*${member.token.key}` : member.token.key
	if (`family` in member.token) return null
	if (token.family === undefined) {
		return token.key === expectedKey
			? (domain.address as (...input: any[]) => MosaicDomainMemberAddress)(name)
			: null
	}
	if (token.family.key !== expectedKey) return null
	return (domain.address as (...input: any[]) => MosaicDomainMemberAddress)(
		name,
		unpackCanonical(token.family.subKey),
	)
}

function ownedMemberForToken(
	domain: MosaicDomainInstance<any, any, any>,
	token: AtomToken<any, any, any>,
	tracker: boolean,
	allowTransceiverState = false,
): OwnedMember | null {
	for (const [name, candidate] of Object.entries(domain.members) as [
		string,
		MosaicDomainMember,
	][]) {
		if (
			candidate.role !== `durable` ||
			candidate.model === undefined ||
			(tracker
				? candidate.model.kind !== `transceiver`
				: candidate.model.kind === `transceiver` && !allowTransceiverState)
		) {
			continue
		}
		const address = memberAddress(domain, name, candidate, token, tracker)
		if (address !== null) {
			return { address, member: candidate as OwnedMember[`member`] }
		}
	}
	return null
}

function flattenTransactionEvents(
	events: readonly TransactionSubEvent[],
): TransactionSubEvent[] {
	const flattened: TransactionSubEvent[] = []
	for (const event of events) {
		if (event.type === `transaction_outcome`) {
			flattened.push(...flattenTransactionEvents(event.subEvents))
		} else {
			flattened.push(event)
		}
	}
	return flattened
}

function collectCandidates(
	domain: MosaicDomainInstance<any, any, any>,
	commit: TransactionCommitEvent,
): Candidate[] {
	const candidates: Candidate[] = []
	for (const event of flattenTransactionEvents(commit.outcome.subEvents)) {
		if (event.type === `atom_update`) {
			const tracker = event.token.key.startsWith(`*`)
			const owned = ownedMemberForToken(domain, event.token, tracker)
			if (owned === null) continue
			if (owned.member.model.encodeTransaction === undefined) {
				throw new Error(
					`Mosaic Domain member "${event.token.key}" changed in a captured transaction but its model has no transaction encoder.`,
				)
			}
			candidates.push({ ...owned, event })
			continue
		}
		if (
			event.type === `mutable_atom_snapshot` &&
			ownedMemberForToken(domain, event.token, false, true) !== null
		) {
			throw new Error(
				`A captured Mosaic transceiver must change through model signals, not a JSON snapshot replacement.`,
			)
		}
		if (
			(event.type === `atom_creation` || event.type === `atom_disposal`) &&
			ownedMemberForToken(domain, event.token, false, true) !== null
		) {
			throw new Error(
				`Captured Mosaic Domain member allocation requires an explicit model operation.`,
			)
		}
	}
	return candidates
}

function groupForCommit(
	commit: TransactionCommitEvent,
	candidates: readonly Candidate[],
): string | null {
	let signalGroup: string | null | undefined
	for (const candidate of candidates) {
		if (candidate.member.model.kind !== `transceiver`) continue
		const signal = candidate.event.update.newValue
		if (
			typeof signal !== `object` ||
			signal === null ||
			!(`group` in signal) ||
			(signal.group !== null && typeof signal.group !== `string`)
		) {
			throw new Error(`A captured Mosaic transceiver signal is malformed.`)
		}
		if (signalGroup === undefined) signalGroup = signal.group
		else if (signalGroup !== signal.group) {
			throw new Error(
				`One Mosaic Domain transaction cannot combine different signal groups.`,
			)
		}
	}
	if (signalGroup !== undefined) return signalGroup
	const id = commit.outcome.id
	return id.length > 0 && id.length <= 512 ? id : null
}

async function prepareCommit(
	domain: MosaicDomainInstance<any, any, any>,
	commit: TransactionCommitEvent,
	context: MosaicDomainBatchClientAdoptionContext,
	candidates: readonly Candidate[],
) {
	const group = groupForCommit(commit, candidates)
	const operations: MosaicDomainBatchMemberOperation[] = []
	for (const candidate of candidates) {
		const model = candidate.member.model
		const encode = model.encodeTransaction
		if (encode === undefined) throw new Error(`Missing transaction encoder.`)
		let operationId: string
		let input: unknown
		if (model.kind === `transceiver`) {
			const signal = candidate.event.update.newValue
			if (
				typeof signal !== `object` ||
				signal === null ||
				!(`id` in signal) ||
				typeof signal.id !== `string`
			) {
				throw new Error(`A captured Mosaic transceiver signal is malformed.`)
			}
			operationId = signal.id
			input = signal
		} else {
			operationId = context.operationId()
			if (!(`oldValue` in candidate.event.update)) {
				throw new Error(
					`A captured Mosaic value change is missing its previous value.`,
				)
			}
			input = {
				newValue: candidate.event.update.newValue,
				oldValue: candidate.event.update.oldValue,
			}
		}
		const encodeContext = {
			actor: context.actor,
			dependencies: context.dependencies,
			group,
			id: operationId,
			revision: null,
			session: context.session,
		} as const
		const encoded =
			model.kind === `transceiver`
				? model.encodeTransaction!(input as never, encodeContext)
				: model.encodeTransaction!(input as never, encodeContext)
		operations.push({
			address: candidate.address,
			id: operationId,
			model: mosaicDomainMemberModelIdentity(model),
			operation: encoded as Json.Serializable,
		})
	}
	const affected = new Map<string, MosaicDomainMemberAddress>()
	for (const operation of operations) {
		affected.set(
			mosaicDomainMemberAddressKey(operation.address),
			operation.address,
		)
	}
	const envelope: MosaicDomainBatchEnvelope = {
		affectedMembers: [...affected.values()],
		actor: context.actor,
		dependencies: [...context.dependencies],
		domain: domain.identity as MosaicDomainIdentity,
		group,
		id: context.batchId,
		operations,
		protocolVersion: MOSAIC_DOMAIN_BATCH_PROTOCOL_VERSION,
		session: context.session,
	}
	return prepareCommittedMosaicDomainBatch(domain, envelope, commit)
}

/**
 * Translate selected ordinary Atom.io transactions into exactly one Mosaic
 * Domain proposal each, after the outer transaction has committed.
 */
export function createMosaicDomainTransactionBridge(
	options: MosaicDomainTransactionBridgeOptions,
): MosaicDomainTransactionBridge {
	const transactionKeys = new Set(options.transactions.map(({ key }) => key))
	const retained: TransactionCommitEvent[] = []
	let disposed = false
	let draining: Promise<void> = Promise.resolve()
	let problem: Error | null = null
	const currentProblem = (): Error | null => problem

	const drain = (): Promise<void> => {
		if (problem !== null || disposed || retained.length === 0) return draining
		draining = draining.then(async () => {
			while (!disposed && problem === null && retained.length > 0) {
				const commit = retained[0]
				try {
					const candidates = collectCandidates(options.domain, commit)
					if (candidates.length === 0) {
						retained.shift()
						continue
					}
					await adoptCommittedMosaicDomainBatchClientOptimism(
						options.client,
						(context) =>
							prepareCommit(options.domain, commit, context, candidates),
					)
					retained.shift()
				} catch (error) {
					problem = error instanceof Error ? error : new Error(String(error))
				}
			}
		})
		return draining
	}

	const unsubscribe = options.domain.store.on.transactionCommit.subscribe(
		`mosaic-domain-transaction-bridge:${nextBridgeSubscription++}`,
		(commit) => {
			if (disposed || !transactionKeys.has(commit.outcome.token.key)) {
				return
			}
			retained.push(commit)
			void drain()
		},
	)

	return {
		async flush() {
			await drain()
			if (problem !== null) throw problem
			await options.client.flush()
		},
		get problem() {
			return problem
		},
		async retry() {
			problem = null
			await drain()
			const failure = currentProblem()
			if (failure !== null) throw failure
		},
		[Symbol.dispose]() {
			if (disposed) return
			disposed = true
			unsubscribe()
		},
	}
}
