import { act, waitFor } from "@testing-library/react"
import { Silo } from "atom.io"
import { RealtimeContext } from "atom.io/realtime-react"
import {
	InMemoryMosaicDomainCheckpointStorage,
	type MosaicDomainBatchAuthorizationContext,
} from "atom.io/realtime-server"
import {
	createRestartableServerFixture,
	multiClient,
	type RealtimeTestClient,
} from "atom.io/realtime-testing"
import { createElement, useContext, useEffect, useMemo, useState } from "react"

import { createVectorCollaborationService } from "../node/service.ts"
import {
	createVectorCollaborationClient,
	publishCollaboratorPresence,
	type VectorCollaborationClient,
} from "../src/collaboration-client.ts"
import {
	activeDragAtom,
	createSvgGestureClock,
	dragPresenceAtoms,
	materializeSvgOrder,
	nodeAtoms,
	readSvgRegister,
	structureViolationsSelector,
	subpathOrderAtoms,
	svgDragPresenceKey,
} from "../src/design-model.ts"
import type { Identity } from "../src/identities.ts"
import { INITIAL_DRAWING } from "../src/initial-drawing.ts"
import {
	VECTOR_BATCH_EVENTS,
	type VectorAcknowledgement,
} from "../src/protocol.ts"

const MAYA = { id: `maya`, name: `Maya`, color: `#8b7bff` } satisfies Identity
const THEO = { id: `theo`, name: `Theo`, color: `#ff6b9a` } satisfies Identity
const sessions = { maya: `test:maya`, theo: `test:theo` } as const

type RuntimeRegistry = Map<string, VectorCollaborationClient>

