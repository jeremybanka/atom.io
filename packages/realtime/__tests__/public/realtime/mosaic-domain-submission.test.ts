import { mosaicDomain, type MosaicDomainValueModel } from "@atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainTransactionBridge,
	type MosaicDomainBatchClientTransport,
	type MosaicDomainBatchSubmission,
} from "@atom.io/realtime/client"
import {
	useMosaicDomainBatchClientState,
	useRealtimeSubmission,
} from "@atom.io/realtime/react"
import { createMosaicDomainBatchServer } from "@atom.io/realtime/server"
import { act, renderHook } from "@testing-library/react"
import { Silo } from "atom.io"
import { vi } from "vitest"
import { z } from "zod"

async function fixture(name: string, validationError?: Error) {
	const silo = new Silo({ name, lifespan: `ephemeral`, isProduction: false })
	const valueAtom = silo.atom<number>({ key: `value`, default: 0 })
	const model = {
		identity: { key: `submission-value`, version: 1 },
		kind: `value`,
		operationSchema: z.number(),
		reduce: (_value, operation) => {
			if (validationError) throw validationError
			return operation
		},
		encodeTransaction: ({ newValue }) => newValue,
	} satisfies MosaicDomainValueModel<number, number>
	const definition = mosaicDomain({
		key: `submissions`,
		version: 1,
		configSchema: z.object({}),
		members: {
			value: { token: valueAtom, schema: z.number(), role: `durable`, model },
		},
	})
	const domain = await definition.activate({
		instance: `document`,
		config: {},
		store: silo.store,
	})
	return {
		silo,
		valueAtom,
		domain,
		operation: (value: number) => ({
			address: domain.address(`value`),
			operation: value,
		}),
	}
}

async function setup() {
	const state = await fixture(`client`)
	const serverState = await fixture(`server`)
	const server = createMosaicDomainBatchServer({ domain: serverState.domain })
	const connection = server.connect({ actor: `alice`, session: `alice-tab` })
	return { ...state, server, connection }
}

const offline = (): never => {
	throw new Error(`network unavailable`)
}

