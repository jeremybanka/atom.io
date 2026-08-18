import type { Silo } from "atom.io"
import type {
	MosaicAcceptedDomainBatchEnvelope,
	MosaicDomainBatchProposal,
} from "atom.io/realtime"
import {
	createMosaicDomainBatchClient,
	createMosaicDomainPresenceClient,
	createMosaicDomainPresenceSocketTransport,
	type MosaicDomainBatchClientTransport,
} from "atom.io/realtime-client"
import {
	bindMosaicDomainPresenceServerSocket,
	createMosaicDomainBatchServer,
	createMosaicDomainPresenceServer,
	type MosaicDomainBatchConnection,
} from "atom.io/realtime-server"
import {
	headless,
	type HeadlessRealtimeTestClient,
} from "atom.io/realtime-testing"
import { afterEach, describe, expect, test } from "vitest"

import { readSvgRegister } from "./svg-convergence.ts"
import {
	activateSvgDesignDomain,
	createSvgDomainEditor,
	type SvgDesignDomain,
} from "./svg-domain.ts"
import {
	createSvgGestureClock,
	dragPresenceAtoms,
	nodeAtoms,
	structureViolationsSelector,
	svgDragPresenceKey,
	type SvgDrawingFixture,
} from "./svg-editor-state.ts"

const ACCEPTED = `svg-domain:batch:accepted`
const PROPOSE = `svg-domain:batch:propose`
const RECOVER = `svg-domain:batch:recover`

const drawing: SvgDrawingFixture = {
	paths: [
		{
			id: `path-a`,
			subpaths: [
				{ edge: { kind: `move` }, id: `a0`, node: { x: 0, y: 0 } },
				{ edge: { kind: `line` }, id: `a1`, node: { x: 10, y: 10 } },
			],
		},
	],
}

const teardowns: Array<() => Promise<void>> = []

afterEach(async () => {
	for (const teardown of teardowns.splice(0).reverse()) await teardown()
})

function batchSocketTransport(
	harness: HeadlessRealtimeTestClient,
): MosaicDomainBatchClientTransport {
	return {
		propose(batch) {
			if (!harness.socket.connected) return Promise.reject(new Error(`offline`))
			return new Promise((resolve) => {
				harness.socket.emit(PROPOSE, batch, resolve)
			})
		},
		recover(afterRevision = 0) {
			if (!harness.socket.connected) return Promise.reject(new Error(`offline`))
			return new Promise((resolve) => {
				harness.socket.emit(RECOVER, afterRevision, resolve)
			})
		},
		subscribe(listener) {
			harness.socket.on(ACCEPTED, listener)
			return () => harness.socket.off(ACCEPTED, listener)
		},
	}
}

