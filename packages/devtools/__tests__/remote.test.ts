import { Silo } from "atom.io"
import { afterEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools } from "../src/index.ts"
import type {
	DevtoolsPanelMessage,
	DevtoolsStoreMessage,
	DevtoolsTransport,
} from "../src/remote.ts"
import { exposeDevtoolsStore } from "../src/remote.ts"

function endpoint<Incoming, Outgoing>(forward: (frame: Outgoing) => void) {
	let receive: ((frame: Incoming) => void) | undefined
	let disconnected: (() => void) | undefined
	const transport = {
		send: vi.fn((frame: Outgoing) => {
			const copy = structuredClone(frame)
			setTimeout(() => {
				forward(copy)
			}, 0)
		}),
		listen: vi.fn(
			(onMessage: (frame: Incoming) => void, onDisconnect: () => void) => {
				receive = onMessage
				disconnected = onDisconnect
			},
		),
		close: vi.fn(() => {
			receive = undefined
			disconnected = undefined
		}),
	} satisfies DevtoolsTransport<Incoming, Outgoing>
	return {
		transport,
		deliver: (frame: Incoming) => receive?.(frame),
		disconnect: () => disconnected?.(),
	}
}

function fixture(isProduction = false) {
	const silo = new Silo({
		name: `remote tests`,
		lifespan: `ephemeral`,
		isProduction,
	})
	const host = document.createElement(`main`)
	document.body.append(host)
	const panel = endpoint<DevtoolsStoreMessage, DevtoolsPanelMessage>((frame) =>
		store.deliver(frame),
	)
	const store = endpoint<DevtoolsPanelMessage, DevtoolsStoreMessage>((frame) =>
		panel.deliver(frame),
	)
	const mount = () =>
		mountAtomIODevtools(host, {
			stores: [
				{
					kind: `remote`,
					id: `remote`,
					label: `Remote`,
					connect: () => panel.transport,
				},
			],
		})
	return { silo, host, panel, store, mount }
}

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
	document.body.replaceChildren()
	localStorage.clear()
})

it(`reports a disabled exposure without reading or publishing the store`, async () => {
	const { silo, host, store, mount } = fixture()
	const read = vi.spyOn(silo, `getState`)
	const panel = mount()
	try {
		expect(host.querySelector(`[role="status"]`)?.textContent).toContain(
			`Waiting`,
		)
		exposeDevtoolsStore(store.transport, silo)()
		await vi.waitFor(() => {
			expect(host.querySelector(`[role="alert"]`)?.textContent).toBe(
				`Remote devtools disconnected`,
			)
		})
		expect(host.querySelector(`[role="status"]`)).toBeNull()
		expect(store.transport.close).toHaveBeenCalledOnce()
		expect(store.transport.listen).not.toHaveBeenCalled()
		expect(store.transport.send.mock.calls).toEqual([[{ type: `close` }]])
		expect(read).not.toHaveBeenCalled()
	} finally {
		panel.dispose()
	}
})

it(`requires a separate production opt-in for either enabled mode`, () => {
	const production = fixture(true)
	exposeDevtoolsStore(production.store.transport, production.silo, {
		access: `inspect`,
	})()
	const { silo, store } = fixture()
	vi.stubEnv(`NODE_ENV`, `production`)
	exposeDevtoolsStore(store.transport, silo, {
		access: `control`,
		productionAccess: `inspect`,
	})()
	for (const connection of [production.store, store]) {
		expect(connection.transport.close).toHaveBeenCalledOnce()
		expect(connection.transport.listen).not.toHaveBeenCalled()
		expect(connection.transport.send.mock.calls).toEqual([[{ type: `close` }]])
	}
})