function testClient(
	identity: Identity,
	sessionId: string,
	runtimes: RuntimeRegistry,
) {
	return function VectorTestClient() {
		const { socket } = useContext(RealtimeContext)
		const silo = useMemo(
			() =>
				new Silo({
					isProduction: false,
					lifespan: `ephemeral`,
					name: `plane-test-client:${sessionId}`,
				}),
			[sessionId],
		)
		const [runtime, setRuntime] = useState<VectorCollaborationClient | null>(
			null,
		)
		const [creationProblem, setCreationProblem] = useState<string | null>(null)
		useEffect(() => {
			if (socket === null) return
			let active = true
			let created: VectorCollaborationClient | null = null
			void createVectorCollaborationClient({
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
				(error: unknown) => {
					setCreationProblem(
						error instanceof Error ? error.message : String(error),
					)
				},
			)
			return () => {
				active = false
				runtimes.delete(sessionId)
				created?.[Symbol.dispose]()
			}
		}, [silo, socket])
		if (runtime === null) {
			return createElement(
				`output`,
				{ "data-testid": `status` },
				creationProblem ?? `connecting`,
			)
		}
		const node = readSvgRegister(runtime.silo.getState(nodeAtoms, `mark-0`))
		return createElement(
			`main`,
			null,
			createElement(
				`output`,
				{ "data-testid": `status` },
				runtime.status().connection,
			),
			createElement(`output`, { "data-testid": `node` }, JSON.stringify(node)),
			createElement(
				`output`,
				{ "data-testid": `revision` },
				runtime.batch.state.revision,
			),
		)
	}
}

async function createScenario() {
	const storage = new InMemoryMosaicDomainCheckpointStorage()
	const runtimes: RuntimeRegistry = new Map()
	let denyStructural = false
	const authorize = ({
		batch,
	}: MosaicDomainBatchAuthorizationContext): boolean =>
		!denyStructural ||
		batch.operations.every(({ address }) => address.member !== `subpaths`)
	const restart = createRestartableServerFixture({
		name: `plane-vector-service`,
		createDurableState: () => storage,
		createEphemeralState: () => ({}),
		start: ({ durable }) =>
			createVectorCollaborationService({ authorize, storage: durable }),
		stop: (service) => {
			service[Symbol.dispose]()
		},
	})
	await restart.start()
	const room = multiClient({
		scenarioId: `plane-vector-editor`,
		server: (tools) => {
			const actor = tools.userKey.replace(/^user::/, ``)
			const binding = tools.work.track(
				restart.getRuntime().bindSocket({
					actor,
					session: tools.sessionId,
					socket: tools.socket,
				}),
				`bind vector collaboration socket`,
			)
			return () => {
				void binding.then((cleanup) => cleanup())
			}
		},
		clients: {
			maya: testClient(MAYA, sessions.maya, runtimes),
			theo: testClient(THEO, sessions.theo, runtimes),
		},
	})
	return {
		denyStructural() {
			denyStructural = true
		},
		restart,
		room,
		runtimes,
		storage,
		async teardown() {
			await room.teardown()
			if (restart.running) await restart.stop()
		},
	}
}

function initialize(room: Awaited<ReturnType<typeof createScenario>>): {
	maya: RealtimeTestClient
	theo: RealtimeTestClient
} {
	return {
		maya: room.room.clients.maya.init({
			sessionId: sessions.maya,
			userKey: `user::maya`,
		}),
		theo: room.room.clients.theo.init({
			sessionId: sessions.theo,
			userKey: `user::theo`,
		}),
	}
}

async function live(room: Awaited<ReturnType<typeof createScenario>>): Promise<{
	maya: VectorCollaborationClient
	theo: VectorCollaborationClient
}> {
	await waitFor(
		() => {
			expect(room.runtimes.get(sessions.maya)?.status().connection).toBe(`live`)
			expect(room.runtimes.get(sessions.theo)?.status().connection).toBe(`live`)
		},
		{ timeout: 5_000 },
	)
	return {
		maya: room.runtimes.get(sessions.maya)!,
		theo: room.runtimes.get(sessions.theo)!,
	}
}

async function seed(
	peers: { maya: VectorCollaborationClient; theo: VectorCollaborationClient },
	clock: ReturnType<typeof createSvgGestureClock>,
): Promise<void> {
	await peers.maya.editor.replaceDrawing({
		drawing: INITIAL_DRAWING,
		gesture: clock.begin(),
	})
	await peers.theo.batch.flush()
}

describe(`Plane realtime vector collaboration`, () => {
	test(`disjoint edits, contention, structural rejection, history, and offline replay converge`, async () => {
		const room = await createScenario()
		try {
			const clients = initialize(room)
			const peers = await live(room)
			const mayaClock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			const theoClock = createSvgGestureClock({
				actor: THEO.id,
				session: sessions.theo,
			})
			const failedRecovery = await new Promise<VectorAcknowledgement<unknown>>(
				(resolve) => {
					clients.maya.socket.emit(VECTOR_BATCH_EVENTS.recover, -1, resolve)
				},
			)
			expect(failedRecovery).toMatchObject({
				ok: false,
				reason: expect.any(String),
			})
			await seed(peers, mayaClock)

			await Promise.all([
				peers.maya.editor.commitGeometry({
					gesture: mayaClock.begin(),
					point: { x: 30, y: 40 },
					target: { kind: `node`, subpathId: `mark-0` },
				}),
				peers.theo.editor.commitGeometry({
					gesture: theoClock.begin(),
					point: { x: 190, y: 140 },
					target: { kind: `node`, subpathId: `mark-1` },
				}),
			])
			await room.room.waitForIdle()
			await Promise.all([peers.maya.batch.flush(), peers.theo.batch.flush()])
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 30, y: 40 })
			expect(
				readSvgRegister(peers.maya.silo.getState(nodeAtoms, `mark-1`)),
			).toEqual({ x: 190, y: 140 })

			await Promise.all([
				peers.maya.editor.commitGeometry({
					gesture: mayaClock.begin(),
					point: { x: 61, y: 62 },
					target: { kind: `node`, subpathId: `mark-2` },
				}),
				peers.theo.editor.commitGeometry({
					gesture: theoClock.begin(),
					point: { x: 91, y: 92 },
					target: { kind: `node`, subpathId: `mark-2` },
				}),
			])
			await Promise.all([peers.maya.batch.flush(), peers.theo.batch.flush()])
			expect(
				readSvgRegister(peers.maya.silo.getState(nodeAtoms, `mark-2`)),
			).toEqual(readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-2`)))

			await peers.maya.editor.commitGeometry({
				gesture: mayaClock.begin(),
				point: { x: 44, y: 45 },
				target: { kind: `node`, subpathId: `mark-0` },
			})
			await peers.theo.batch.flush()
			await peers.theo.editor.commitGeometry({
				gesture: theoClock.begin(),
				point: { x: 204, y: 150 },
				target: { kind: `node`, subpathId: `mark-1` },
			})
			await peers.maya.batch.flush()
			await peers.maya.editor.undo(mayaClock.begin())
			await peers.theo.batch.flush()
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 30, y: 40 })
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-1`)),
			).toEqual({ x: 204, y: 150 })
			await peers.maya.editor.redo(mayaClock.begin())
			await peers.theo.batch.flush()
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 44, y: 45 })
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-1`)),
			).toEqual({ x: 204, y: 150 })

			room.denyStructural()
			const before = materializeSvgOrder(
				peers.maya.silo.getState(subpathOrderAtoms, `plane-mark`),
			)
			await expect(
				peers.maya.editor.insertSubpath({
					edge: { kind: `line` },
					gesture: mayaClock.begin(),
					index: 1,
					node: { x: 120, y: 120 },
					pathId: `plane-mark`,
					subpathId: `denied-node`,
				}),
			).rejects.toThrow(`not authorized`)
			expect(
				materializeSvgOrder(
					peers.maya.silo.getState(subpathOrderAtoms, `plane-mark`),
				),
			).toEqual(before)
			expect(peers.maya.silo.getState(structureViolationsSelector)).toEqual([])
			await peers.maya.batch.flush()
			expect(peers.maya.status().connection).toBe(`live`)

			act(() => clients.maya.socket.disconnect())
			await peers.maya.editor.commitGeometry({
				gesture: mayaClock.begin(),
				point: { x: 77, y: 78 },
				target: { kind: `node`, subpathId: `mark-0` },
			})
			expect(peers.maya.status().connection).toBe(`offline`)
			act(() => clients.maya.socket.connect())
			await waitFor(() => expect(peers.maya.status().connection).toBe(`live`))
			await peers.theo.batch.flush()
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 77, y: 78 })
		} finally {
			await room.teardown()
		}
	})

	test(`logical presence and drag previews clear without durable mutation`, async () => {
		const room = await createScenario()
		try {
			const clients = initialize(room)
			const peers = await live(room)
			const seedClock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			await seed(peers, seedClock)
			await publishCollaboratorPresence(peers.maya, {
				activePathId: `plane-mark`,
				color: MAYA.color,
				name: MAYA.name,
				pointer: { x: 12, y: 13 },
				selectedSubpathId: `mark-0`,
			})
			await room.room.waitForIdle()
			await peers.theo.presence.flush()
			expect(
				peers.theo.presence.state.presence.some(
					({ address, actor }) =>
						address.member === `collaborator` && actor === MAYA.id,
				),
			).toBe(true)

			const before = readSvgRegister(
				peers.theo.silo.getState(nodeAtoms, `mark-0`),
			)
			const clock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			const gesture = clock.begin()
			await peers.maya.editor.beginDrag({
				element: {} as Element,
				gesture,
				point: { x: 32, y: 33 },
				pointerId: 1,
				target: { kind: `node`, subpathId: `mark-0` },
			})
			await room.room.waitForIdle()
			await peers.theo.presence.flush()
			expect(
				peers.theo.silo.getState(dragPresenceAtoms, svgDragPresenceKey(gesture)),
			).toMatchObject({ point: { x: 32, y: 33 } })
			act(() => clients.maya.socket.disconnect())
			await waitFor(() =>
				expect(
					peers.theo.silo.getState(
						dragPresenceAtoms,
						svgDragPresenceKey(gesture),
					),
				).toBeNull(),
			)
			expect(peers.maya.silo.getState(activeDragAtom)).toBeNull()
			expect(
				readSvgRegister(peers.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual(before)
		} finally {
			await room.teardown()
		}
	})

	test(`an incremental checkpoint survives a fresh server generation and fresh clients`, async () => {
		const room = await createScenario()
		try {
			let clients = initialize(room)
			const peers = await live(room)
			const clock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			await seed(peers, clock)
			await peers.maya.editor.commitGeometry({
				gesture: clock.begin(),
				point: { x: 101, y: 102 },
				target: { kind: `node`, subpathId: `mark-0` },
			})
			await peers.theo.batch.flush()
			const runtime = room.restart.getRuntime()
			const published = await runtime.checkpoints.checkpoint()
			const nodeAddress = peers.maya.domain.address(`nodes`, `mark-0`)
			const checkpoint = await runtime.checkpoints.recover([nodeAddress])
			expect(published.status).toBe(`checkpointed`)
			expect(checkpoint.rootKey).toBe(published.rootKey)
			expect(checkpoint.tail).toHaveLength(0)
			expect(checkpoint.members[0]?.value).toEqual(
				peers.maya.silo.getState(nodeAtoms, `mark-0`),
			)

			await Promise.all([clients.maya.dispose(), clients.theo.dispose()])
			await room.restart.restart({ durability: `preserve`, mode: `graceful` })
			const afterRestart = await room.restart
				.getRuntime()
				.checkpoints.recover([nodeAddress])
			expect(afterRestart.rootKey).toBe(published.rootKey)
			expect(afterRestart.members[0]?.value).toEqual(
				checkpoint.members[0]?.value,
			)
			clients = initialize(room)
			const restarted = await live(room)
			expect(
				readSvgRegister(restarted.maya.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 101, y: 102 })
			expect(
				readSvgRegister(restarted.theo.silo.getState(nodeAtoms, `mark-0`)),
			).toEqual({ x: 101, y: 102 })
		} finally {
			await room.teardown()
		}
	})
})
