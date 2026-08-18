import { act, render, waitFor as waitForReact } from "@testing-library/react"
import { Silo } from "atom.io"
import {
	createMosaicTextIndex,
	createMosaicTextIndexReader,
	maintainMosaicTextIndex,
	mosaicDomain,
	type MosaicDomainResidencyRequest,
	type MosaicDomainResidencyTransport,
	type MosaicDomainValueModel,
	type MosaicTextIndexBundle,
	type MosaicTextIndexFragment,
	type MosaicTextIndexMember,
	type MosaicTextIndexRoot,
	mosaicTextIndexSource,
} from "atom.io/realtime"
import {
	createMosaicDomainResidencyClient,
	createMosaicTextProjectionClient,
	type MosaicTextProjectionClient,
	type MosaicTextProjectionClientOptions,
} from "atom.io/realtime-client"
import { useMosaicTextRange } from "atom.io/realtime-react"
import {
	createMosaicDomainBatchServer,
	createMosaicDomainResidencyServer,
} from "atom.io/realtime-server"
import { headless } from "atom.io/realtime-testing/headless"
import { z } from "zod"

const compact = {
	maximumAliasGenerations: 3,
	maximumAliasTargets: 4,
	maximumChildrenPerNode: 4,
	maximumFragmentsPerLeaf: 6,
	maximumLeafGraphemes: 8,
	maximumLeafUtf16Units: 32,
	minimumChildrenPerNode: 2,
	minimumLeafGraphemes: 2,
	targetChildrenPerNode: 3,
	targetLeafGraphemes: 6,
} as const

type IndexValue = MosaicTextIndexMember | MosaicTextIndexRoot
type SetIndex<Value extends IndexValue = IndexValue> = {
	readonly type: `set`
	readonly value: Value
}
type History = Readonly<Record<string, string>>
type HistoryOperation =
	| { readonly type: `undo` }
	| { readonly type: `write`; readonly value: string }

const indexMemberModel = {
	identity: { key: `mosaic-text-index-member`, version: 1 },
	kind: `value`,
	operationSchema: z.object({
		type: z.literal(`set`),
		value: z.custom<MosaicTextIndexMember>(),
	}),
	reduce(_value, operation) {
		return operation.value
	},
} satisfies MosaicDomainValueModel<
	MosaicTextIndexMember,
	SetIndex<MosaicTextIndexMember>
>

const indexRootModel = {
	identity: { key: `mosaic-text-index-root`, version: 1 },
	kind: `value`,
	operationSchema: z.object({
		type: z.literal(`set`),
		value: z.custom<MosaicTextIndexRoot>(),
	}),
	reduce(_value, operation) {
		return operation.value
	},
} satisfies MosaicDomainValueModel<
	MosaicTextIndexRoot,
	SetIndex<MosaicTextIndexRoot>
>

const historyModel = {
	identity: { key: `mosaic-text-actor-history`, version: 1 },
	kind: `value`,
	operationSchema: z.discriminatedUnion(`type`, [
		z.object({ type: z.literal(`undo`) }),
		z.object({ type: z.literal(`write`), value: z.string() }),
	]),
	reduce(value, operation, context) {
		if (operation.type === `write`) {
			return { ...value, [context.actor]: operation.value }
		}
		return Object.fromEntries(
			Object.entries(value).filter(([actor]) => actor !== context.actor),
		)
	},
} satisfies MosaicDomainValueModel<History, HistoryOperation>

const emptySummary = {
	graphemes: 0,
	leafCount: 1,
	lineBreaks: 0,
	utf16Units: 0,
}

const emptyLeaf = (id: string): MosaicTextIndexMember => ({
	fragments: [],
	id,
	kind: `leaf`,
	summary: emptySummary,
	version: 1,
})

const emptyRoot: MosaicTextIndexRoot = {
	generation: 0,
	id: `root`,
	kind: `root`,
	reference: null,
	version: 1,
}

const fragment = (
	text: string,
	runId = `base`,
	start = 0,
): MosaicTextIndexFragment => ({ runId, start, text })

const members = (bundle: MosaicTextIndexBundle): MosaicTextIndexMember[] =>
	bundle.members.filter(
		(member): member is MosaicTextIndexMember => member.kind !== `alias`,
	)

const leaves = (bundle: MosaicTextIndexBundle) =>
	bundle.members.filter(
		(member): member is Extract<MosaicTextIndexMember, { kind: `leaf` }> =>
			member.kind === `leaf`,
	)