describe(`Mosaic submission receipts`, () => {
	test(`correlates immutable acceptance independently of later local and foreign traffic`, async () => {
		const state = await setup()
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			transport: state.connection,
		})
		const [first, second] = await Promise.all([
			client.submit(state.operation(1)),
			client.submit(state.operation(2)),
		])
		const result = await first.settled
		expect(result).toMatchObject({
			status: `accepted`,
			value: { revision: 1 },
			requestId: first.identity.requestId,
			session: `alice-tab`,
			resource: state.domain.identity,
		})
		expect((await second.settled).status).toBe(`accepted`)
		expect(first.identity.requestId).not.toBe(second.identity.requestId)
		const foreign = await fixture(`foreign`)
		using other = createMosaicDomainBatchClient({
			actor: `bob`,
			session: `bob-tab`,
			domain: foreign.domain,
			transport: state.server.connect({ actor: `bob`, session: `bob-tab` }),
		})
		await other.submit(foreign.operation(3))
		await client.flush()
		expect(client.state.revision).toBe(3)
		expect(first.state).toBe(result)
		expect(Object.isFrozen(result)).toBe(true)
		expect(Object.isFrozen(first.identity.resource.definition)).toBe(true)
		const observe = vi.fn()
		first.subscribe(observe)
		client[Symbol.dispose]()
		expect(observe).toHaveBeenCalledTimes(1)
		expect(await first.settled).toBe(result)
	})

	test.each([`retry`, `discard-batch`, `resnapshot`, `upgrade`] as const)(
		`retains structured %s rejection after subsequent acceptance`,
		async (recovery) => {
			const state = await setup()
			let reject = true
			using client = createMosaicDomainBatchClient({
				actor: `alice`,
				session: `alice-tab`,
				domain: state.domain,
				transport: {
					...state.connection,
					propose: async (batch) =>
						reject
							? {
									status: `rejected`,
									rejection: {
										batchId: batch.id,
										code: `unauthorized`,
										reason: `Not permitted`,
										recovery,
									},
								}
							: state.connection.propose(batch),
				},
			})
			const first = await client.submit(state.operation(1))
			const result = await first.settled
			expect(result).toMatchObject({
				status: `rejected`,
				retryable: recovery === `retry`,
				rejection: {
					batchId: first.identity.requestId,
					code: `unauthorized`,
					reason: `Not permitted`,
					recovery,
				},
			})
			reject = false
			const second = await client.submit(state.operation(2))
			await client.flush()
			expect((await second.settled).status).toBe(`accepted`)
			expect(client.state.problem).toBeNull()
			expect(first.state).toBe(result)
		},
	)

	test(`queues initial offline optimism and settles the same receipt after replay`, async () => {
		const state = await setup()
		let connected = false
		const observed: string[] = []
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			onSubmission: (receipt) =>
				receipt.subscribe((next) => observed.push(next.status)),
			transport: {
				...state.connection,
				recover: (revision) =>
					connected
						? state.connection.recover(revision)
						: Promise.reject(new Error(`offline`)),
			},
		})
		const receipt = await client.submit(state.operation(4))
		expect(state.silo.getState(state.valueAtom)).toBe(4)
		expect(receipt.state.status).toBe(`offline`)
		let settled = false
		void receipt.settled.then(() => {
			settled = true
		})
		await Promise.resolve()
		expect(settled).toBe(false)
		connected = true
		await client.flush()
		expect(await receipt.settled).toMatchObject({
			status: `accepted`,
			value: { revision: 1 },
		})
		expect(observed).toEqual([`queued`, `offline`, `sending`, `accepted`])
	})

	test(`recovers acceptance after losing both the acknowledgement and broadcast`, async () => {
		const state = await setup()
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			transport: {
				...state.connection,
				subscribe: () => () => {},
				propose: async (batch) => {
					await state.connection.propose(batch)
					return offline()
				},
			},
		})
		const receipt = await client.submit(state.operation(5))
		expect(receipt.state.status).toBe(`offline`)
		expect(state.server.revision).toBe(1)
		await client.flush()
		expect(await receipt.settled).toMatchObject({
			status: `accepted`,
			value: { revision: 1 },
		})
		expect(state.server.revision).toBe(1)
	})

	test(`disposal releases the caller while an authoritative response is still outstanding`, async () => {
		const state = await setup()
		const delivered = Promise.withResolvers<MosaicDomainBatchSubmission>()
		const reply =
			Promise.withResolvers<
				Awaited<ReturnType<MosaicDomainBatchClientTransport[`propose`]>>
			>()
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			onSubmission: delivered.resolve,
			transport: { ...state.connection, propose: () => reply.promise },
		})
		const submitted = client.submit(state.operation(6))
		const receipt = await delivered.promise
		client[Symbol.dispose]()
		expect(await submitted).toBe(receipt)
		expect(await receipt.settled).toMatchObject({
			status: `interrupted`,
			reason: `disposed`,
			recovery: `resnapshot`,
		})
		reply.resolve({
			status: `rejected`,
			rejection: {
				batchId: receipt.identity.requestId,
				code: `unauthorized`,
				reason: `late`,
				recovery: `discard-batch`,
			},
		})
		await Promise.resolve()
		expect(receipt.state.status).toBe(`interrupted`)
	})

	test(`fails closed on mismatched rejection IDs without exposing internal error detail`, async () => {
		const state = await setup()
		const log = vi
			.spyOn(state.domain.store.logger, `error`)
			.mockImplementation(() => {})
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			transport: {
				...state.connection,
				propose: () =>
					Promise.resolve({
						status: `rejected`,
						rejection: {
							batchId: `some-other-request`,
							code: `unauthorized`,
							reason: `secret internal detail`,
							recovery: `discard-batch`,
						},
					}),
			},
		})
		const receipt = await client.submit(state.operation(7))
		expect(await receipt.settled).toMatchObject({
			status: `interrupted`,
			reason: `invalid-response`,
		})
		expect(client.state.problem?.reason).toBe(
			`The Mosaic Domain transport returned an invalid response.`,
		)
		expect(log).toHaveBeenCalled()
		log.mockRestore()
	})

	test(`exposes transaction receipts before delivery and isolates observer failures`, async () => {
		const state = await setup()
		const log = vi
			.spyOn(state.domain.store.logger, `error`)
			.mockImplementation(() => {})
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			transport: state.connection,
			onSubmission: (receipt) => {
				receipt.subscribe(() => {
					throw new Error(`observer`)
				})
				throw new Error(`observer`)
			},
		})
		const editTransaction = state.silo.transaction<(value: number) => void>({
			key: `edit`,
			do: ({ set }, value) => {
				set(state.valueAtom, value)
			},
		})
		const receipts: {
			transactionId: string
			receipt: MosaicDomainBatchSubmission
			status: string
		}[] = []
		using bridge = createMosaicDomainTransactionBridge({
			client,
			domain: state.domain,
			transactions: [editTransaction],
			onSubmission: (commit, receipt) => {
				receipts.push({
					transactionId: commit.outcome.id,
					receipt,
					status: receipt.state.status,
				})
			},
		})
		state.silo.runTransaction(editTransaction, `gesture-1`)(8)
		await bridge.flush()
		expect(receipts).toHaveLength(1)
		expect(receipts[0]).toMatchObject({
			transactionId: `gesture-1`,
			status: `queued`,
		})
		expect(await receipts[0].receipt.settled).toMatchObject({
			status: `accepted`,
			value: { revision: 1 },
		})
		expect(state.silo.getState(state.valueAtom)).toBe(8)
		expect(log).toHaveBeenCalled()
		log.mockRestore()
	})
})

