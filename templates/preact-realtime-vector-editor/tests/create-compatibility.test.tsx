import { waitFor } from "@testing-library/react"
import { Silo } from "atom.io"
import { RealtimeContext } from "atom.io/realtime-react"
import {
	createRestartableServerFixture,
	multiClient,
} from "atom.io/realtime-testing"
import { createElement, useContext, useEffect, useMemo } from "react"

import { createVectorCollaborationService } from "../node/service.ts"
import {
	createVectorCollaborationClient,
	publishCollaboratorPresence,
	type VectorCollaborationClient,
} from "../src/collaboration-client.ts"
import {
	CREATE_COMPATIBILITY_SURFACE,
	createCreateCompatibilityAdapter,
} from "../src/create-compatibility.ts"
import {
	createSvgGestureClock,
	readSvgRegister,
	type PointXY,
	type SvgDrawingFixture,
	type SvgEdge,
} from "../src/design-model.ts"
import type { Identity } from "../src/identities.ts"

const MAYA = { id: `maya`, name: `Maya`, color: `#8b7bff` } satisfies Identity
const THEO = { id: `theo`, name: `Theo`, color: `#ff6b9a` } satisfies Identity
const sessions = { maya: `compat:maya`, theo: `compat:theo` } as const

const CREATE_DRAWING: SvgDrawingFixture = {
	paths: [
		{
			id: `glyph-a`,
			subpaths: [
				{ edge: { kind: `move` }, id: `a-0`, node: { x: 0, y: 0 } },
				{
					edge: {
						c: { x: 20, y: 0 },
						kind: `cubic`,
						s: { x: 30, y: 10 },
					},
					id: `a-1`,
					node: { x: 40, y: 40 },
				},
			],
		},
		{
			id: `glyph-o`,
			subpaths: [
				{ edge: { kind: `move` }, id: `o-0`, node: { x: 80, y: 0 } },
				{
					edge: {
						c: { x: 100, y: 0 },
						kind: `cubic`,
						s: { x: 110, y: 10 },
					},
					id: `o-1`,
					node: { x: 120, y: 40 },
				},
			],
		},
	],
}

type RuntimeRegistry = Map<string, VectorCollaborationClient>

function compatibilityClient(
	identity: Identity,
	sessionId: string,
	runtimes: RuntimeRegistry,
) {
	return function CreateCompatibilityClient() {
		const { socket } = useContext(RealtimeContext)
		const silo = useMemo(
			() =>
				new Silo({
					isProduction: false,
					lifespan: `ephemeral`,
					name: `create-compatibility:${sessionId}`,
				}),
			[sessionId],
		)
		useEffect(() => {
			if (socket === null) return
			let active = true
			let created: VectorCollaborationClient | null = null
			void createVectorCollaborationClient({
				identity,
				sessionId,
				silo,
				socket,
			}).then((client) => {
				created = client
				if (active) runtimes.set(sessionId, client)
				else client[Symbol.dispose]()
			})
			return () => {
				active = false
				runtimes.delete(sessionId)
				created?.[Symbol.dispose]()
			}
		}, [silo, socket])
		return createElement(
			`output`,
			null,
			runtimes.get(sessionId)?.status().connection,
		)
	}
}

