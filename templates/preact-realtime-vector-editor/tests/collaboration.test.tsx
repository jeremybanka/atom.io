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
	contourActiveDragAtom,
	contourAtom,
	contourDragPresenceAtoms,
	createSvgGestureClock,
	readSvgContour,
	svgContourPresenceKey,
	svgContourSchema,
	svgContourStateSchema,
	type SvgContour,
} from "../src/design-model.ts"
import type { Identity } from "../src/identities.ts"
import {
	VECTOR_BATCH_EVENTS,
	type VectorAcknowledgement,
} from "../src/protocol.ts"

const MAYA = { id: `maya`, name: `Maya`, color: `#8b7bff` } satisfies Identity
const THEO = { id: `theo`, name: `Theo`, color: `#ff6b9a` } satisfies Identity
const sessions = { maya: `test:maya`, theo: `test:theo` } as const

type RuntimeRegistry = Map<string, VectorCollaborationClient>

function expectContourIntegrity(value: SvgContour): void {
	expect(svgContourSchema.parse(value)).toEqual(value)
	const degree = new Map(value.nodes.map(({ id }) => [id, 0]))
	for (const [index, node] of value.nodes.entries()) {
		const next = value.nodes[(index + 1) % value.nodes.length]
		degree.set(node.id, degree.get(node.id)! + 1)
		degree.set(next.id, degree.get(next.id)! + 1)
	}
	expect([...degree.values()]).toEqual(value.nodes.map(() => 2))
}

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
		return createElement(
			`main`,
			null,
			createElement(
				`output`,
				{ "data-testid": `status` },
				runtime.status().connection,
			),
			createElement(
				`output`,
				{ "data-testid": `contour` },
				JSON.stringify(readSvgContour(runtime.silo.getState(contourAtom))),
			),
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
	let denyContour = false
	const authorize = ({
		batch,
	}: MosaicDomainBatchAuthorizationContext): boolean =>
		!denyContour ||
		batch.operations.every(({ address }) => address.member !== `contour`)
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
			const binding = tools.work.track(
				restart.getRuntime().bindSocket({
					actor: tools.userKey.replace(/^user::/, ``),
					session: tools.sessionId,
					socket: tools.socket,
				}),
				`bind vector collaboration socket`,
			)
			return () => void binding.then((cleanup) => cleanup())
		},
		clients: {
			maya: testClient(MAYA, sessions.maya, runtimes),
			theo: testClient(THEO, sessions.theo, runtimes),
		},
	})
	return {
		allowContour() {
			denyContour = false
		},
		denyContour() {
			denyContour = true
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

function contour(client: VectorCollaborationClient): SvgContour {
	return readSvgContour(client.silo.getState(contourAtom))
}

describe(`Plane realtime closed-contour collaboration`, () => {
	test(`foreign participation plus selective undo cannot expose partial topology`, async () => {
		const room = await createScenario()
		try {
			initialize(room)
			const peers = await live(room)
			const mayaClock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			const theoClock = createSvgGestureClock({
				actor: THEO.id,
				session: sessions.theo,
			})

			await peers.maya.editor.addNode({
				gesture: mayaClock.begin(),
				index: 2,
				node: { id: `shared`, x: 128, y: 80 },
			})
			await peers.theo.batch.flush()
			await peers.theo.editor.moveNode({
				gesture: theoClock.begin(),
				nodeId: `shared`,
				point: { x: 132, y: 96 },
			})
			await peers.maya.batch.flush()
			await peers.maya.editor.undo(mayaClock.begin())
			await peers.theo.batch.flush()

			for (const client of [peers.maya, peers.theo]) {
				expectContourIntegrity(contour(client))
				expect(contour(client).nodes.find(({ id }) => id === `shared`)).toEqual({
					id: `shared`,
					x: 132,
					y: 96,
				})
			}

			await peers.theo.editor.undo(theoClock.begin())
			await peers.maya.batch.flush()
			for (const client of [peers.maya, peers.theo]) {
				expectContourIntegrity(contour(client))
				expect(contour(client).nodes.some(({ id }) => id === `shared`)).toBe(
					false,
				)
			}
		} finally {
			await room.teardown()
		}
	})

	test(`contention, rejection, and offline replay converge on valid contours`, async () => {
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

			await Promise.all([
				peers.maya.editor.moveNode({
					gesture: mayaClock.begin(),
					nodeId: `north-west`,
					point: { x: 48, y: 48 },
				}),
				peers.theo.editor.moveNode({
					gesture: theoClock.begin(),
					nodeId: `south-east`,
					point: { x: 208, y: 208 },
				}),
			])
			await room.room.waitForIdle()
			await Promise.all([peers.maya.batch.flush(), peers.theo.batch.flush()])
			expect(contour(peers.maya)).toEqual(contour(peers.theo))
			expectContourIntegrity(contour(peers.maya))

			room.denyContour()
			const before = contour(peers.maya)
			await expect(
				peers.maya.editor.addNode({
					gesture: mayaClock.begin(),
					index: 1,
					node: { id: `denied`, x: 120, y: 120 },
				}),
			).rejects.toThrow(`not authorized`)
			expect(contour(peers.maya)).toEqual(before)
			room.allowContour()
			await peers.maya.batch.flush()
			expect(peers.maya.status().connection).toBe(`live`)

			act(() => clients.maya.socket.disconnect())
			await peers.maya.editor.moveNode({
				gesture: mayaClock.begin(),
				nodeId: before.nodes[0].id,
				point: { x: 77, y: 78 },
			})
			expect(peers.maya.status().connection).toBe(`offline`)
			act(() => clients.maya.socket.connect())
			await waitFor(() => {
				expect(peers.maya.status().connection).toBe(`live`)
			})
			await peers.theo.batch.flush()
			expect(contour(peers.maya)).toEqual(contour(peers.theo))
			expectContourIntegrity(contour(peers.theo))
		} finally {
			await room.teardown()
		}
	})

	test(`presence and drag previews stay ephemeral`, async () => {
		const room = await createScenario()
		try {
			const clients = initialize(room)
			const peers = await live(room)
			const clock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			await publishCollaboratorPresence(peers.maya, {
				color: MAYA.color,
				name: MAYA.name,
				pointer: { x: 12, y: 13 },
				selectedNodeId: `north-west`,
			})
			await room.room.waitForIdle()
			await peers.theo.presence.flush()
			expect(
				peers.theo.presence.state.presence.some(
					({ address, actor }) =>
						address.member === `collaborator` && actor === MAYA.id,
				),
			).toBe(true)

			const before = contour(peers.theo)
			const gesture = clock.begin()
			await peers.maya.editor.beginDrag({
				element: {} as Element,
				gesture,
				nodeId: `north-west`,
				point: { x: 32, y: 33 },
				pointerId: 1,
			})
			await room.room.waitForIdle()
			await peers.theo.presence.flush()
			expect(
				peers.theo.silo.getState(
					contourDragPresenceAtoms,
					svgContourPresenceKey({
						actor: gesture.actor,
						session: gesture.session,
					}),
				),
			).toMatchObject({ point: { x: 32, y: 33 } })
			act(() => clients.maya.socket.disconnect())
			await waitFor(() => {
				expect(
					peers.theo.silo.getState(
						contourDragPresenceAtoms,
						svgContourPresenceKey({
							actor: gesture.actor,
							session: gesture.session,
						}),
					),
				).toBeNull()
			})
			expect(peers.maya.silo.getState(contourActiveDragAtom)).toBeNull()
			expect(contour(peers.theo)).toEqual(before)
		} finally {
			await room.teardown()
		}
	})

	test(`a checkpoint restarts one complete contour`, async () => {
		const room = await createScenario()
		try {
			let clients = initialize(room)
			const peers = await live(room)
			const clock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			await peers.maya.editor.moveNode({
				gesture: clock.begin(),
				nodeId: `north-west`,
				point: { x: 101, y: 102 },
			})
			await room.room.waitForIdle()
			await peers.theo.batch.flush()
			const runtime = room.restart.getRuntime()
			expect(runtime.revision).toBe(1)
			const published = await runtime.checkpoints.checkpoint()
			const contourAddress = peers.maya.domain.address(`contour`)
			const checkpoint = await runtime.checkpoints.recover([contourAddress])
			expect(published.status).toBe(`checkpointed`)
			expect(checkpoint.rootKey).toBe(published.rootKey)
			expect(checkpoint.tail).toHaveLength(0)
			expect(
				readSvgContour(
					svgContourStateSchema.parse(checkpoint.members[0]?.value),
				),
			).toEqual(readSvgContour(peers.maya.silo.getState(contourAtom)))

			await Promise.all([clients.maya.dispose(), clients.theo.dispose()])
			await room.restart.restart({ durability: `preserve`, mode: `graceful` })
			clients = initialize(room)
			const restarted = await live(room)
			expect(contour(restarted.maya)).toEqual(contour(restarted.theo))
			expectContourIntegrity(contour(restarted.maya))
			expect(
				contour(restarted.maya).nodes.find(({ id }) => id === `north-west`),
			).toMatchObject({ x: 101, y: 102 })
		} finally {
			await room.teardown()
		}
	})
})