test(`React observes receipt and aggregate status, including replay and replacement`, async () => {
	const state = await setup()
	let connected = false
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: {
			...state.connection,
			propose: (batch) =>
				connected
					? state.connection.propose(batch)
					: Promise.reject(new Error(`offline`)),
		},
	})
	const receipt = await client.submit(state.operation(1))
	const view = renderHook(
		({ submission }) => ({
			receipt: useRealtimeSubmission(submission),
			client: useMosaicDomainBatchClientState(client),
		}),
		{ initialProps: { submission: receipt } },
	)
	expect(view.result.current.receipt.status).toBe(`offline`)
	expect(view.result.current.client.pendingBatchIds).toEqual([
		receipt.identity.requestId,
	])
	connected = true
	await act(() => client.flush())
	expect(view.result.current.receipt).toMatchObject({
		status: `accepted`,
		value: { revision: 1 },
	})
	expect(view.result.current.client.status).toBe(`live`)
	expect(view.result.current.client.pendingBatchIds).toEqual([])
	let next!: MosaicDomainBatchSubmission
	await act(async () => {
		next = await client.submit(state.operation(2))
	})
	view.rerender({ submission: next })
	expect(view.result.current.receipt).toMatchObject({
		requestId: next.identity.requestId,
		status: `accepted`,
		value: { revision: 2 },
	})
	view.unmount()
})

test(`server validation preserves private details in logs and sends a safe structured rejection`, async () => {
	const secret = new Error(`private database schema and credential detail`)
	const state = await fixture(`client`)
	const serverState = await fixture(`server`, secret)
	const log = vi
		.spyOn(serverState.domain.store.logger, `error`)
		.mockImplementation(() => {})
	const server = createMosaicDomainBatchServer({ domain: serverState.domain })
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: server.connect({ actor: `alice`, session: `alice-tab` }),
	})
	const receipt = await client.submit(state.operation(1))
	expect(await receipt.settled).toMatchObject({
		status: `rejected`,
		rejection: {
			code: `invalid-model-operation`,
			reason: `The Mosaic Domain proposal failed validation.`,
			recovery: `discard-batch`,
		},
	})
	expect(JSON.stringify(receipt.state)).not.toContain(secret.message)
	expect(log).toHaveBeenCalledWith(
		expect.anything(),
		expect.anything(),
		expect.anything(),
		expect.anything(),
		expect.objectContaining({
			error: secret,
			batchId: receipt.identity.requestId,
		}),
	)
	log.mockRestore()
	server.dispose()
})

test(`ordinary transactions expose an offline receipt before reconnect`, async () => {
	const state = await setup()
	let connected = false
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: {
			...state.connection,
			recover: (revision) =>
				connected
					? state.connection.recover(revision)
					: Promise.reject(new Error(`offline`)),
		},
	})
	const editTransaction = state.silo.transaction<(value: number) => void>({
		key: `edit`,
		do: ({ set }, value) => {
			set(state.valueAtom, value)
		},
	})
	const delivered = Promise.withResolvers<MosaicDomainBatchSubmission>()
	using bridge = createMosaicDomainTransactionBridge({
		client,
		domain: state.domain,
		transactions: [editTransaction],
		onSubmission: (_commit, receipt) => {
			delivered.resolve(receipt)
		},
	})
	state.silo.runTransaction(editTransaction)(9)
	await bridge.retry()
	const receipt = await delivered.promise
	expect(receipt.state.status).toBe(`offline`)
	expect(state.silo.getState(state.valueAtom)).toBe(9)
	connected = true
	await bridge.flush()
	expect(await receipt.settled).toMatchObject({
		status: `accepted`,
		value: { revision: 1 },
	})
})

test(`rejects an acknowledgement for a different request instead of stranding the receipt`, async () => {
	const state = await setup()
	const log = vi
		.spyOn(state.domain.store.logger, `error`)
		.mockImplementation(() => {})
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: {
			...state.connection,
			subscribe: () => () => {},
			propose: (batch) =>
				state.connection.propose({ ...batch, id: `another-request` }),
		},
	})
	const receipt = await client.submit(state.operation(10))
	expect(await receipt.settled).toMatchObject({
		status: `interrupted`,
		reason: `invalid-response`,
	})
	expect(client.state.pendingBatchIds).toEqual([])
	expect(client.state.revision).toBe(0)
	log.mockRestore()
})