it.each([false, true])(
	`disconnects after a missing incremental frame (allowlist=%s)`,
	async (allowlist) => {
		const { silo, host, panel, store, mount } = fixture()
		const countAtom = silo.atom<number>({ key: `count`, default: 1 })
		silo.getState(countAtom)
		const mounted = mount()
		const stop = exposeDevtoolsStore(store.transport, silo, {
			access: `control`,
			...(allowlist && { states: [{ token: countAtom }] }),
		})
		try {
			await vi.waitFor(() => {
				expect(
					host.querySelector<HTMLInputElement>(`[aria-label="count"]`)?.value,
				).toBe(`1`)
			})
			store.transport.send.mockImplementationOnce(() => {})
			silo.setState(countAtom, 2)
			await vi.waitFor(() => {
				expect(store.transport.send).toHaveBeenLastCalledWith(
					expect.objectContaining({ sequence: 1 }),
				)
			})
			silo.setState(countAtom, 3)
			await vi.waitFor(() => {
				expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
					`out of sync`,
				)
				expect(store.transport.close).toHaveBeenCalledOnce()
			})
			expect(store.transport.send).toHaveBeenLastCalledWith(
				expect.objectContaining({ sequence: 2 }),
			)
			expect(host.querySelector(`[aria-label="count"]`)).toBeNull()
			expect(panel.transport.send).toHaveBeenLastCalledWith({ type: `close` })
		} finally {
			mounted.dispose()
			stop()
		}
	},
)

it.each([false, true])(
	`rejects frames that cannot continue the initial snapshot (initialized=%s)`,
	async (initialized) => {
		const { host, panel, mount } = fixture()
		const mounted = mount()
		try {
			if (initialized) {
				const snapshot = {
					type: `snapshot`,
					version: 1,
					control: false,
					states: [],
				} as const
				panel.deliver({ ...snapshot, states: [] })
				panel.deliver({ ...snapshot, states: [] })
			} else {
				panel.deliver({ type: `snapshot-update`, sequence: 1, states: [] })
			}
			await vi.waitFor(() => {
				expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
					`out of sync`,
				)
			})
		} finally {
			mounted.dispose()
		}
	},
)

it(`rejects an incompatible initial protocol version before exposing any values`, async () => {
	const { host, panel, mount } = fixture()
	const mounted = mount()
	try {
		panel.deliver({
			type: `snapshot`,
			version: -1,
			control: true,
			states: [
				{ key: `foreign`, kind: `atom`, value: 3, revision: 1, editable: true },
			],
		})
		await vi.waitFor(() => {
			expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
				`Unsupported remote devtools protocol version`,
			)
		})
		expect(host.querySelector(`[aria-label="foreign"]`)).toBeNull()
		expect(panel.transport.send).toHaveBeenLastCalledWith({ type: `close` })
	} finally {
		mounted.dispose()
	}
})