describe(`Create-* public compatibility`, () => {
	test(`one authorized multi-glyph gesture settles atomically while local and ephemeral state stay separate`, async () => {
		const runtimes: RuntimeRegistry = new Map()
		const restart = createRestartableServerFixture({
			name: `create-compatibility`,
			createDurableState: () => ({}),
			createEphemeralState: () => ({}),
			start: () =>
				createVectorCollaborationService({
					authorize: ({ actor }) => actor === MAYA.id,
				}),
			stop: (service) => service[Symbol.dispose](),
		})
		await restart.start()
		const room = multiClient({
			scenarioId: `create-compatibility`,
			server: (tools) => {
				const binding = tools.work.track(
					restart.getRuntime().bindSocket({
						actor: tools.userKey.replace(/^user::/, ``),
						session: tools.sessionId,
						socket: tools.socket,
					}),
					`bind Create-* compatibility socket`,
				)
				return () => void binding.then((cleanup) => cleanup())
			},
			clients: {
				maya: compatibilityClient(MAYA, sessions.maya, runtimes),
				theo: compatibilityClient(THEO, sessions.theo, runtimes),
			},
		})
		try {
			room.clients.maya.init({
				sessionId: sessions.maya,
				userKey: `user::maya`,
			})
			room.clients.theo.init({
				sessionId: sessions.theo,
				userKey: `user::theo`,
			})
			await waitFor(() => {
				expect(runtimes.get(sessions.maya)?.status().connection).toBe(`live`)
				expect(runtimes.get(sessions.theo)?.status().connection).toBe(`live`)
			})
			const maya = runtimes.get(sessions.maya)!
			const theo = runtimes.get(sessions.theo)!
			const mayaClock = createSvgGestureClock({
				actor: MAYA.id,
				session: sessions.maya,
			})
			const theoClock = createSvgGestureClock({
				actor: THEO.id,
				session: sessions.theo,
			})
			await maya.editor.replaceDrawing({
				drawing: CREATE_DRAWING,
				gesture: mayaClock.begin(),
			})
			await theo.batch.flush()

			maya.silo.setState(CREATE_COMPATIBILITY_SURFACE.local.workspace, {
				activePathId: `glyph-a`,
				selectedSubpathIds: [`a-1`, `o-1`],
			})
			theo.silo.setState(CREATE_COMPATIBILITY_SURFACE.local.workspace, {
				activePathId: `glyph-o`,
				selectedSubpathIds: [],
			})
			maya.silo.setState(CREATE_COMPATIBILITY_SURFACE.local.viewport, {
				pan: { x: 12, y: 18 },
				zoom: 2,
			})

			const mayaAdapter = createCreateCompatibilityAdapter({
				batch: maya.batch,
				domain: maya.domain,
				state: maya.silo,
			})
			const revision = restart.getRuntime().revision
			await mayaAdapter.translateGeometry({
				delta: { x: 5, y: -3 },
				gesture: mayaClock.begin(),
				targets: [
					{ glyphId: `glyph-a`, pointId: `a-1` },
					{ glyphId: `glyph-o`, pointId: `o-1` },
				],
			})
			await theo.batch.flush()
			expect(restart.getRuntime().revision).toBe(revision + 1)
			for (const client of [maya, theo]) {
				expect(
					readSvgRegister(
						client.silo.getState(
							CREATE_COMPATIBILITY_SURFACE.durable.nodes,
							`a-1`,
						),
					),
				).toEqual({ x: 45, y: 37 })
				expect(
					readSvgRegister(
						client.silo.getState(
							CREATE_COMPATIBILITY_SURFACE.durable.nodes,
							`o-1`,
						),
					),
				).toEqual({ x: 125, y: 37 })
				const edge = readSvgRegister<SvgEdge | null>(
					client.silo.getState(
						CREATE_COMPATIBILITY_SURFACE.durable.edges,
						`o-1`,
					),
				)
				expect(edge).toMatchObject({
					c: { x: 105, y: -3 },
					s: { x: 115, y: 7 },
				})
				expect(
					client.silo.getState(
						CREATE_COMPATIBILITY_SURFACE.projected.glyphOutline,
						`glyph-a`,
					),
				).toContain(`45 37`)
			}
			expect(
				theo.silo.getState(CREATE_COMPATIBILITY_SURFACE.local.workspace),
			).toEqual({ activePathId: `glyph-o`, selectedSubpathIds: [] })
			expect(
				theo.silo.getState(CREATE_COMPATIBILITY_SURFACE.local.viewport),
			).toEqual({ pan: { x: 0, y: 0 }, zoom: 1 })

			await publishCollaboratorPresence(maya, {
				activePathId: `glyph-a`,
				color: MAYA.color,
				name: MAYA.name,
				pointer: { x: 45, y: 37 },
				selectedSubpathId: `a-1`,
			})
			await room.waitForIdle()
			await theo.presence.flush()
			expect(
				theo.presence.state.presence.some(
					({ actor, value }) =>
						actor === MAYA.id &&
						(value as { pointer?: PointXY }).pointer?.x === 45,
				),
			).toBe(true)

			const viewerAdapter = createCreateCompatibilityAdapter({
				batch: theo.batch,
				domain: theo.domain,
				state: theo.silo,
			})
			await expect(
				viewerAdapter.translateGeometry({
					delta: { x: 100, y: 100 },
					gesture: theoClock.begin(),
					targets: [{ glyphId: `glyph-a`, pointId: `a-1` }],
				}),
			).rejects.toThrow(`not authorized`)
			expect(
				readSvgRegister(
					maya.silo.getState(CREATE_COMPATIBILITY_SURFACE.durable.nodes, `a-1`),
				),
			).toEqual({ x: 45, y: 37 })
		} finally {
			await room.teardown()
			if (restart.running) await restart.stop()
		}
	})
})
