import { encodeRealtimePayload, realtimeCommand } from "@atom.io/realtime"
import { createRealtimeCommandClient } from "@atom.io/realtime/client"
import {
	createRealtimeCommandServer,
	realtimeCommandHandler,
} from "@atom.io/realtime/server"
import { z } from "zod"

const command = realtimeCommand({
	name: `increment`,
	parameters: z.number(),
	result: z.number(),
})
const context = { actor: `alice`, session: `tab-1` }
const request = {
	resource: `increment`,
	session: context.session,
	requestId: `one`,
	parameters: 2,
}

describe(`validated commands`, () => {
	test(`validates parameters, allowlists commands, and does not trust request identity`, async () => {
		const execute = vi.fn(() => 3)
		const server = createRealtimeCommandServer({
			handlers: [
				realtimeCommandHandler(command, { authorize: () => true, execute }),
			],
		})
		for (const input of [
			{ ...request, parameters: `bad` },
			{ ...request, session: `forged` },
			{ ...request, resource: `admin` },
		]) {
			expect((await server.handle(context, input)).status).toBe(`rejected`)
		}
		expect(execute).not.toHaveBeenCalled()
		expect(await server.handle(context, request)).toMatchObject({
			status: `accepted`,
			value: 3,
			session: context.session,
		})
	})

	test(`deduplicates concurrent requests, detects collisions, and isolates identities`, async () => {
		const execute = vi.fn(() => Promise.resolve(3))
		const server = createRealtimeCommandServer({
			handlers: [
				realtimeCommandHandler(command, { authorize: () => true, execute }),
			],
		})
		const [first, second] = await Promise.all([
			server.handle(context, request),
			server.handle(context, { ...request }),
		])
		expect(first).toEqual(second)
		expect(execute).toHaveBeenCalledTimes(1)
		expect(
			await server.handle(context, { ...request, parameters: 4 }),
		).toMatchObject({ rejection: { code: `collision` } })
		await server.handle({ ...context, actor: `bob` }, request)
		expect(execute).toHaveBeenCalledTimes(2)
	})

	test(`rechecks authority before replay and can reject duplicates explicitly`, async () => {
		let allowed = true
		const server = createRealtimeCommandServer({
			duplicate: `reject`,
			handlers: [
				realtimeCommandHandler(command, {
					authorize: () => allowed,
					execute: () => 3,
				}),
			],
		})
		await server.handle(context, request)
		expect(await server.handle(context, request)).toMatchObject({
			rejection: { code: `duplicate` },
		})
		allowed = false
		expect(await server.handle(context, request)).toMatchObject({
			rejection: { code: `unauthorized` },
		})
	})

	test(`bounds receipt retention without evicting deduplication evidence`, async () => {
		const execute = vi.fn(() => 3)
		const server = createRealtimeCommandServer({
			maxRequests: 1,
			handlers: [
				realtimeCommandHandler(command, { authorize: () => true, execute }),
			],
		})
		await server.handle(context, request)
		expect(
			await server.handle(context, { ...request, requestId: `two` }),
		).toMatchObject({ rejection: { code: `capacity` }, retryable: false })
		expect((await server.handle(context, request)).status).toBe(`accepted`)
		expect(execute).toHaveBeenCalledTimes(1)
	})

	test(`bounds concurrent validation and blocks disposal during authorization`, async () => {
		let release!: (value: boolean) => void
		const execute = vi.fn(() => 3)
		const server = createRealtimeCommandServer({
			maxPending: 1,
			handlers: [
				realtimeCommandHandler(command, {
					authorize: () =>
						new Promise<boolean>((resolve) => {
							release = resolve
						}),
					execute,
				}),
			],
		})
		const waiting = server.handle(context, request)
		await Promise.resolve()
		expect(await server.handle(context, request)).toMatchObject({
			rejection: { code: `capacity` },
			retryable: true,
		})
		server.dispose()
		release(true)
		expect(await waiting).toMatchObject({ rejection: { code: `disposed` } })
		expect(execute).not.toHaveBeenCalled()
	})

	test(`does not expose exceptions or automatically retry an uncertain effect`, async () => {
		const execute = vi.fn(() => {
			throw new Error(`secret database details`)
		})
		const report = vi.fn()
		const server = createRealtimeCommandServer({
			onError: report,
			handlers: [
				realtimeCommandHandler(command, { authorize: () => true, execute }),
			],
		})
		const result = await server.handle(context, request)
		expect(result).toMatchObject({
			status: `rejected`,
			retryable: false,
			rejection: { code: `failed` },
		})
		expect(JSON.stringify(result)).not.toContain(`secret`)
		await server.handle(context, request)
		expect(execute).toHaveBeenCalledTimes(1)
		expect(report).toHaveBeenCalledTimes(1)
	})

	test(`provides independent correlated receipts and validates server replies`, async () => {
		const server = createRealtimeCommandServer({
			handlers: [
				realtimeCommandHandler(command, {
					authorize: () => true,
					execute: (_, value) => value + 1,
				}),
			],
		})
		const client = createRealtimeCommandClient({
			session: context.session,
			request: (input) => server.handle(context, input),
		})
		const first = client.submit(command, 2, `first`)
		const second = client.submit(command, 5, `second`)
		expect(await first.settled).toMatchObject({
			requestId: `first`,
			status: `accepted`,
			value: 3,
		})
		expect(await second.settled).toMatchObject({
			requestId: `second`,
			status: `accepted`,
			value: 6,
		})
		const invalid = createRealtimeCommandClient({
			session: context.session,
			request: () =>
				Promise.resolve({
					...request,
					requestId: `other`,
					status: `accepted`,
					value: 3,
				}),
		})
		expect(await invalid.submit(command, 2, `first`).settled).toMatchObject({
			status: `interrupted`,
		})
	})

	test(`disposal settles pending receipts even when transport never returns`, async () => {
		const client = createRealtimeCommandClient({
			session: context.session,
			request: () => new Promise(() => {}),
		})
		const receipt = client.submit(command, 2, `first`)
		client.dispose()
		expect(await receipt.settled).toMatchObject({
			status: `interrupted`,
			reason: `disposed`,
		})
	})

	test(`bounds bytes, depth, and JSON validity before schema work`, () => {
		expect(encodeRealtimePayload({ value: `é`.repeat(100) }, 150)).toBeNull()
		expect(encodeRealtimePayload({ value: Number.NaN })).toBeNull()
		expect(encodeRealtimePayload({ value: undefined })).toBeNull()
		const cycle: Record<string, unknown> = {}
		cycle[`self`] = cycle
		expect(encodeRealtimePayload(cycle)).toBeNull()
		expect(encodeRealtimePayload({ value: 3 })).toBe(`{"value":3}`)
	})
})

