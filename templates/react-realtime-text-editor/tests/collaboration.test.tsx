import { waitFor } from "@testing-library/react"
import {
	headless,
	type HeadlessRealtimeTestClient,
} from "atom.io/realtime-testing"

import { createMarkdownDocumentService } from "../node/service.ts"
import {
	createMarkdownCollaborationClient,
	type MarkdownCollaborationClient,
} from "../src/collaboration-client.ts"
import type { Identity } from "../src/identities.ts"
import { createMarkdownWorkspaceState } from "../src/workspace-state.ts"

const ADA = { color: `#7057ff`, id: `ada`, name: `Ada` } satisfies Identity
const LIN = { color: `#df527c`, id: `lin`, name: `Lin` } satisfies Identity
const sessions = { ada: `test:ada`, lin: `test:lin` } as const

type RuntimeRegistry = Map<string, MarkdownCollaborationClient>

const INITIAL = `# Bounded notes\n\n${Array.from(
	{ length: 10 },
	(_, index) =>
		`Paragraph ${index} has enough text to exercise partial residency.`,
).join(`\n\n`)}\n`

async function scenario(
	options: {
		readonly presenceRenewalMs?: number
		readonly presenceTtlMs?: number
	} = {},
) {
	const service = await createMarkdownDocumentService({
		initialText: INITIAL,
		presenceTtlMs: options.presenceTtlMs,
	})
	const runtimes: RuntimeRegistry = new Map()
	const room = headless({
		scenarioId: `mosaic-markdown-domain`,
		server: (tools) => {
			const binding = tools.work.track(
				service.bindSocket({
					actor: tools.userKey.replace(/^user::/u, ``),
					session: tools.sessionId,
					socket: tools.socket,
				}),
				`bind Markdown Domain socket`,
			)
			return () => {
				void binding.then((cleanup) => cleanup())
			}
		},
	})
	return {
		room,
		runtimes,
		service,
		presenceRenewalMs: options.presenceRenewalMs,
		async teardown() {
			for (const runtime of runtimes.values()) runtime[Symbol.dispose]()
			runtimes.clear()
			await room.teardown()
			service[Symbol.dispose]()
		},
	}
}

async function initialize(room: Awaited<ReturnType<typeof scenario>>): Promise<{
	ada: HeadlessRealtimeTestClient
	lin: HeadlessRealtimeTestClient
}> {
	const harness = {
		ada: room.room.createClient({
			name: `ada`,
			sessionId: sessions.ada,
			userKey: `user::ada`,
		}),
		lin: room.room.createClient({
			name: `lin`,
			sessionId: sessions.lin,
			userKey: `user::lin`,
		}),
	}
	const [ada, lin] = await Promise.all([
		createMarkdownCollaborationClient({
			identity: ADA,
			presenceRenewalMs: room.presenceRenewalMs,
			sessionId: sessions.ada,
			silo: harness.ada.silo,
			socket: harness.ada.socket,
		}),
		createMarkdownCollaborationClient({
			identity: LIN,
			presenceRenewalMs: room.presenceRenewalMs,
			sessionId: sessions.lin,
			silo: harness.lin.silo,
			socket: harness.lin.socket,
		}),
	])
	room.runtimes.set(sessions.ada, ada)
	room.runtimes.set(sessions.lin, lin)
	return harness
}

async function live(room: Awaited<ReturnType<typeof scenario>>) {
	await waitFor(
		() => {
			expect(room.runtimes.get(sessions.ada)?.status().connection).toBe(`live`)
			expect(room.runtimes.get(sessions.lin)?.status().connection).toBe(`live`)
		},
		{ timeout: 5_000 },
	)
	return {
		ada: room.runtimes.get(sessions.ada)!,
		lin: room.runtimes.get(sessions.lin)!,
	}
}