it(`ships initial and incremental Ecology operations over the remote protocol`, async () => {
	const { silo, host, store, panel, mount } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const cartItemsAtom = silo.atom<string[]>({ key: `cartItems`, default: [] })
	silo.getState(countAtom)
	silo.getState(cartItemsAtom)
	const countTimeline = silo.timeline({ key: `count`, scope: [countAtom] })
	const saveTransaction = silo.transaction({
		key: `save`,
		do: ({ set }) => {
			set(countAtom, 1)
			set(cartItemsAtom, [`coffee-beans`])
		},
	})
	const mounted = mount()
	const stop = exposeDevtoolsStore(store.transport, silo, { access: `inspect` })
	const card = (id: string) =>
		host.querySelector(`ecology-node-card > button[data-graph-id='${id}']`)
	try {
		const [[initial]] = store.transport.send.mock.calls
		expect(initial).toMatchObject({
			type: `store`,
			version: 1,
			snapshot: {
				ecology: {
					operations: {
						records: [
							{ type: `transaction`, key: `save` },
							{
								type: `timeline`,
								key: countTimeline.key,
								at: 0,
								historyLength: 0,
								targets: [{ kind: `state`, key: countAtom.key }],
							},
						],
					},
				},
			},
		})
		await vi.waitFor(() => {
			host
				.querySelector<HTMLButtonElement>(`[data-testid="view-ecology"]`)!
				.click()
		})
		await vi.waitFor(() => {
			expect(card(`transaction:save`)?.textContent).toContain(`Transaction`)
			expect(card(`timeline:${countTimeline.key}`)?.textContent).toContain(
				`0/0 steps`,
			)
		})

		const draftTimelines = silo.timelineFamily<string>({
			key: `draft`,
			scope: [],
		})
		silo.transaction({ key: `publish`, do: () => {} })
		silo.runTransaction(saveTransaction)()
		await vi.waitFor(() => {
			expect(
				card(`timeline_family:${draftTimelines.key}`)?.textContent,
			).toContain(`0 members`)
			expect(card(`transaction:publish`)).not.toBeNull()
			expect(card(`timeline:${countTimeline.key}`)?.textContent).toContain(
				`1/1 steps`,
			)
		})
		for (const label of [`Expand transaction save`, `Expand timeline count`])
			host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click()
		await vi.waitFor(() => {
			expect(
				host.querySelector(
					`ecology-editor transaction-outcomes event-view strong`,
				)?.textContent,
			).toBe(`Outcome 1`)
			expect(
				host.querySelector(`ecology-editor timeline-history [data-cursor]`)
					?.textContent,
			).toBe(`you are here`)
			expect(
				host.querySelectorAll(`ecology-editor timeline-travel button:disabled`),
			).toHaveLength(2)
		})
		host
			.querySelector<HTMLButtonElement>(`[aria-label="Expand outcome 1"]`)!
			.click()
		await vi.waitFor(() => {
			expect(
				host.querySelector(
					`ecology-editor transaction-outcomes [data-compact-write]`,
				)?.textContent,
			).toBe(`count01`)
			expect(
				host.querySelector(
					`ecology-editor transaction-outcomes [data-entry-change] ins`,
				)?.textContent,
			).toBe(`"coffee-beans"`)
		})
		const member = silo.findTimeline(draftTimelines, `first`)
		await vi.waitFor(() => {
			expect(
				card(`timeline_family:${draftTimelines.key}`)?.textContent,
			).toContain(`1 members`)
		})
		host
			.querySelector<HTMLButtonElement>(
				`[aria-label="Expand ${draftTimelines.key}"]`,
			)!
			.click()
		await vi.waitFor(() => {
			expect(card(`timeline:${member.key}`)?.textContent).toContain(`0/0 steps`)
		})
		const memberRow = host.querySelector(
			`[data-row-id='timeline:${member.key}']`,
		)!
		memberRow
			.querySelector<HTMLButtonElement>(`button[aria-expanded="false"]`)!
			.click()
		await vi.waitFor(() => {
			expect(memberRow.querySelector(`timeline-history`)).not.toBeNull()
		})
		silo.disposeTimeline(member)
		await vi.waitFor(() => {
			expect(
				card(`timeline_family:${draftTimelines.key}`)?.textContent,
			).toContain(`0 members`)
			expect(card(`timeline:${member.key}`)).toBeNull()
			expect(memberRow.isConnected).toBe(false)
		})
		const updates = store.transport.send.mock.calls.flatMap(([message]) =>
			message.type === `store-update`
				? [message.update.ecology?.operations]
				: [],
		)
		expect(updates).toContainEqual(
			expect.objectContaining({
				upsert: expect.arrayContaining([
					{
						type: `transaction`,
						key: saveTransaction.key,
						targets: [
							{ kind: `state`, key: countAtom.key },
							{ kind: `state`, key: cartItemsAtom.key },
						],
					},
				]),
			}),
		)
		expect(updates).toContainEqual(
			expect.objectContaining({
				remove: [`timeline:${member.key}`],
				upsert: [
					expect.objectContaining({ type: `timeline_family`, memberCount: 0 }),
				],
			}),
		)
		expect(panel.transport.send).not.toHaveBeenCalled()
	} finally {
		mounted.dispose()
		stop()
	}
})

