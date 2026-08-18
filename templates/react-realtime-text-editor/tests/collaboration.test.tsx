import { act, waitFor } from "@testing-library/react"
import { Silo } from "atom.io"
import { RealtimeContext } from "atom.io/realtime-react"
import { multiClient, type RealtimeTestClient } from "atom.io/realtime-testing"
import { createElement, useContext, useEffect, useMemo, useState } from "react"

import { createMarkdownDocumentService } from "../node/service.ts"
import {
	createMarkdownCollaborationClient,
	type MarkdownCollaborationClient,
} from "../src/collaboration-client.ts"
import type { Identity } from "../src/identities.ts"

const ADA = { color: `#7057ff`, id: `ada`, name: `Ada` } satisfies Identity
const LIN = { color: `#df527c`, id: `lin`, name: `Lin` } satisfies Identity
const sessions = { ada: `test:ada`, lin: `test:lin` } as const

type RuntimeRegistry = Map<string, MarkdownCollaborationClient>

const INITIAL = `# Bounded notes\n\n${Array.from(
	{ length: 10 },
	(_, index) =>
		`Paragraph ${index} has enough text to exercise partial residency.`,
).join(`\n\n`)}\n`

function testClient(
	identity: Identity,
	sessionId: string,
	runtimes: RuntimeRegistry,
) {
	return function MarkdownTestClient() {
		const { socket } = useContext(RealtimeContext)
		const silo = useMemo(
			() =>
				new Silo({
					isProduction: false,
					lifespan: `ephemeral`,
					name: `markdown-test:${sessionId}`,
				}),
			[sessionId],
		)
		const [runtime, setRuntime] = useState<MarkdownCollaborationClient | null>(
			null,
		)
		const [problem, setProblem] = useState<string | null>(null)
		useEffect(() => {
			if (socket === null) return
			let active = true
			let created: MarkdownCollaborationClient | null = null
			void createMarkdownCollaborationClient({
				identity,
				sessionId,
				silo,
				socket,
			}).then(
				(client) => {
					created = client
					if (!active) {
						client[Symbol.dispose]()
						return
					}
					runtimes.set(sessionId, client)
					setRuntime(client)
				},
				(error: unknown) =>
					setProblem(error instanceof Error ? error.message : String(error)),
			)
			return () => {
				active = false
				runtimes.delete(sessionId)
				created?.[Symbol.dispose]()
			}
		}, [silo, socket])
		return createElement(
			`output`,
			{ "data-testid": `status` },
			problem ?? runtime?.status().connection ?? `connecting`,
		)
	}
}

async function scenario() {
	const service = await createMarkdownDocumentService({ initialText: INITIAL })
	const runtimes: RuntimeRegistry = new Map()
	const room = multiClient({
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
		clients: {
			ada: testClient(ADA, sessions.ada, runtimes),
			lin: testClient(LIN, sessions.lin, runtimes),
		},
	})
	return {
		room,
		runtimes,
		service,
		async teardown() {
			await room.teardown()
			service[Symbol.dispose]()
		},
	}
}

function initialize(room: Awaited<ReturnType<typeof scenario>>): {
	ada: RealtimeTestClient
	lin: RealtimeTestClient
} {
	return {
		ada: room.room.clients.ada.init({
			sessionId: sessions.ada,
			userKey: `user::ada`,
		}),
		lin: room.room.clients.lin.init({
			sessionId: sessions.lin,
			userKey: `user::lin`,
		}),
	}
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
	test(`hydrates viewport first, converges contention/offline work, and keeps selective history foreign-safe`, async () => {
		const setup = await scenario()
		try {
			const harness = initialize(setup)
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

			act(() => harness.ada.socket.disconnect())
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
			act(() => harness.ada.socket.connect())
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
		} finally {
			await setup.teardown()
		}
	})

	test(`presence is logical/ephemeral and import is one authorized resnapshot cut`, async () => {
		const setup = await scenario()
		try {
			const harness = initialize(setup)
			const clients = await live(setup)
			const caret = await clients.ada.projection.positionAtOffset(8)
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
			act(() => harness.ada.socket.disconnect())
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
})