const materializeBundle = (bundle: MosaicTextIndexBundle): string =>
	leaves(bundle)
		.flatMap(({ fragments }) => fragments)
		.map(({ text }) => text)
		.join(``)

const resolvePosition = (
	bundle: MosaicTextIndexBundle,
	position: { readonly offset: number; readonly runId: string | null },
): number => {
	if (position.runId === null)
		return position.offset === 0 ? 0 : materializeBundle(bundle).length
	let global = 0
	for (const leaf of leaves(bundle)) {
		for (const item of leaf.fragments) {
			if (
				item.runId === position.runId &&
				position.offset >= item.start &&
				position.offset <= item.start + item.text.length
			) {
				return global + position.offset - item.start
			}
			global += item.text.length
		}
	}
	return 0
}

type Fixture = Awaited<ReturnType<typeof textFixture>>

async function textFixture(
	name: string,
	bundle: MosaicTextIndexBundle,
	silo = new Silo({ isProduction: false, lifespan: `ephemeral`, name }),
) {
	const byId = new Map(bundle.members.map((member) => [member.id, member]))
	const rootAtom = silo.atom<MosaicTextIndexRoot>({
		default: structuredClone(bundle.root),
		key: `root`,
	})
	const indexAtoms = silo.atomFamily<MosaicTextIndexMember, string>({
		default: (id) => structuredClone(byId.get(id) ?? emptyLeaf(id)),
		key: `index`,
	})
	const historyAtoms = silo.atomFamily<History, string>({
		default: {},
		key: `history`,
	})
	const definition = mosaicDomain({
		configSchema: z.object({}),
		key: `mos17-text-projection`,
		members: {
			history: {
				keySchema: z.string(),
				model: historyModel,
				role: `durable`,
				schema: z.record(z.string(), z.string()),
				token: historyAtoms,
			},
			index: {
				keySchema: z.string(),
				model: indexMemberModel,
				role: `durable`,
				schema: z.any(),
				token: indexAtoms,
			},
			root: {
				model: indexRootModel,
				role: `durable`,
				schema: z.custom<MosaicTextIndexRoot>(),
				token: rootAtom,
			},
		},
		version: 1,
	})
	const domain = await definition.activate({
		config: {},
		instance: `document`,
		store: silo.store,
	})
	return { domain, historyAtoms, indexAtoms, rootAtom, silo }
}

const eventually = async (
	condition: () => boolean | Promise<boolean>,
): Promise<void> => {
	for (let turn = 0; turn < 100; turn++) {
		if (await condition()) return
		await new Promise<void>((resolve) => setTimeout(resolve, 0))
	}
	throw new Error(`Mosaic text projection did not settle.`)
}

