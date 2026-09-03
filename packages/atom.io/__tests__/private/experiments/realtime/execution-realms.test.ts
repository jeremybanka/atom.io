import { spawn } from "node:child_process"
import { Worker } from "node:worker_threads"

import * as RTT from "atom.io/realtime-testing"

const request = async (
	client: RTT.RealtimeExecutionRealmClient<string, string>,
	message: string,
): Promise<string> =>
	new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`realm timed out`))
		}, 1_000)
		const unsubscribe = client.bridge.subscribe((response) => {
			clearTimeout(timer)
			unsubscribe()
			resolve(response)
		})
		void client.bridge.send(message).catch(reject)
	})

describe(`optional execution realms`, () => {
	test(`runs a bounded load fixture with hundreds of fast headless clients`, async () => {
		const adapter = RTT.createInProcessExecutionRealmAdapter<string, string>(
			({ emit }) => ({
				memoryUsage: () => 64,
				receive: (message) => {
					emit(`ack:${message}`)
				},
			}),
		)
		const acknowledgements = new Set<string>()
		const report = await RTT.runRealtimeLoadFixture({
			adapter,
			clients: 250,
			exercise: async (client, index) => {
				const unsubscribe = client.bridge.subscribe((message) =>
					acknowledgements.add(`${client.id}:${message}`),
				)
				await client.bridge.send(String(index))
				unsubscribe()
			},
			waitForConvergence: () => {
				expect(acknowledgements.size).toBe(250)
			},
		})
		expect(report.clientCount).toBe(250)
		expect(report.memoryBytes).toBe(16_000)
		expect(
			report.clients.every(({ sent, received }) => sent === 1 && received === 1),
		).toBe(true)
		expect(report.clients.every(({ peakPending }) => peakPending === 1)).toBe(
			true,
		)
	})

	test(`bounds load clients and reports individual convergence timing`, async () => {
		let time = 0
		const adapter = RTT.createInProcessExecutionRealmAdapter<string, string>(
			({ emit }) => ({
				receive: (message) => {
					emit(message)
				},
			}),
		)
		await expect(
			RTT.runRealtimeLoadFixture({
				adapter,
				clients: 2,
				maxClients: 1,
				waitForConvergence: () => {},
			}),
		).rejects.toThrow(`maxClients`)
		const report = await RTT.runRealtimeLoadFixture({
			adapter,
			clients: 2,
			now: () => time,
			waitForClientConvergence: (_client, index) => {
				time += index + 1
			},
			waitForConvergence: () => {
				time++
			},
		})
		expect(report.clients.map(({ convergenceMs }) => convergenceMs)).toEqual([
			1, 3,
		])
		expect(report.convergenceMs).toBe(4)
		expect(report.memoryBytes).toBeNull()
	})

	test(`crosses a real worker realm through the structural bridge`, async () => {
		const adapter = RTT.createWorkerExecutionRealmAdapter<string, string>(() => {
			const worker = new Worker(
				`const { parentPort } = require("node:worker_threads"); parentPort.on("message", value => parentPort.postMessage("worker:" + value));`,
				{ eval: true },
			)
			return {
				close: async () => {
					await worker.terminate()
				},
				post: (message: string) => {
					worker.postMessage(message)
				},
				subscribe: (listener: (message: string) => void) => {
					worker.on(`message`, listener)
					return () => worker.off(`message`, listener)
				},
			}
		})
		const client = await adapter.create(`worker-client`)
		await expect(request(client, `hello`)).resolves.toBe(`worker:hello`)
		expect(client.bridge.metrics()).toMatchObject({ received: 1, sent: 1 })
		await client.dispose()
	})

	test(`uses the same lifecycle for process and browser-style bridges`, async () => {
		const processAdapter = RTT.createProcessExecutionRealmAdapter<
			string,
			string
		>(() => {
			const child = spawn(
				process.execPath,
				[
					`-e`,
					`process.on("message", value => process.send("process:" + value));`,
				],
				{ stdio: [`ignore`, `ignore`, `inherit`, `ipc`] },
			)
			return {
				close: () => {
					child.kill()
				},
				post: (message: string) =>
					new Promise<void>((resolve, reject) => {
						child.send(message, (error) => {
							if (error) reject(error)
							else resolve()
						})
					}),
				subscribe: (listener: (message: string) => void) => {
					child.on(`message`, listener)
					return () => child.off(`message`, listener)
				},
			}
		})
		const browserListeners = new Set<(message: string) => void>()
		const browserAdapter = RTT.createBrowserExecutionRealmAdapter<
			string,
			string
		>(() => ({
			post: (message) => {
				queueMicrotask(() => {
					for (const listener of browserListeners) listener(`browser:${message}`)
				})
			},
			subscribe: (listener) => {
				browserListeners.add(listener)
				return () => browserListeners.delete(listener)
			},
		}))

		const processClient = await processAdapter.create(`process-client`)
		const browserClient = await browserAdapter.create(`browser-client`)
		await expect(request(processClient, `hello`)).resolves.toBe(`process:hello`)
		await expect(request(browserClient, `hello`)).resolves.toBe(`browser:hello`)
		expect(processClient.kind).toBe(`process`)
		expect(browserClient.kind).toBe(`browser`)
		await Promise.all([processClient.dispose(), browserClient.dispose()])
	})

	test(`rejects post-close traffic and only closes a bridged endpoint once`, async () => {
		let closed = 0
		const adapter = RTT.createBrowserExecutionRealmAdapter<string, string>(
			() => ({
				close: () => {
					closed++
				},
				post: () => {},
				subscribe: () => () => {},
			}),
		)
		const client = await adapter.create(`browser`)
		await client.dispose()
		await client.bridge.close()
		expect(closed).toBe(1)
		await expect(client.bridge.send(`late`)).rejects.toThrow(`closed`)
		expect(() => client.bridge.subscribe(() => {})).toThrow(`closed`)

		const local = await RTT.createInProcessExecutionRealmAdapter<string, string>(
			() => ({ receive: () => {} }),
		).create(`local`)
		await local.dispose()
		await expect(local.bridge.send(`late`)).rejects.toThrow(`closed`)
		expect(() => local.bridge.subscribe(() => {})).toThrow(`closed`)

		await expect(adapter.create(``)).rejects.toThrow(`cannot be empty`)
		let resolvePost!: () => void
		const pendingAdapter = RTT.createBrowserExecutionRealmAdapter<
			string,
			string
		>(() => ({
			memoryUsage: () => 128,
			post: () =>
				new Promise<void>((resolve) => {
					resolvePost = resolve
				}),
			subscribe: () => () => {},
		}))
		const pending = await pendingAdapter.create(`pending`)
		const sending = pending.bridge.send(`message`)
		expect(pending.bridge.metrics()).toMatchObject({
			pending: 1,
			peakPending: 1,
		})
		resolvePost()
		await sending
		expect(pending.bridge.metrics()).toMatchObject({
			memoryBytes: 128,
			pending: 0,
		})
		await pending.dispose()
	})
})