it(`mirrors a store over a custom transport and enforces inspection mode at the owner`, async () => {
	const { silo, host, panel, store, mount } = fixture(true)
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 5,
	})
	const item = silo.findState(itemsAtoms, `a`)
	const getDouble = vi.fn(() => 6)
	const doubledSelector = silo.selector<number>({
		key: `doubled`,
		get: getDouble,
	})
	silo.timeline({ key: `count`, scope: [countAtom] })
	silo.setState(countAtom, 3)
	silo.getState(item)
	const mounted = mount()
	const stop = exposeDevtoolsStore(store.transport, silo, {
		access: `inspect`,
		productionAccess: `inspect`,
	})
	try {
		const field = await vi.waitFor(() => {
			const input = host.querySelector<HTMLInputElement>(`[aria-label="count"]`)
			expect(input?.value).toBe(`3`)
			return input!
		})
		expect(field.readOnly).toBe(true)
		expect(host.querySelector(`[data-remote-access]`)?.textContent).toBe(
			`Inspection only`,
		)
		expect(panel.transport.send).not.toHaveBeenCalled()
		const tab = (view: string) => {
			host
				.querySelector<HTMLButtonElement>(`[data-testid="view-${view}"]`)!
				.click()
		}
		tab(`selectors`)
		await vi.waitFor(() => {
			expect(host.querySelector(`[data-state-key="doubled"]`)).not.toBeNull()
		})
		expect(host.querySelector(`[aria-label="Generate doubled"]`)).toBeNull()
		tab(`timelines`)
		await vi.waitFor(() => {
			const timeline = host.querySelector(`[data-testid="timeline-count"]`)
			expect(timeline?.querySelectorAll(`button:disabled`)).toHaveLength(2)
		})
		const first = store.transport.send.mock.calls[0][0]
		if (first.type !== `store`) throw new Error(`Missing initial snapshot`)
		const commands: DevtoolsPanelMessage[] = [
			{ type: `edit`, key: countAtom.key, revision: 0, value: 100 },
			{ type: `generate`, key: doubledSelector.key },
			{ type: `dispose`, key: item.key },
			{
				type: `timeline`,
				key: countAtom.key,
				action: `undo`,
				revision: first.snapshot.timelines[0].revision,
			},
		]
		for (const command of commands) panel.transport.send(command)
		await vi.waitFor(() => {
			expect(
				store.transport.send.mock.calls.filter(
					([frame]) => frame.type === `edit-error`,
				),
			).toHaveLength(commands.length)
		})
		expect(silo.getState(countAtom)).toBe(3)
		expect(silo.store.atoms.has(item.key)).toBe(true)
		expect(getDouble).not.toHaveBeenCalled()
		// A transport can lose its peer without delivering a protocol close frame.
		store.transport.send.mockImplementationOnce(() => {
			throw new Error(`Connection lost`)
		})
		store.disconnect()
		expect(store.transport.close).toHaveBeenCalledOnce()
		expect(silo.store.observation).toBeUndefined()
	} finally {
		mounted.dispose()
		stop()
	}
})