describe(`incremental realtime Markdown Domain`, () => {
	test(`the store-owned workspace hydrates its initial viewport`, async () => {
		const setup = await scenario()
		try {
			const harness = await initialize(setup)
			const clients = await live(setup)
			const observeErrors: unknown[] = []
			const originalObserveRange = clients.ada.projection.observeRange
			const observeRange = vi
				.spyOn(clients.ada.projection, `observeRange`)
				.mockImplementation(async (...parameters) => {
					try {
						return await originalObserveRange(...parameters)
					} catch (error) {
						observeErrors.push(error)
						throw error
					}
				})
			const workspace = createMarkdownWorkspaceState({
				client: clients.ada,
				silo: harness.ada.silo,
			})
			try {
				await waitFor(() => {
					expect(harness.ada.silo.getState(workspace.totalLength)).toBe(
						INITIAL.length,
					)
				})
				expect(observeRange.mock.calls.map(([range]) => range)).toEqual([
					{ end: INITIAL.length, kind: `utf16-range`, start: 0 },
				])
				await waitFor(() => {
					expect(observeErrors).toEqual([])
					expect(observeRange).toHaveBeenCalled()
					expect(harness.ada.silo.getState(workspace.view)).toMatchObject({
						projection: { text: INITIAL },
						status: `ready`,
					})
				})
			} finally {
				workspace[Symbol.dispose]()
			}
		} finally {
			await setup.teardown()
		}
	})

	test(`rejects invalid presence renewal intervals before allocating a Domain`, async () => {
		await expect(
			createMarkdownCollaborationClient({
				identity: ADA,
				presenceRenewalMs: 0,
				sessionId: `invalid-presence-renewal`,
				silo: {} as never,
				socket: {} as never,
			}),
		).rejects.toThrow(`positive integer`)
	})

	test(`hydrates viewport first, converges contention/offline work, and keeps selective history foreign-safe`, async () => {
		const setup = await scenario()
		try {
			const harness = await initialize(setup)
			const clients = await live(setup)
			const length = await clients.ada.projection.readLength()
			const [first, last] = await Promise.all([
				clients.ada.projection.acquireRange({
					end: 512,
					kind: `utf16-range`,
					start: 0,
				}),
				clients.lin.projection.acquireRange({
					end: length,
					kind: `utf16-range`,
					start: length - 512,
				}),
			])
			expect(first.read().text).toBe(INITIAL.slice(0, 512))
			expect(last.read().text).toBe(INITIAL.slice(-512))
			expect(setup.service.instrumentation.materializations).toBe(0)
			expect(clients.ada.residency.state.residentMemberCount).toBeLessThan(12)
			expect(clients.lin.residency.state.residentMemberCount).toBeLessThan(12)
			expect(
				await clients.ada.residency.resident(
					clients.ada.domain.address(`source`),
				),
			).toBeNull()

			const shrinkStart = await clients.ada.projection.positionAtOffset(2)
			const shrinkEnd = await clients.ada.projection.positionAtOffset(28)
			await clients.ada.replace({
				selection: { anchor: shrinkStart, head: shrinkEnd },
				text: `[Ada-shrinks]`,
			})
			expect(first.read().text).toContain(`[Ada-shrinks]`)
			expect(first.read().text).not.toContain(`Field notes for the launch`)

			const sameBoundary = await clients.ada.projection.positionAtOffset(16)
			await Promise.all([
				clients.ada.replace({
					selection: { anchor: sameBoundary, head: sameBoundary },
					text: `[Ada]`,
				}),
				clients.lin.replace({
					selection: { anchor: sameBoundary, head: sameBoundary },
					text: `[Lin]`,
				}),
			])
			const contended = await clients.ada.projection.materialize()
			expect(contended).toContain(`[Ada]`)
			expect(contended).toContain(`[Lin]`)
			await waitFor(() => {
				expect(first.read().text).toContain(`[Ada]`)
				expect(first.read().text).toContain(`[Lin]`)
			})
			await waitFor(async () => {
				expect(await clients.ada.projection.readLength()).toBe(contended.length)
			})

			const adaEnd = await clients.ada.projection.positionAtOffset(
				contended.length,
			)
			await clients.ada.replace({
				selection: { anchor: adaEnd, head: adaEnd },
				text: `[Ada-history]`,
			})
			const afterAda = await clients.lin.projection.materialize()
			await waitFor(async () => {
				expect(await clients.lin.projection.readLength()).toBe(afterAda.length)
			})
			const linEnd = await clients.lin.projection.positionAtOffset(
				afterAda.length,
			)
			await clients.lin.replace({
				selection: { anchor: linEnd, head: linEnd },
				text: `[Lin-foreign]`,
			})
			expect(await clients.ada.undo()).toBe(true)
			const undone = await clients.lin.projection.materialize()
			expect(undone).not.toContain(`[Ada-history]`)
			expect(undone).toContain(`[Lin-foreign]`)
			expect(await clients.ada.redo()).toBe(true)
			await last.release()

			harness.ada.socket.disconnect()
			const offlineAnchor = await clients.ada.projection.positionAtOffset(4)
			const pending = clients.ada.replace({
				selection: { anchor: offlineAnchor, head: offlineAnchor },
				text: `[offline]`,
			})
			const foreignAnchor = await clients.lin.projection.positionAtOffset(4)
			await clients.lin.replace({
				selection: { anchor: foreignAnchor, head: foreignAnchor },
				text: `[online]`,
			})
			harness.ada.socket.connect()
			await waitFor(() => expect(clients.ada.status().connection).toBe(`live`), {
				timeout: 5_000,
			})
			await pending
			await setup.room.waitForIdle()
			await first.release()
			const reconnected = await clients.lin.projection.materialize()
			expect(reconnected).toContain(`[offline]`)
			expect(reconnected).toContain(`[online]`)
			expect(setup.service.instrumentation.lastBatchOperations).toBeLessThan(16)

			const resetStart = await clients.ada.projection.positionAtOffset(0)
			const resetEnd = await clients.ada.projection.positionAtOffset(
				reconnected.length,
			)
			await clients.ada.replace({
				selection: { anchor: resetStart, head: resetEnd },
				text: ``,
			})
			await waitFor(async () => {
				expect(await clients.lin.projection.readLength()).toBe(0)
			})
			expect(await clients.lin.projection.materialize()).toBe(``)
			await expect(setup.service.positionAtOffset(1)).rejects.toThrow(
				`outside the Mosaic text index`,
			)
			const empty = await clients.ada.projection.positionAtOffset(0)
			expect(empty).toEqual({ affinity: `left`, offset: 0, runId: null })
			await clients.ada.replace({
				selection: { anchor: empty, head: empty },
				text: `[reset-all]`,
			})
			await waitFor(async () => {
				expect(await clients.lin.projection.materialize()).toBe(`[reset-all]`)
			})
		} finally {
			await setup.teardown()
		}
	})

	test(`presence is logical/ephemeral and import is one authorized resnapshot cut`, async () => {
		const setup = await scenario({
			presenceRenewalMs: 20,
			presenceTtlMs: 80,
		})
		try {
			const harness = await initialize(setup)
			const clients = await live(setup)
			const caretOffset = INITIAL.lastIndexOf(`partial residency`)
			const caret = await clients.ada.projection.positionAtOffset(caretOffset)
			await clients.ada.publishPresence({
				color: ADA.color,
				name: ADA.name,
				selection: { anchor: caret, head: caret },
				viewport: null,
			})
			await setup.room.waitForIdle()
			await clients.lin.presence.flush()
			expect(
				clients.lin.presence.state.presence.some(
					(envelope) => envelope.kind === `update` && envelope.actor === ADA.id,
				),
			).toBe(true)
			const documentStart = await clients.lin.projection.positionAtOffset(0)
			const prefix = `[Lin-prefix]`
			await clients.lin.replace({
				selection: { anchor: documentStart, head: documentStart },
				text: prefix,
			})
			await waitFor(async () => {
				expect(await clients.lin.projection.resolvePosition(caret)).toBe(
					caretOffset + prefix.length,
				)
			})
			await new Promise((resolve) => setTimeout(resolve, 200))
			await setup.room.waitForIdle()
			await clients.lin.presence.flush()
			expect(
				clients.lin.presence.state.presence.some(
					(envelope) => envelope.kind === `update` && envelope.actor === ADA.id,
				),
			).toBe(true)
			harness.ada.socket.disconnect()
			await waitFor(() =>
				expect(
					clients.lin.presence.state.presence.some(
						(envelope) =>
							envelope.kind === `update` && envelope.actor === ADA.id,
					),
				).toBe(false),
			)

			const importedRange = await clients.lin.projection.acquireRange({
				end: 16,
				kind: `utf16-range`,
				start: 0,
			})
			const revision = setup.service.revision
			await expect(
				setup.service.command({
					actor: LIN.id,
					command: {
						gestureId: `unauthorized-import`,
						sequence: 1,
						text: `denied`,
						type: `import`,
					},
					session: `lin-admin`,
				}),
			).rejects.toThrow(`authorized`)
			await setup.service.command({
				actor: ADA.id,
				command: {
					gestureId: `authorized-import`,
					sequence: 1,
					text: `# Imported once\n\n${`x`.repeat(100_000)}`,
					type: `import`,
				},
				session: `ada-admin`,
			})
			expect(setup.service.revision).toBe(revision + 1)
			expect(setup.service.materialize().startsWith(`# Imported once`)).toBe(
				true,
			)
			expect(setup.service.instrumentation.lastBatchOperations).toBeGreaterThan(
				4,
			)
			await waitFor(() =>
				expect(importedRange.read().text.startsWith(`# Imported once`)).toBe(
					true,
				),
			)
			await setup.service.command({
				actor: ADA.id,
				command: {
					gestureId: `authorized-merge`,
					sequence: 2,
					text: `# Compacted again\n`,
					type: `import`,
				},
				session: `ada-admin`,
			})
			expect(setup.service.revision).toBe(revision + 2)
			await waitFor(() =>
				expect(importedRange.read().text).toBe(`# Compacted agai`),
			)
			await importedRange.release()
		} finally {
			await setup.teardown()
		}
	})

	test(`settles an offline command when its collaboration client is disposed`, async () => {
		const setup = await scenario()
		try {
			const harness = await initialize(setup)
			const clients = await live(setup)
			const caret = await clients.ada.projection.positionAtOffset(4)
			harness.ada.socket.disconnect()
			await waitFor(() =>
				expect(clients.ada.status().connection).toBe(`offline`),
			)
			const pending = clients.ada.replace({
				selection: { anchor: caret, head: caret },
				text: `[abandoned]`,
			})
			await Promise.resolve()
			clients.ada[Symbol.dispose]()
			await expect(pending).rejects.toThrow(`disposed`)
		} finally {
			await setup.teardown()
		}
	})
})
