import * as RTT from "atom.io/realtime-testing"

describe(`model-based realtime scenarios`, () => {
	test(`generation is bounded, seeded, and JSON replayable`, async () => {
		const options = {
			actions: 12,
			clientIds: [`alice`, `bob`, `carol`],
			faults: 3,
			generateAction: ({
				clientId,
				random,
			}: RTT.ModelScenarioGenerationContext) => ({
				amount: random.integer(5),
				clientId,
			}),
			generateFault: ({
				random,
			}: Omit<RTT.ModelScenarioGenerationContext, `clientId`>) => ({
				mode: random.pick([`duplicate`, `reorder`] as const),
			}),
			seed: 0x5eed,
		}
		const first = RTT.generateModelScenario(options)
		const second = RTT.generateModelScenario(options)
		expect(first).toEqual(second)
		expect(first.steps).toHaveLength(15)
		expect(JSON.parse(JSON.stringify(first))).toEqual(first)
		expect(() =>
			RTT.generateModelScenario({ ...options, maxSteps: 14 }),
		).toThrow(`exceeding maxSteps`)
		await expect(
			RTT.runSeededModelScenario({
				clientIds: [`alice`],
				createRuntime: () => ({
					applyAction: () => {},
					assertInvariants: () => {},
					quiesce: () => {},
				}),
				generateAction: () => `noop`,
				seed: 2,
			}),
		).resolves.toMatchObject({ seed: 2, version: 1 })
	})

	test(`rejects invalid generation and replay inputs`, async () => {
		const generate = (overrides: Record<string, unknown>) =>
			RTT.generateModelScenario({
				clientIds: [`alice`],
				generateAction: () => ({ value: 1 }),
				seed: 1,
				...overrides,
			})
		expect(() => generate({ clientIds: [] })).toThrow(`at least one client`)
		expect(() => generate({ clientIds: [`alice`, `alice`] })).toThrow(`unique`)
		expect(() => generate({ actions: -1 })).toThrow(`actions`)
		expect(() => generate({ clientIds: [`a`, `b`], maxClients: 1 })).toThrow(
			`exceeding maxClients`,
		)
		expect(() => generate({ faults: 1 })).toThrow(`generateFault`)
		expect(() => generate({ actions: 1, generateAction: () => NaN })).toThrow(
			`JSON-serializable`,
		)
		expect(() =>
			generate({ actions: 1, generateAction: () => () => {} }),
		).toThrow(`JSON-serializable`)
		expect(() =>
			generate({ actions: 1, generateAction: () => new Date() }),
		).toThrow(`JSON-serializable`)
		const circular: Record<string, unknown> = {}
		circular[`self`] = circular
		expect(() =>
			generate({ actions: 1, generateAction: () => circular }),
		).toThrow(`JSON-serializable`)
		const random = new RTT.SeededScenarioRandom(0)
		expect(() => random.integer(0)).toThrow(`positive integer`)
		expect(() => random.pick([])).toThrow(`empty array`)

		let disposed = false
		await expect(
			RTT.runModelScenario({
				createRuntime: () => ({
					applyAction: () => {},
					assertInvariants: () => {},
					dispose: () => {
						disposed = true
					},
					quiesce: () => {},
				}),
				schedule: {
					seed: 2,
					steps: [{ fault: `partition`, type: `fault` }],
					version: 1,
				},
			}),
		).rejects.toBeInstanceOf(RTT.ModelScenarioFailure)
		expect(disposed).toBe(true)
	})

	test(`asserts invariants at every quiescent point`, async () => {
		const checkpoints: number[] = []
		const schedule: RTT.ModelScenarioSchedule<number, never> = {
			seed: 1,
			steps: [
				{ action: 2, clientId: `alice`, type: `action` },
				{ action: 3, clientId: `bob`, type: `action` },
			],
			version: 1,
		}
		await RTT.runModelScenario({
			createRuntime: () => {
				let state = 0
				return {
					applyAction: (_clientId, action) => {
						state += action
					},
					assertInvariants: ({ stepIndex }) => {
						checkpoints.push(stepIndex)
						expect(state).toBeGreaterThanOrEqual(0)
					},
					quiesce: () => {},
				}
			},
			schedule,
		})
		expect(checkpoints).toEqual([-1, 0, 1])
	})

	test(`minimizes a failing replay schedule`, async () => {
		type Action = { fails: boolean; value: number }
		const schedule: RTT.ModelScenarioSchedule<Action, never> = {
			seed: 42,
			steps: [
				{ action: { fails: false, value: 1 }, clientId: `a`, type: `action` },
				{ action: { fails: true, value: 2 }, clientId: `b`, type: `action` },
				{ action: { fails: false, value: 3 }, clientId: `a`, type: `action` },
			],
			version: 1,
		}
		const minimized = await RTT.shrinkModelScenario(schedule, {
			fails: (candidate) =>
				Promise.resolve(
					candidate.steps.some(
						(step) => step.type === `action` && step.action.fails,
					),
				),
		})
		expect(minimized.steps).toEqual([schedule.steps[1]])
	})

	test(`applies domain-specific step shrinking`, async () => {
		const schedule: RTT.ModelScenarioSchedule<number, never> = {
			seed: 1,
			steps: [{ action: 10, clientId: `alice`, type: `action` }],
			version: 1,
		}
		const minimized = await RTT.shrinkModelScenario(schedule, {
			fails: (candidate) =>
				Promise.resolve(
					candidate.steps.some(
						(step) => step.type === `action` && step.action >= 5,
					),
				),
			shrinkStep: (step) =>
				step.type === `action` ? [{ ...step, action: 5 }] : [],
		})
		expect(minimized.steps).toEqual([
			{ action: 5, clientId: `alice`, type: `action` },
		])
		const unchanged = await RTT.shrinkModelScenario(schedule, {
			fails: () => Promise.resolve(false),
		})
		expect(unchanged).toEqual(schedule)
	})

	test(`reports an automatically minimized seeded failure`, async () => {
		let failure: unknown
		try {
			await RTT.runSeededModelScenario({
				actions: 5,
				clientIds: [`alice`, `bob`],
				createRuntime: () => {
					let failed = false
					return {
						applyAction: (_clientId, action: { fails: boolean }) => {
							failed ||= action.fails
						},
						assertInvariants: () => {
							if (failed) throw new Error(`generated failure`)
						},
						quiesce: () => {},
					}
				},
				generateAction: ({ index }) => ({ fails: index === 2 }),
				seed: 77,
			})
		} catch (error) {
			failure = error
		}
		expect(failure).toBeInstanceOf(RTT.ModelScenarioFailure)
		const modelFailure = failure as RTT.ModelScenarioFailure<
			{ fails: boolean },
			never
		>
		expect(modelFailure.schedule.steps).toHaveLength(1)
		expect(JSON.parse(modelFailure.replay())).toEqual(modelFailure.schedule)
		expect(modelFailure.message).toContain(`minimized 5 steps to 1`)
	})

	test(`reference model converges under duplicates with isolated history`, async () => {
		type Fault = { type: `duplicate` }
		const alice = { actor: `alice`, id: `typing-1` }
		const bob = { actor: `bob`, id: `typing-1` }
		const schedule: RTT.ModelScenarioSchedule<
			RTT.ReferenceSequenceOperation,
			Fault
		> = {
			seed: 9001,
			steps: [
				{
					action: {
						after: null,
						group: alice,
						id: `01`,
						nodeId: `alice:a`,
						type: `insert`,
						value: `A`,
					},
					clientId: `alice`,
					type: `action`,
				},
				{
					action: {
						after: `alice:a`,
						group: bob,
						id: `02`,
						nodeId: `bob:b`,
						type: `insert`,
						value: `B`,
					},
					clientId: `bob`,
					type: `action`,
				},
				{ fault: { type: `duplicate` }, type: `fault` },
				{
					action: {
						active: false,
						group: alice,
						id: `03`,
						type: `toggle-group`,
					},
					clientId: `alice`,
					type: `action`,
				},
				{
					action: {
						active: true,
						group: alice,
						id: `04`,
						type: `toggle-group`,
					},
					clientId: `alice`,
					type: `action`,
				},
			],
			version: 1,
		}
		let finalStates: readonly RTT.ReferenceSequenceState[] = []
		await RTT.runModelScenario({
			createRuntime: () => {
				const transport = new RTT.DeterministicTransport({ mode: `manual` })
				const server = new RTT.ReferenceSequenceReplica()
				const clients = new Map(
					[`alice`, `bob`].map((clientId) => [
						clientId,
						{
							replica: new RTT.ReferenceSequenceReplica(),
							socket: transport.createDuplex(
								{ id: clientId, role: `client` },
								{ id: `server:${clientId}`, role: `server` },
							),
						},
					]),
				)
				for (const { replica, socket } of clients.values()) {
					socket.left.on(`operation`, (operation) => {
						replica.apply(operation as RTT.ReferenceSequenceOperation)
					})
					socket.right.on(`operation`, (operation) => {
						server.apply(operation as RTT.ReferenceSequenceOperation)
						for (const peer of clients.values()) {
							peer.socket.right.emit(`operation`, operation)
						}
					})
				}
				return {
					applyAction: (clientId, operation) => {
						const client = clients.get(clientId)!
						client.replica.apply(operation)
						client.socket.left.emit(`operation`, operation)
					},
					applyFault: () => {
						transport.use({
							effect: { copies: 2, type: `duplicate` },
							filter: { event: `operation` },
						})
					},
					assertInvariants: ({ stepIndex }) => {
						const replicas = [
							server,
							...[...clients.values()].map(({ replica }) => replica),
						]
						finalStates = replicas.map((replica) => replica.state())
						expect(
							finalStates.every((state) => state.text === finalStates[0].text),
						).toBe(true)
						expect(
							replicas.flatMap((replica) => replica.invalidAnchors()),
						).toEqual([])
						if (stepIndex === 3) expect(finalStates[0].text).toBe(`B`)
					},
					quiesce: () => {
						transport.runUntilIdle()
					},
				}
			},
			schedule,
		})
		expect(finalStates.map(({ text }) => text)).toEqual([`AB`, `AB`, `AB`])
	})

	test(`reference model validates operation ownership and anchor structure`, () => {
		const group = { actor: `alice`, id: `g1` }
		const insert = {
			after: null,
			group,
			id: `01`,
			nodeId: `a`,
			type: `insert` as const,
			value: `A`,
		}
		const replica = new RTT.ReferenceSequenceReplica()
		expect(replica.apply(insert)).toBe(true)
		expect(replica.apply(insert)).toBe(false)
		expect(
			replica.apply({
				value: `A`,
				type: `insert`,
				nodeId: `a`,
				id: `01`,
				group: { id: `g1`, actor: `alice` },
				after: null,
			}),
		).toBe(false)
		expect(() => replica.apply({ ...insert, value: `B` })).toThrow(`reused`)
		expect(() =>
			new RTT.ReferenceSequenceReplica().apply({ ...insert, value: `` }),
		).toThrow(`cannot be empty`)

		const missing = new RTT.ReferenceSequenceReplica()
		missing.applyAll([
			{ ...insert, after: `missing` },
			{ group, id: `02`, nodeId: `also-missing`, type: `delete` },
		])
		expect(missing.invalidAnchors()).toEqual([`also-missing`, `missing`])
		expect(() => missing.state()).toThrow(`unreachable anchors`)

		const duplicateNode = new RTT.ReferenceSequenceReplica()
		duplicateNode.applyAll([insert, { ...insert, id: `02` }])
		expect(() => duplicateNode.state()).toThrow(`inserted more than once`)

		const siblings = new RTT.ReferenceSequenceReplica()
		siblings.applyAll([
			{ ...insert, id: `02`, nodeId: `z`, value: `Z` },
			{ ...insert, id: `01`, nodeId: `a`, value: `A` },
		])
		expect(siblings.state().text).toBe(`AZ`)

		const cycle = new RTT.ReferenceSequenceReplica()
		cycle.applyAll([
			{ ...insert, after: `b`, nodeId: `a` },
			{ ...insert, after: `a`, id: `02`, nodeId: `b` },
		])
		expect(cycle.invalidAnchors()).toEqual([])
		expect(() => cycle.state()).toThrow(`cyclic or unreachable`)
	})

	test(`reference ordering is locale-independent for non-ASCII IDs`, () => {
		const group = { actor: `alice`, id: `group` }
		const replica = new RTT.ReferenceSequenceReplica()
		replica.applyAll([
			{
				after: null,
				group,
				id: `0`,
				nodeId: `ä`,
				type: `insert`,
				value: `Ä`,
			},
			{
				after: null,
				group,
				id: `1`,
				nodeId: `z`,
				type: `insert`,
				value: `Z`,
			},
			{ active: false, group, id: `z`, type: `toggle-group` },
			{ active: true, group, id: `ä`, type: `toggle-group` },
		])
		expect(replica.operations().map(({ id }) => id)).toEqual([
			`0`,
			`1`,
			`z`,
			`ä`,
		])
		expect(replica.state().text).toBe(`ZÄ`)

		const invalid = new RTT.ReferenceSequenceReplica()
		invalid.applyAll([
			{
				after: `ä`,
				group,
				id: `0`,
				nodeId: `a`,
				type: `insert`,
				value: `A`,
			},
			{ group, id: `1`, nodeId: `z`, type: `delete` },
		])
		expect(invalid.invalidAnchors()).toEqual([`z`, `ä`])
	})
})