async function localSystem(text = `alpha\nbeta\ngamma\ndelta`) {
	const current = {
		bundle: createMosaicTextIndex([fragment(text)], compact),
		materializations: 0,
	}
	const serverState = await textFixture(`mos17-server`, current.bundle)
	const batches = createMosaicDomainBatchServer({ domain: serverState.domain })
	const server = createMosaicDomainResidencyServer({
		batches,
		domain: serverState.domain,
		range: {
			async resolve({ domain, limit, member, range }) {
				if (member === `history`) {
					return [domain.address(`history`, `document`)]
				}
				const resolution = await createMosaicTextIndexReader(
					mosaicTextIndexSource(current.bundle),
				).resolveRange(range, limit)
				if (resolution.status === `resnapshot`) {
					throw new Error(resolution.recovery.reason)
				}
				return resolution.leafIds.map((id) => domain.address(`index`, id))
			},
			schema: z.object({
				end: z.number().int().nonnegative(),
				kind: z.literal(`utf16-range`),
				start: z.number().int().nonnegative(),
			}),
		},
	})
	const makeClient = async (name: string, actor = name) => {
		const state = await textFixture(name, {
			members: [],
			root: emptyRoot,
		})
		const connected = server.connect({ actor, session: `session-${name}` })
		let activeTransports = 0
		let subscriptions = 0
		const transport: MosaicDomainResidencyTransport<
			typeof state.domain.identity,
			{ end: number; kind: `utf16-range`; start: number }
		> = {
			dispose: () => connected.dispose?.(),
			hydrate: (requests) => connected.hydrate(requests),
			propose: (proposal) => connected.propose(proposal),
			async subscribe(requests, listener) {
				subscriptions++
				activeTransports++
				const stop = await connected.subscribe(requests, listener)
				return () => {
					activeTransports--
					stop()
				}
			},
		}
		const residency = createMosaicDomainResidencyClient({
			actor,
			domain: state.domain,
			maxResidentMembers: 64,
			session: `session-${name}`,
			transport,
		})
		const projectionOptions = {
			actor,
			materialize: async () => {
				current.materializations++
				return materializeBundle(current.bundle)
			},
			planEdit(edit) {
				const address = state.domain.address(`history`, `document`)
				return {
					operations: {
						address,
						operation:
							edit.type === `replace`
								? { type: `write`, value: edit.text }
								: { type: `undo` },
					},
					selection: { addresses: [address], kind: `members` },
				}
			},
			positionAtOffset: (offset) =>
				createMosaicTextIndexReader(
					mosaicTextIndexSource(current.bundle),
				).positionAtOffset(offset),
			rangeMember: `index`,
			rangeMemberLimit: 16,
			residency,
			resolvePosition: async (position) =>
				resolvePosition(current.bundle, position),
			rootAddress: state.domain.address(`root`),
			session: `session-${name}`,
		} satisfies MosaicTextProjectionClientOptions<
			typeof state.domain.identity,
			{ end: number; kind: `utf16-range`; start: number }
		>
		const client = createMosaicTextProjectionClient(projectionOptions)
		return {
			client,
			get activeTransports() {
				return activeTransports
			},
			get subscriptions() {
				return subscriptions
			},
			residency,
			projectionOptions,
			state,
		}
	}
	const writer = await makeClient(`writer`, `writer`)
	const replaceIndex = async (bundle: MosaicTextIndexBundle): Promise<void> => {
		const before = current.bundle
		current.bundle = bundle
		const previous = new Map(
			before.members.map((member) => [member.id, JSON.stringify(member)]),
		)
		const changed = members(bundle).filter(
			(member) => previous.get(member.id) !== JSON.stringify(member),
		)
		const values: { address: any; operation: SetIndex }[] = [
			...(JSON.stringify(before.root) === JSON.stringify(bundle.root)
				? []
				: [
						{
							address: writer.state.domain.address(`root`),
							operation: { type: `set` as const, value: bundle.root },
						},
					]),
			...changed.map((member) => ({
				address: writer.state.domain.address(`index`, member.id),
				operation: { type: `set` as const, value: member },
			})),
		]
		const leases = await Promise.all(
			values.map(({ address }) => writer.residency.acquire(address)),
		)
		try {
			await writer.residency.submit(values, `index-maintenance`)
		} finally {
			for (const lease of leases) lease.release()
		}
	}
	return {
		batches,
		current,
		makeClient,
		replaceIndex,
		server,
		serverState,
		writer,
	}
}