function realtimeFixture(
	options: { readonly duplicateDelivery?: boolean } = {},
) {
	let denyEdges = false
	let serverDomainPromise: Promise<SvgDesignDomain> | undefined
	let batchServerPromise:
		| Promise<ReturnType<typeof createMosaicDomainBatchServer>>
		| undefined
	let presenceServerPromise:
		| Promise<ReturnType<typeof createMosaicDomainPresenceServer>>
		| undefined
	let serverSilo: Silo | undefined
	const scenario = headless({
		scenarioId: `svg-domain-realtime`,
		server: (tools) => {
			serverSilo ??= tools.silo
			serverDomainPromise ??= activateSvgDesignDomain({
				instance: `drawing`,
				silo: tools.silo,
			})
			batchServerPromise ??= serverDomainPromise.then((domain) =>
				createMosaicDomainBatchServer({
					authorize: ({ batch }) =>
						!denyEdges ||
						batch.operations.every(({ address }) => address.member !== `edges`),
					domain,
				}),
			)
			presenceServerPromise ??= serverDomainPromise.then((domain) =>
				createMosaicDomainPresenceServer({ domain }),
			)
			const batchConnection = batchServerPromise.then((server) =>
				server.connect({ actor: tools.userKey, session: tools.sessionId }),
			)
			const presenceConnection = presenceServerPromise.then((server) =>
				server.connect({ actor: tools.userKey, session: tools.sessionId }),
			)
			let unsubscribeBatch: () => void = () => undefined
			let unbindPresence: () => Promise<void> = () => Promise.resolve()
			void tools.work.track(
				batchConnection.then((connection) => {
					unsubscribeBatch = connection.subscribe((accepted) => {
						tools.socket.emit(ACCEPTED, accepted)
						if (options.duplicateDelivery === true) {
							tools.socket.emit(ACCEPTED, accepted)
						}
					})
				}),
				`bind SVG batch broadcast`,
			)
			void tools.work.track(
				presenceConnection.then((connection) => {
					unbindPresence = bindMosaicDomainPresenceServerSocket(
						connection,
						tools.socket as never,
						tools.work,
					)
				}),
				`bind SVG presence`,
			)
			tools.socket.on(
				PROPOSE,
				(
					batch: MosaicDomainBatchProposal,
					respond: (
						result: Awaited<ReturnType<MosaicDomainBatchConnection[`propose`]>>,
					) => void,
				) => {
					void tools.work
						.track(
							batchConnection.then((connection) => connection.propose(batch)),
							`propose SVG batch`,
						)
						.then(respond)
				},
			)
			tools.socket.on(
				RECOVER,
				(
					afterRevision: number,
					respond: (recovery: {
						headRevision: number
						tail: readonly MosaicAcceptedDomainBatchEnvelope[]
					}) => void,
				) => {
					void tools.work
						.track(
							batchConnection.then((connection) =>
								connection.recover(afterRevision),
							),
							`recover SVG batches`,
						)
						.then(respond)
				},
			)
			return () => {
				unsubscribeBatch()
				void unbindPresence()
			}
		},
	})

	async function createPeer(name: string) {
		const harness = scenario.createClient({ name })
		await scenario.waitForIdle()
		const domain = await activateSvgDesignDomain({
			instance: `drawing`,
			silo: harness.silo,
		})
		const batch = createMosaicDomainBatchClient({
			actor: harness.userKey,
			domain,
			session: harness.sessionId,
			transport: batchSocketTransport(harness),
		})
		const presenceTransport = createMosaicDomainPresenceSocketTransport(
			harness.socket,
			{
				idSource: (() => {
					let sequence = 0
					return () => `${harness.sessionId}:presence:${sequence++}`
				})(),
			},
		)
		const presence = createMosaicDomainPresenceClient({
			domain,
			session: harness.sessionId,
			transport: presenceTransport,
		})
		await Promise.all([batch.start(), presence.start()])
		const editor = createSvgDomainEditor({
			batch,
			domain,
			presence,
			state: {
				getState: harness.silo.getState,
				setState: harness.silo.setState,
			},
		})
		return {
			batch,
			clock: createSvgGestureClock({
				actor: harness.userKey,
				session: harness.sessionId,
			}),
			domain,
			editor,
			harness,
			presence,
			presenceTransport,
		}
	}

	const teardown = async (): Promise<void> => {
		await scenario.teardown()
		;(await batchServerPromise)?.dispose()
		;(await presenceServerPromise)?.[Symbol.dispose]()
		;(await serverDomainPromise)?.[Symbol.dispose]()
	}
	teardowns.push(teardown)
	return {
		createPeer,
		denyEdges: () => {
			denyEdges = true
		},
		scenario,
		server: async () => ({
			batch: await batchServerPromise!,
			domain: await serverDomainPromise!,
			silo: serverSilo!,
		}),
	}
}