test.each([true, false])(
	`disposing from a receipt observer keeps it terminal (offline: %s)`,
	async (disconnected) => {
		const state = await setup()
		const propose = vi.fn(state.connection.propose)
		const delivered: MosaicDomainBatchSubmission[] = []
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			onSubmission: (receipt) => {
				delivered.push(receipt)
				client[Symbol.dispose]()
			},
			transport: {
				...state.connection,
				recover: () =>
					disconnected
						? Promise.reject(new Error(`offline`))
						: state.connection.recover(),
				propose,
			},
		})
		const receipt = await client.submit(state.operation(11))
		expect(receipt).toBe(delivered[0])
		expect(await receipt.settled).toMatchObject({
			status: `interrupted`,
			reason: `disposed`,
		})
		expect(receipt.state.status).toBe(`interrupted`)
		expect(propose).not.toHaveBeenCalled()
	},
)

test.each([`direct`, `transaction`] as const)(
	`%s preparation does not mistake invalid recovery for offline operation`,
	async (mode) => {
		const state = await setup()
		const log = vi
			.spyOn(state.domain.store.logger, `error`)
			.mockImplementation(() => {})
		const submitted = vi.fn()
		using client = createMosaicDomainBatchClient({
			actor: `alice`,
			session: `alice-tab`,
			domain: state.domain,
			onSubmission: submitted,
			transport: {
				...state.connection,
				recover: () => Promise.resolve({ headRevision: 1, tail: [] }),
			},
		})
		if (mode === `direct`) {
			await expect(client.submit(state.operation(12))).rejects.toThrow(
				`incomplete tail`,
			)
			expect(state.silo.getState(state.valueAtom)).toBe(0)
		} else {
			const editTransaction = state.silo.transaction<() => void>({
				key: `edit`,
				do: ({ set }) => {
					set(state.valueAtom, 12)
				},
			})
			using bridge = createMosaicDomainTransactionBridge({
				client,
				domain: state.domain,
				transactions: [editTransaction],
			})
			state.silo.runTransaction(editTransaction)()
			await expect(bridge.flush()).rejects.toThrow(`incomplete tail`)
			expect(bridge.pendingCommitCount).toBe(1)
		}
		expect(client.state.status).toBe(`rejected`)
		expect(submitted).not.toHaveBeenCalled()
		log.mockRestore()
	},
)

test(`rejected offline work cannot change the outcomes of resequenced sibling submissions`, async () => {
	const state = await setup()
	let connected = false
	let rejectFirst = true
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: {
			...state.connection,
			propose: (batch) => {
				if (!connected) return Promise.reject(new Error(`offline`))
				if (rejectFirst) {
					rejectFirst = false
					return Promise.resolve({
						status: `rejected` as const,
						rejection: {
							batchId: batch.id,
							code: `unauthorized` as const,
							reason: `Rejected first gesture`,
							recovery: `discard-batch` as const,
						},
					})
				}
				return state.connection.propose(batch)
			},
		},
	})
	const [first, second, third] = await Promise.all(
		[1, 2, 3].map((value) => client.submit(state.operation(value))),
	)
	connected = true
	await client.flush()
	expect(await first.settled).toMatchObject({
		status: `rejected`,
		rejection: { reason: `Rejected first gesture` },
	})
	expect(client.state.pendingBatchIds).toEqual([
		second.identity.requestId,
		third.identity.requestId,
	])
	await client.flush()
	expect(await second.settled).toMatchObject({
		status: `accepted`,
		value: { revision: 1 },
	})
	expect(await third.settled).toMatchObject({
		status: `accepted`,
		value: { revision: 2 },
	})
	expect(first.state.status).toBe(`rejected`)
	expect(state.silo.getState(state.valueAtom)).toBe(3)
})

test(`receipt observers see the corresponding committed client snapshot`, async () => {
	const state = await setup()
	const observations: unknown[] = []
	using client = createMosaicDomainBatchClient({
		actor: `alice`,
		session: `alice-tab`,
		domain: state.domain,
		transport: state.connection,
		onSubmission: (receipt) => {
			observations.push(
				client.state.pendingBatchIds.includes(receipt.identity.requestId),
			)
			receipt.subscribe((result) => {
				if (result.status === `accepted`)
					observations.push([
						result.value.revision,
						client.state.revision,
						client.state.pendingBatchIds.length,
					])
			})
		},
	})
	await client.start()
	const receipt = await client.submit(state.operation(1))
	await receipt.settled
	expect(observations).toEqual([true, [1, 1, 0]])
})