it(`controls a development store over a custom transport without Node globals`, async () => {
	const { silo, host, panel, store, mount } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 1 })
	silo.getState(countAtom)
	const mounted = mount()
	let stop: (() => void) | undefined
	try {
		vi.stubGlobal(`process`, undefined)
		try {
			stop = exposeDevtoolsStore(store.transport, silo, { access: `control` })
		} finally {
			vi.unstubAllGlobals()
		}
		const field = await vi.waitFor(() => {
			const input = host.querySelector<HTMLInputElement>(`[aria-label="count"]`)
			expect(input?.value).toBe(`1`)
			return input!
		})
		expect(field.readOnly).toBe(false)
		field.focus()
		field.value = `19`
		field.dispatchEvent(new Event(`input`, { bubbles: true }))
		field.blur()
		await vi.waitFor(() => {
			expect(silo.getState(countAtom)).toBe(19)
			expect(field.value).toBe(`19`)
		})
		const frame = store.transport.send.mock.calls.at(-1)?.[0]
		if (frame?.type !== `store-update`) throw new Error(`Missing update`)
		stop()
		store.transport.listen.mock.calls[0][0]({
			type: `edit`,
			key: countAtom.key,
			revision: frame.update.states[0].revision,
			value: 99,
		})
		expect(silo.getState(countAtom)).toBe(19)
		mounted.dispose()
		panel.transport.listen.mock.calls[0][0](frame)
		expect(host.children).toHaveLength(0)
	} finally {
		mounted.dispose()
		stop?.()
	}
})

it(`publishes only cached allowlisted values in inspection mode`, async () => {
	const { silo, panel, store } = fixture()
	const unrelatedAtom = silo.atom<number>({ key: `unrelated`, default: 3 })
	const unchangedAtom = silo.atom<number>({ key: `unchanged`, default: 9 })
	silo.getState(unchangedAtom)
	const read = vi.fn(() => 5)
	const targetSelector = silo.selector<number>({ key: `target`, get: read })
	const stop = exposeDevtoolsStore(store.transport, silo, {
		access: `inspect`,
		states: [{ token: targetSelector }, { token: unchangedAtom }],
	})
	try {
		expect(read).not.toHaveBeenCalled()
		expect(store.transport.send).toHaveBeenCalledWith(
			expect.objectContaining({
				type: `snapshot`,
				control: false,
				states: [
					expect.objectContaining({
						key: targetSelector.key,
						error: `Value is not cached`,
					}),
					expect.objectContaining({ key: unchangedAtom.key, value: 9 }),
				],
			}),
		)
		silo.setState(unrelatedAtom, 10)
		await Promise.resolve()
		await Promise.resolve()
		expect(store.transport.send).toHaveBeenCalledOnce()
		expect(silo.getState(targetSelector)).toBe(5)
		await vi.waitFor(() => {
			expect(store.transport.send).toHaveBeenLastCalledWith(
				expect.objectContaining({
					type: `snapshot-update`,
					states: [
						expect.objectContaining({
							key: targetSelector.key,
							value: 5,
							editable: false,
						}),
					],
				}),
			)
		})
		panel.transport.send({
			type: `edit`,
			key: targetSelector.key,
			revision: 0,
			value: 11,
		})
		await vi.waitFor(() => {
			expect(store.transport.send).toHaveBeenCalledWith({
				type: `edit-error`,
				message: `Remote devtools is inspection only`,
			})
		})
		store.transport.send.mockImplementationOnce(() => {
			throw new Error(`Connection lost`)
		})
		panel.transport.send({
			type: `edit`,
			key: targetSelector.key,
			revision: 0,
			value: 11,
		})
		await vi.waitFor(() => {
			expect(store.transport.close).toHaveBeenCalledOnce()
		})
		store.transport.send.mockClear()
		store.transport.listen.mock.calls[0][0]({
			type: `edit`,
			key: targetSelector.key,
			revision: 0,
			value: 11,
		})
		expect(store.transport.send).not.toHaveBeenCalled()
	} finally {
		stop()
	}
})

it(`releases observation if a custom transport cannot publish an update`, async () => {
	const { silo, store } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const stop = exposeDevtoolsStore(store.transport, silo, { access: `inspect` })
	try {
		store.transport.send.mockImplementationOnce(() => {
			throw new Error(`Could not send update`)
		})
		silo.setState(countAtom, 1)
		await vi.waitFor(() => {
			expect(store.transport.close).toHaveBeenCalledOnce()
		})
		expect(silo.store.observation).toBeUndefined()
	} finally {
		stop()
	}
})