describe(`SVG Domain over realtime-testing`, () => {
	test(`real clients tolerate duplicate delivery and deterministically settle contention`, async () => {
		const room = realtimeFixture({ duplicateDelivery: true })
		const [alice, bob] = await Promise.all([
			room.createPeer(`alice`),
			room.createPeer(`bob`),
		])
		await alice.editor.replaceDrawing({ drawing, gesture: alice.clock.begin() })
		await bob.batch.flush()
		alice.clock.observe(10)
		bob.clock.observe(10)
		await Promise.all([
			alice.editor.commitGeometry({
				gesture: alice.clock.begin(),
				point: { x: 31, y: 32 },
				target: { kind: `node`, subpathId: `a0` },
			}),
			bob.editor.commitGeometry({
				gesture: bob.clock.begin(),
				point: { x: 41, y: 42 },
				target: { kind: `node`, subpathId: `a0` },
			}),
		])
		await Promise.all([alice.batch.flush(), bob.batch.flush()])
		const server = await room.server()
		const values = [server.silo, alice.harness.silo, bob.harness.silo].map(
			(silo) => readSvgRegister(silo.getState(nodeAtoms, `a0`)),
		)
		expect(values[0]).toEqual(values[1])
		expect(values[1]).toEqual(values[2])
		expect(server.batch.revision).toBe(3)
	})

	test(`a real final-member rejection exposes no partial structural state`, async () => {
		const room = realtimeFixture()
		const alice = await room.createPeer(`alice`)
		await alice.editor.replaceDrawing({ drawing, gesture: alice.clock.begin() })
		room.denyEdges()
		await expect(
			alice.editor.insertSubpath({
				edge: { kind: `line` },
				gesture: alice.clock.begin(),
				index: 2,
				node: { x: 20, y: 20 },
				pathId: `path-a`,
				subpathId: `denied`,
			}),
		).rejects.toThrow(`not authorized`)
		expect(alice.harness.silo.getState(structureViolationsSelector)).toEqual([])
		const server = await room.server()
		expect(server.silo.getState(structureViolationsSelector)).toEqual([])
		expect(server.batch.revision).toBe(1)
	})

	test(`a disconnected real client replays one coalesced geometry batch`, async () => {
		const room = realtimeFixture()
		const [alice, bob] = await Promise.all([
			room.createPeer(`alice`),
			room.createPeer(`bob`),
		])
		await alice.editor.replaceDrawing({ drawing, gesture: alice.clock.begin() })
		await bob.batch.flush()
		alice.harness.socket.disconnect()
		await alice.editor.commitGeometry({
			gesture: alice.clock.begin(),
			point: { x: 70, y: 80 },
			target: { kind: `node`, subpathId: `a0` },
		})
		expect(alice.batch.state.status).toBe(`offline`)
		alice.harness.socket.connect()
		await room.scenario.waitForIdle()
		await alice.batch.flush()
		await bob.batch.flush()
		expect(readSvgRegister(bob.harness.silo.getState(nodeAtoms, `a0`))).toEqual({
			x: 70,
			y: 80,
		})
	})

	test(`disconnect during drag expires only that actor-session preview`, async () => {
		const room = realtimeFixture()
		const [alice, bob] = await Promise.all([
			room.createPeer(`alice`),
			room.createPeer(`bob`),
		])
		await alice.editor.replaceDrawing({ drawing, gesture: alice.clock.begin() })
		await bob.batch.flush()
		const gesture = alice.clock.begin()
		await alice.editor.beginDrag({
			element: {} as Element,
			gesture,
			point: { x: 15, y: 16 },
			pointerId: 1,
			target: { kind: `node`, subpathId: `a0` },
		})
		await room.scenario.waitForIdle()
		await bob.presence.flush()
		const key = svgDragPresenceKey(gesture)
		expect(bob.harness.silo.getState(dragPresenceAtoms, key)).toMatchObject({
			point: { x: 15, y: 16 },
		})
		alice.harness.socket.disconnect()
		await bob.harness.waitForIdle()
		await bob.presence.flush()
		expect(bob.harness.silo.getState(dragPresenceAtoms, key)).toBeNull()
		const server = await room.server()
		expect(readSvgRegister(server.silo.getState(nodeAtoms, `a0`))).toEqual({
			x: 0,
			y: 0,
		})
	})
})