describe(`Mosaic text range projections`, () => {
	test(`reads bounded selectors, shares Store ownership, and avoids implicit materialization`, async () => {
		const system = await localSystem(`alpha\nbeta\n${`x`.repeat(80)}`)
		const reader = await system.makeClient(`reader`)
		const updates: string[] = []
		const observed = await reader.client.observeRange(
			{ end: 10, kind: `utf16-range`, start: 2 },
			({ text }) => updates.push(text),
		)
		const first = await reader.client.acquireRange({
			end: 10,
			kind: `utf16-range`,
			start: 2,
		})
		const second = await reader.client.acquireRange({
			end: 10,
			kind: `utf16-range`,
			start: 2,
		})
		const overlap = await reader.client.acquireRange({
			end: 14,
			kind: `utf16-range`,
			start: 8,
		})

		expect(first.selector).toBe(second.selector)
		expect(overlap.selector).not.toBe(first.selector)
		expect(first.read()).toMatchObject({ text: `pha\nbeta` })
		expect(first.read().blocks.map(({ text }) => text)).toEqual([`pha`, `beta`])
		expect(reader.client.state).toEqual({
			activeRangeCount: 4,
			observerCount: 1,
			residentRangeCount: 2,
		})
		expect(reader.subscriptions).toBe(3)
		expect(reader.activeTransports).toBe(1)
		expect(reader.residency.state.residentMemberCount).toBeLessThan(
			leaves(system.current.bundle).length + 1,
		)
		expect(system.current.materializations).toBe(0)
		expect(await reader.client.readLength()).toBe(
			materializeBundle(system.current.bundle).length,
		)
		expect(await reader.client.materialize()).toBe(
			materializeBundle(system.current.bundle),
		)
		expect(system.current.materializations).toBe(1)

		const beforeUpdates = updates.length
		const before = system.current.bundle
		const next = maintainMosaicTextIndex(
			before,
			[fragment(`${materializeBundle(before)}!`)],
			compact,
		).index
		await system.replaceIndex(next)
		await eventually(
			async () =>
				(await reader.client.readLength()) === materializeBundle(next).length,
		)
		await eventually(() => reader.residency.state.connectivity === `live`)
		expect(await reader.client.readLength()).toBe(materializeBundle(next).length)
		expect(updates.slice(beforeUpdates)).toEqual([`pha\nbeta`])
		expect(reader.residency.state.residentMemberCount).toBeLessThan(
			leaves(next).length + 1,
		)
		expect(system.current.materializations).toBe(1)

		await Promise.all([
			first.release(),
			second.release(),
			overlap.release(),
			observed.release(),
		])
		await eventually(() => reader.client.state.residentRangeCount === 0)
		expect(reader.residency.state.requestedMemberCount).toBe(1)
		await reader.client.dispose()
		await reader.residency.dispose()
		await system.writer.client.dispose()
		await system.writer.residency.dispose()
	})

	test(`keeps logical block identity and focus across physical split and merge`, async () => {
		const system = await localSystem(`alpha\nbeta\ngamma`)
		const reader = await system.makeClient(`react-reader`)
		const Viewport = () => {
			const view = useMosaicTextRange(
				reader.client,
				{ end: 10, kind: `utf16-range`, start: 0 },
				{ overscan: 2 },
			)
			if (view.status !== `ready`) return <span>{view.status}</span>
			return (
				<input
					data-testid="block"
					key={view.projection.blocks[0].key}
					readOnly
					value={view.projection.blocks[0].text}
				/>
			)
		}
		const rendered = render(<Viewport />)
		const input = await rendered.findByDisplayValue(`alpha`)
		input.focus()
		const anchor = await reader.client.positionAtOffset(0)
		const tightened = maintainMosaicTextIndex(
			system.current.bundle,
			[fragment(materializeBundle(system.current.bundle))],
			{
				...compact,
				maximumLeafGraphemes: 3,
				targetLeafGraphemes: 3,
			},
		).index
		await act(async () => system.replaceIndex(tightened))
		await waitForReact(() => {
			expect(rendered.getByTestId(`block`)).toBe(input)
			expect(document.activeElement).toBe(input)
		})
		const expectedResidentCount = async (): Promise<number> => {
			const resolution = await createMosaicTextIndexReader(
				mosaicTextIndexSource(system.current.bundle),
			).resolveRange(
				{ end: 12, kind: `utf16-range`, start: 0 },
				reader.projectionOptions.rangeMemberLimit,
			)
			if (resolution.status === `resnapshot`) throw new Error(`unexpected cut`)
			return resolution.leafIds.length + 1
		}
		await eventually(
			async () =>
				reader.residency.state.residentMemberCount <=
				(await expectedResidentCount()),
		)
		const relaxed = createMosaicTextIndex(
			[fragment(materializeBundle(system.current.bundle))],
			compact,
		)
		await act(async () => system.replaceIndex(relaxed))
		await waitForReact(() => {
			expect(rendered.getByTestId(`block`)).toBe(input)
			expect(document.activeElement).toBe(input)
		})
		await eventually(
			async () =>
				reader.residency.state.residentMemberCount <=
				(await expectedResidentCount()),
		)
		expect(await reader.client.resolvePosition(anchor)).toBe(0)
		expect(reader.client.state.residentRangeCount).toBe(1)
		rendered.unmount()
		await eventually(() => reader.client.state.residentRangeCount === 0)
		const InvalidViewport = () => {
			const view = useMosaicTextRange(reader.client, {
				end: 99,
				kind: `utf16-range`,
				start: 98,
			})
			return <span>{view.status}</span>
		}
		const invalid = render(<InvalidViewport />)
		await invalid.findByText(`error`)
		invalid.unmount()
		const releaseFailureClient: typeof reader.client = {
			...reader.client,
			async observeRange(range, listener, acquisition) {
				const observer = await reader.client.observeRange(
					range,
					listener,
					acquisition,
				)
				return {
					...observer,
					async release() {
						await observer.release()
						throw new Error(`release observer failed`)
					},
				}
			},
		}
		const ReleaseFailureViewport = () => {
			const view = useMosaicTextRange(releaseFailureClient, {
				end: 1,
				kind: `utf16-range`,
				start: 0,
			})
			return <span>{view.status}</span>
		}
		const releaseFailure = render(<ReleaseFailureViewport />)
		await releaseFailure.findByText(`ready`)
		releaseFailure.unmount()
		await eventually(() => reader.client.state.residentRangeCount === 0)
		await Promise.resolve()
		await reader.client.dispose()
		await reader.residency.dispose()
		await system.writer.client.dispose()
		await system.writer.residency.dispose()
	})

	test(`fails bounded lifecycle misuse closed and disposes active Store resources`, async () => {
		const system = await localSystem(`abcdefghijklmnop`)
		const reader = await system.makeClient(`boundaries`)
		const duplicate = createMosaicTextProjectionClient(reader.projectionOptions)
		expect(duplicate).toBe(reader.client)
		for (const options of [
			{ maximumActiveRanges: 0 },
			{ maximumRangeUtf16Units: 0 },
			{ rangeMemberLimit: 0 },
		]) {
			expect(() =>
				createMosaicTextProjectionClient({
					...reader.projectionOptions,
					...options,
					domainKey: `invalid-${Object.keys(options)[0]}`,
				}),
			).toThrow(`positive bounded safe integer`)
		}
		expect(() =>
			createMosaicTextProjectionClient({
				...reader.projectionOptions,
				actor: ``,
				domainKey: `invalid-actor`,
			}),
		).toThrow(`actor`)

		const states: number[] = []
		const stopState = reader.client.subscribeState(({ activeRangeCount }) =>
			states.push(activeRangeCount),
		)
		const stopThrowing = reader.client.subscribeState(() => {
			throw new Error(`state observer failed`)
		})
		const length = await reader.client.lengthSelector()
		expect(await reader.client.lengthSelector()).toBe(length)
		expect(reader.state.silo.getState(length)).toBe(16)
		expect(
			await reader.client.readRange({
				end: 3,
				kind: `utf16-range`,
				start: 0,
			}),
		).toMatchObject({ text: `abc` })
		await expect(
			reader.client.acquireRange({
				end: 1,
				kind: `wrong` as never,
				start: 0,
			}),
		).rejects.toThrow(`Invalid`)
		await expect(
			reader.client.acquireRange(
				{ end: 1, kind: `utf16-range`, start: 0 },
				{ overscan: -1 },
			),
		).rejects.toThrow(`overscan`)
		await expect(
			reader.client.acquireRange({
				end: 17,
				kind: `utf16-range`,
				start: 16,
			}),
		).rejects.toThrow(`outside`)
		await expect(reader.client.positionAtOffset(-1)).rejects.toThrow(`outside`)

		const bounds = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `bounds`,
			maximumActiveRanges: 1,
			maximumRangeUtf16Units: 2,
		})
		await expect(
			bounds.acquireRange({ end: 3, kind: `utf16-range`, start: 0 }),
		).rejects.toThrow(`exceeds 2`)
		const active = await bounds.acquireRange({
			end: 1,
			kind: `utf16-range`,
			start: 0,
		})
		await expect(
			bounds.acquireRange({ end: 3, kind: `utf16-range`, start: 2 }),
		).rejects.toThrow(`active ranges exceed 1`)
		const throwingObserver = await bounds.observeRange(
			{ end: 1, kind: `utf16-range`, start: 0 },
			() => {
				throw new Error(`projection observer failed`)
			},
		)
		expect(throwingObserver.active).toBe(true)
		throwingObserver[Symbol.dispose]()
		await eventually(() => !throwingObserver.active)
		active[Symbol.dispose]()
		await eventually(() => !active.active)
		expect(() => active.read()).toThrow(`released`)

		const emptyPlan = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `empty-plan`,
			planEdit: () => ({ operations: [] }),
		})
		await expect(emptyPlan.edit({ type: `undo` })).rejects.toThrow(
			`requires an operation`,
		)
		emptyPlan[Symbol.dispose]()
		await eventually(() => emptyPlan.state.residentRangeCount === 0)

		const badMember = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `bad-member`,
			rangeMember: `missing`,
		})
		await expect(
			badMember.acquireRange({ end: 1, kind: `utf16-range`, start: 0 }),
		).rejects.toThrow(`durable family`)
		await badMember.dispose()

		const badRoot = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `bad-root`,
			rootAddress: {
				...reader.projectionOptions.rootAddress,
				member: `missing`,
			},
		})
		await expect(badRoot.readLength()).rejects.toThrow()
		await badRoot.dispose()
		const invalidRoot = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `invalid-root`,
			rootAddress: reader.state.domain.address(`history`, `document`),
		})
		await expect(invalidRoot.readLength()).rejects.toThrow(`root is invalid`)
		await invalidRoot.dispose()

		const invalidLeaf = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `invalid-leaf`,
			rangeMember: `history`,
		})
		await expect(
			invalidLeaf.acquireRange({ end: 1, kind: `utf16-range`, start: 0 }),
		).rejects.toThrow(`not a leaf`)
		await invalidLeaf.dispose()

		for (const [domainKey, runId] of [
			[`null-position`, null],
			[`missing-position`, `missing`],
		] as const) {
			const invalidPosition = createMosaicTextProjectionClient({
				...reader.projectionOptions,
				domainKey,
				positionAtOffset: async (offset) => ({
					...(await reader.projectionOptions.positionAtOffset(offset)),
					position: { affinity: `right`, offset: 0, runId },
				}),
			})
			await expect(
				invalidPosition.acquireRange({
					end: 1,
					kind: `utf16-range`,
					start: 0,
				}),
			).rejects.toThrow(`position is not resident`)
			await invalidPosition.dispose()
		}

		const missingResident = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `missing-resident`,
			residency: {
				...reader.residency,
				resident: async () => null,
			},
		})
		await expect(
			missingResident.acquireRange({
				end: 1,
				kind: `utf16-range`,
				start: 0,
			}),
		).rejects.toThrow(`not resident`)
		await missingResident.dispose()

		const throwingRelease = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `throwing-release`,
			residency: {
				...reader.residency,
				async acquire(address) {
					const lease = await reader.residency.acquire(address)
					return {
						...lease,
						release() {
							lease.release()
							throw new Error(`release failed`)
						},
					}
				},
			},
		})
		await throwingRelease.readLength()
		await expect(throwingRelease.dispose()).rejects.toThrow(
			`cleanup did not complete`,
		)

		const gate = () => {
			let open!: () => void
			const promise = new Promise<void>((resolve) => {
				open = resolve
			})
			return { open, promise }
		}
		const baselineRequests = reader.residency.state.requestedMemberCount
		const rootGate = gate()
		const rootStarted = gate()
		const slowRoot = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `slow-root`,
			residency: {
				...reader.residency,
				async acquire(address) {
					rootStarted.open()
					await rootGate.promise
					return reader.residency.acquire(address)
				},
			},
		})
		const pendingRoot = slowRoot.readLength()
		await rootStarted.promise
		await slowRoot.dispose()
		rootGate.open()
		await expect(pendingRoot).rejects.toThrow(`disposed`)
		await eventually(
			() => reader.residency.state.requestedMemberCount === baselineRequests,
		)

		const rangeGate = gate()
		const rangeStarted = gate()
		const slowRange = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `slow-range`,
			residency: {
				...reader.residency,
				async subscribe(selection, listener) {
					rangeStarted.open()
					await rangeGate.promise
					return reader.residency.subscribe(selection, listener)
				},
			},
		})
		const pendingRange = slowRange.acquireRange({
			end: 1,
			kind: `utf16-range`,
			start: 0,
		})
		await rangeStarted.promise
		await slowRange.dispose()
		rangeGate.open()
		await expect(pendingRange).rejects.toThrow(`disposed`)
		await eventually(
			() => reader.residency.state.requestedMemberCount === baselineRequests,
		)
		const residentGate = gate()
		const residentStarted = gate()
		const slowResident = createMosaicTextProjectionClient({
			...reader.projectionOptions,
			domainKey: `slow-resident`,
			residency: {
				...reader.residency,
				async resident(address) {
					residentStarted.open()
					await residentGate.promise
					return reader.residency.resident(address)
				},
			},
		})
		const pendingResident = slowResident.acquireRange({
			end: 1,
			kind: `utf16-range`,
			start: 0,
		})
		await residentStarted.promise
		await slowResident.dispose()
		residentGate.open()
		await expect(pendingResident).rejects.toThrow(`disposed`)
		await eventually(
			() => reader.residency.state.requestedMemberCount === baselineRequests,
		)

		const update = maintainMosaicTextIndex(
			system.current.bundle,
			[fragment(`Z${materializeBundle(system.current.bundle).slice(1)}`)],
			compact,
		).index
		const liveThrower = await reader.client.observeRange(
			{ end: 1, kind: `utf16-range`, start: 0 },
			() => {
				throw new Error(`live observer failed`)
			},
		)
		await system.replaceIndex(update)
		await eventually(() => reader.residency.state.headRevision > 0)
		await liveThrower.release()
		await liveThrower.release()

		const activeAtDispose = await bounds.acquireRange({
			end: 1,
			kind: `utf16-range`,
			start: 0,
		})
		await bounds.dispose()
		expect(activeAtDispose.active).toBe(false)
		await bounds.dispose()
		await bounds.dispose()
		stopThrowing()
		stopState()
		expect(states).toContain(1)
		await reader.client.dispose()
		await expect(reader.client.readLength()).rejects.toThrow(`disposed`)
		await expect(reader.client.materialize()).rejects.toThrow(`disposed`)
		await expect(
			reader.client.acquireRange({
				end: 1,
				kind: `utf16-range`,
				start: 0,
			}),
		).rejects.toThrow(`disposed`)
		await expect(reader.client.edit({ type: `undo` })).rejects.toThrow(
			`disposed`,
		)
		await reader.residency.dispose()
		await system.writer.client.dispose()
		await system.writer.residency.dispose()
	})

	test(`hydrates unloaded actor history for one compensating gesture and preserves foreign work`, async () => {
		const system = await localSystem()
		const alice = await system.makeClient(`alice`, `alice`)
		const bob = await system.makeClient(`bob`, `bob`)
		const history = bob.state.domain.address(`history`, `document`)
		const bobHistory = await bob.residency.acquire(history)
		await bob.residency.submit({
			address: history,
			operation: { type: `write`, value: `foreign` },
		})
		await alice.client.edit({
			anchor: { affinity: `right`, offset: 0, runId: `base` },
			gestureId: `alice-write`,
			head: { affinity: `right`, offset: 0, runId: `base` },
			text: `owned`,
			type: `replace`,
		})
		await alice.client.edit({ gestureId: `alice-undo`, type: `undo` })
		await eventually(() => system.batches.revision === 3)
		expect(system.current.materializations).toBe(0)
		const serverHistory = system.serverState.silo.getState(
			system.serverState.historyAtoms,
			`document`,
		)
		expect(serverHistory).toEqual({ bob: `foreign` })
		const recovered = await system.batches
			.connect({ actor: `inspection`, session: `inspection` })
			.recover()
		expect(recovered.tail.at(-1)?.batch).toMatchObject({
			actor: `alice`,
			group: `alice-undo`,
			operations: [{ operation: { type: `undo` } }],
		})
		expect(alice.residency.state.requestedMemberCount).toBe(0)
		bobHistory.release()
		await alice.client.dispose()
		await alice.residency.dispose()
		await bob.client.dispose()
		await bob.residency.dispose()
		await system.writer.client.dispose()
		await system.writer.residency.dispose()
	})
})