test(`snapshots requests and authenticated context across awaits and isolates replay results`, async () => {
	const objectCommand = realtimeCommand({
		name: `rename`,
		parameters: z.object({ name: z.string() }),
		result: z.object({ name: z.string() }),
	})
	let release!: (allowed: boolean) => void
	const authenticated = { ...context }
	const input = {
		...request,
		resource: `rename`,
		parameters: { name: `original` },
	}
	const execute = vi.fn((_context, parameters) => parameters)
	let paused = true
	const server = createRealtimeCommandServer({
		handlers: [
			realtimeCommandHandler(objectCommand, {
				authorize: () =>
					paused
						? new Promise<boolean>((resolve) => {
								release = resolve
							})
						: true,
				execute,
			}),
		],
	})
	const first = server.handle(authenticated, input)
	await Promise.resolve()
	input.parameters.name = `mutated`
	authenticated.actor = `mallory`
	release(true)
	const output = await first
	expect(execute).toHaveBeenCalledWith(context, { name: `original` })
	if (output.status !== `accepted`) throw new Error(`Expected accepted result`)
	;(output.value as { name: string }).name = `corrupted`
	paused = false
	const duplicate = await server.handle(context, {
		...input,
		parameters: { name: `original` },
	})
	expect(duplicate).toMatchObject({
		status: `accepted`,
		value: { name: `original` },
	})
	expect(execute).toHaveBeenCalledTimes(1)
})