test(`realtime-testing carries disjoint multi-client range projections`, async () => {
	const hydrateEvent = `mos17:hydrate`
	const proposeEvent = `mos17:propose`
	const subscribeEvent = `mos17:subscribe`
	const acceptedEvent = `mos17:accepted`
	const unsubscribeEvent = `mos17:unsubscribe`
	const bundle = createMosaicTextIndex([fragment(`abcdefghijklmno`)], compact)
	let serverStatePromise: Promise<Fixture> | undefined
	let serverPromise:
		| Promise<ReturnType<typeof createMosaicDomainResidencyServer>>
		| undefined
	const scenario = headless({
		scenarioId: `mos17-ranges`,
		server(tools) {
			serverStatePromise ??= textFixture(
				`mos17-headless-server`,
				bundle,
				tools.silo,
			)
			serverPromise ??= serverStatePromise.then((state) => {
				const batches = createMosaicDomainBatchServer({ domain: state.domain })
				return createMosaicDomainResidencyServer({
					batches,
					domain: state.domain,
					range: {
						async resolve({ domain, limit, range }) {
							const result = await createMosaicTextIndexReader(
								mosaicTextIndexSource(bundle),
							).resolveRange(range, limit)
							if (result.status === `resnapshot`) return []
							return result.leafIds.map((id) => domain.address(`index`, id))
						},
						schema: z.object({
							end: z.number(),
							kind: z.literal(`utf16-range`),
							start: z.number(),
						}),
					},
				})
			})
			const connection = serverPromise.then((server) =>
				server.connect({ actor: tools.userKey, session: tools.sessionId }),
			)
			const stops = new Map<string, () => void>()
			tools.socket.on(hydrateEvent, (requests, respond) => {
				void tools.work
					.track(
						connection.then((item) => item.hydrate(requests)),
						`hydrate`,
					)
					.then(respond)
			})
			tools.socket.on(proposeEvent, (proposal, respond) => {
				void tools.work
					.track(
						connection.then((item) => item.propose(proposal)),
						`propose`,
					)
					.then(respond)
			})
			tools.socket.on(subscribeEvent, (id, requests, respond) => {
				void tools.work
					.track(
						connection.then(async (item) => {
							stops.set(
								id,
								await item.subscribe(requests, (accepted) =>
									tools.socket.emit(acceptedEvent, id, accepted),
								),
							)
						}),
						`subscribe`,
					)
					.then(respond)
			})
			tools.socket.on(unsubscribeEvent, (id) => {
				stops.get(id)?.()
				stops.delete(id)
			})
			return () => {
				for (const stop of stops.values()) stop()
			}
		},
	})
	const makeTransport = (
		harness: ReturnType<typeof scenario.createClient>,
	): MosaicDomainResidencyTransport => {
		let sequence = 0
		return {
			hydrate: (requests) =>
				new Promise((resolve) =>
					harness.socket.emit(hydrateEvent, requests, resolve),
				),
			propose: (proposal) =>
				new Promise((resolve) =>
					harness.socket.emit(proposeEvent, proposal, resolve),
				),
			subscribe(requests, listener) {
				const id = `${harness.sessionId}:${sequence++}`
				const receive = (incoming: string, accepted: unknown): void => {
					if (incoming === id) listener(accepted as never)
				}
				harness.socket.on(acceptedEvent, receive)
				return new Promise((resolve) =>
					harness.socket.emit(subscribeEvent, id, requests, () =>
						resolve(() => {
							harness.socket.off(acceptedEvent, receive)
							harness.socket.emit(unsubscribeEvent, id)
						}),
					),
				)
			},
		}
	}
	const harnesses = [
		scenario.createClient({ name: `alice` }),
		scenario.createClient({ name: `bob` }),
	]
	const projections: MosaicTextProjectionClient[] = []
	const residencies: ReturnType<typeof createMosaicDomainResidencyClient>[] = []
	try {
		await scenario.waitForIdle()
		for (const harness of harnesses) {
			const state = await textFixture(
				harness.name,
				{ members: [], root: emptyRoot },
				harness.silo,
			)
			const residency = createMosaicDomainResidencyClient({
				actor: harness.userKey,
				domain: state.domain,
				session: harness.sessionId,
				transport: makeTransport(harness),
			})
			residencies.push(residency)
			projections.push(
				createMosaicTextProjectionClient({
					actor: harness.userKey,
					materialize: async () => materializeBundle(bundle),
					planEdit: () => ({ operations: [] }),
					positionAtOffset: (offset) =>
						createMosaicTextIndexReader(
							mosaicTextIndexSource(bundle),
						).positionAtOffset(offset),
					rangeMember: `index`,
					residency,
					resolvePosition: async (position) => resolvePosition(bundle, position),
					rootAddress: state.domain.address(`root`),
					session: harness.sessionId,
				}),
			)
		}
		const [alice, bob] = await Promise.all([
			harnesses[0].work.track(
				projections[0].acquireRange({ end: 4, kind: `utf16-range`, start: 0 }),
				`Alice viewport`,
			),
			harnesses[1].work.track(
				projections[1].acquireRange({ end: 15, kind: `utf16-range`, start: 11 }),
				`Bob viewport`,
			),
		])
		await scenario.waitForIdle()
		expect(alice.read().text).toBe(`abcd`)
		expect(bob.read().text).toBe(`lmno`)
		expect(residencies[0].state.residentMemberCount).toBeLessThan(
			leaves(bundle).length + 1,
		)
		expect(residencies[1].state.residentMemberCount).toBeLessThan(
			leaves(bundle).length + 1,
		)
		await Promise.all([alice.release(), bob.release()])
	} finally {
		await Promise.all(projections.map((projection) => projection.dispose()))
		await Promise.all(residencies.map((residency) => residency.dispose()))
		await scenario.teardown()
	}
})
