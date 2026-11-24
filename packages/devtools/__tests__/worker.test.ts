import type { RegularAtomToken } from "atom.io"
import { Silo } from "atom.io"
import { deleteCachedValue, seekInStore } from "atom.io/internal"
import { observeStore } from "atom.io/introspection"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import {
	captureEcologySnapshot,
	mountAtomIODevtools,
	mountWorkerAtomIODevtools,
	traceEcologyRoots,
} from "../src/index.ts"
import { messagePortTransport } from "../src/message-port.ts"
import { connectRemoteStore } from "../src/remote-connection.ts"
import {
	exposeDevtoolsStore as exposeWorkerStore,
	type WorkerDevtoolsState,
	type WorkerDevtoolsValue,
} from "../src/worker.ts"
import {
	projectRemoteEcology,
	trackRemoteEcology,
} from "../src/remote-ecology.ts"

function exposeDevtoolsStore(
	port: MessagePort,
	silo: Silo,
	states?: readonly WorkerDevtoolsState[],
): () => void {
	return exposeWorkerStore(port, silo, {
		access: `control`,
		productionAccess: `control`,
		...(states && { states }),
	})
}
import { createRemoteProjection } from "../src/remote-projection.ts"
import type { RemoteMessage } from "../src/remote-protocol.ts"

class TestPort extends EventTarget {
	public peer?: TestPort
	public start = vi.fn()
	public close = vi.fn()
	public postMessage = vi.fn((data: unknown) => {
		queueMicrotask(() => {
			this.peer?.receive(data)
		})
	})
	public get port(): MessagePort {
		return this as unknown as MessagePort
	}
	public receive(data: unknown): void {
		this.dispatchEvent(new MessageEvent(`message`, { data }))
	}
}

function channel() {
	const page = new TestPort()
	const worker = new TestPort()
	page.peer = worker
	worker.peer = page
	return { page, worker }
}

function fixture() {
	const silo = new Silo({
		name: `worker test`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const host = document.createElement(`div`)
	document.body.append(host)
	return { silo, host, ...channel() }
}

it(`keeps each target mounted and isolates panel commands and keyboard shortcuts`, async () => {
	const { host, silo, page, worker } = fixture()
	const remote = channel()
	const localAtom = silo.atom<string>({ key: `local`, default: `page` })
	const firstStore = new Silo({
		name: `first`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const secondStore = new Silo({
		name: `second`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	const firstAtom = firstStore.atom<number>({ key: `first`, default: 1 })
	const secondAtom = secondStore.atom<number>({ key: `second`, default: 2 })
	const stopFirst = exposeDevtoolsStore(worker.port, firstStore)
	const stopSecond = exposeDevtoolsStore(remote.worker.port, secondStore)
	const connectFirst = vi.fn(() => page.port)
	const connectSecond = vi.fn(() => remote.page.port)
	const local = {
		id: `page`,
		label: `Page`,
		kind: `local`,
		store: silo.store,
	} as const
	expect(() => mountAtomIODevtools(host, { stores: [local, local] })).toThrow(
		/unique/,
	)
	const panel = mountAtomIODevtools(host, {
		stores: [
			local,
			{
				id: `first`,
				label: `First worker`,
				kind: `remote`,
				connect: connectFirst,
			},
			{
				id: `second`,
				label: `Second worker`,
				kind: `remote`,
				connect: connectSecond,
			},
		],
	})
	const active = () =>
		host.querySelector<HTMLElement>(`debugger-panel:not([hidden])`)
	const trigger = () =>
		active()!.querySelector<HTMLButtonElement>(`[data-store-trigger]`)!
	const switchTo = async (id: string) => {
		trigger().click()
		await flush()
		active()!
			.querySelector<HTMLButtonElement>(`[data-store-option="` + id + `"]`)!
			.click()
		await flush()
	}
	try {
		await flush()
		expect(host.querySelectorAll(`debugger-panel`)).toHaveLength(3)
		expect(active()?.querySelector(`h1`)?.textContent).toBe(`atom.io`)
		trigger().click()
		await flush()
		const current = active()?.querySelector(
			`[data-store-option][aria-current="true"]`,
		)
		expect(document.activeElement).toBe(current)
		current!.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `ArrowDown`, bubbles: true }),
		)
		expect(trigger().getAttribute(`aria-expanded`)).toBe(`true`)
		current!.dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
		)
		await flush()
		expect(trigger().getAttribute(`aria-expanded`)).toBe(`false`)
		expect(document.activeElement).toBe(trigger())
		trigger().dispatchEvent(
			new KeyboardEvent(`keydown`, { key: `Escape`, bubbles: true }),
		)
		trigger().click()
		await flush()
		document.body.dispatchEvent(new Event(`pointerdown`, { bubbles: true }))
		await flush()
		expect(trigger().getAttribute(`aria-expanded`)).toBe(`false`)
		active()!
			.querySelector<HTMLButtonElement>(`[data-testid="view-atoms"]`)!
			.click()
		await flush()
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="local"]`)?.value,
		).toBe(`page`)
		const moveLeft = async () => {
			const element = active()!
			const left = element.style.left
			element
				.querySelector(`[aria-label="Move debugger"]`)!
				.dispatchEvent(
					new KeyboardEvent(`keydown`, { key: `ArrowLeft`, bubbles: true }),
				)
			await flush()
			expect(element.style.left).not.toBe(left)
			return element.style.left
		}
		const localLeft = await moveLeft()
		firstStore.setState(firstAtom, 10)
		secondStore.setState(secondAtom, 20)
		await switchTo(`second`)
		expect(active()?.style.left).toBe(localLeft)
		expect(document.activeElement).toBe(trigger())
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="second"]`)?.value,
		).toBe(`20`)
		const remoteLeft = await moveLeft()
		await switchTo(`first`)
		expect(active()?.style.left).toBe(remoteLeft)
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="first"]`)?.value,
		).toBe(`10`)
		await switchTo(`first`)
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await flush()
		expect(active()).toBeNull()
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await flush()
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="first"]`)?.value,
		).toBe(`10`)
		await switchTo(`page`)
		expect(active()?.style.left).toBe(remoteLeft)
		expect(connectFirst).toHaveBeenCalledOnce()
		expect(connectSecond).toHaveBeenCalledOnce()
		expect(silo.getState(localAtom)).toBe(`page`)
	} finally {
		panel.dispose()
		panel.dispose()
		stopFirst()
		stopSecond()
	}
	expect(host.children).toHaveLength(0)
	expect(() =>
		mountAtomIODevtools(host, {
			stores: [
				local,
				{
					id: `failure`,
					label: `Failure`,
					kind: `remote`,
					connect() {
						throw new Error(`no port`)
					},
				},
			],
		}),
	).toThrow(`no port`)
	expect(host.children).toHaveLength(0)
})

it(`projects family values and sends nested JSON edits and disposal to the worker`, async () => {
	const { silo, host, page, worker } = fixture()
	const cartAtoms = silo.atomFamily<{ quantity: number }, string>({
		key: `cart`,
		default: { quantity: 2 },
	})
	const item = silo.findState(cartAtoms, `sku`)
	silo.getState(item)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const panel = mountWorkerAtomIODevtools(host, page.port)
	try {
		await flush()
		host
			.querySelector<HTMLElement>(
				`[data-testid="open-close-state-family-cart"]`,
			)!
			.click()
		await flush()
		const row = host.querySelector<HTMLElement>(`state-leaf[data-state-key]`)!
		row.querySelector<HTMLElement>(`button[aria-expanded]`)!.click()
		await flush()
		const field = row.querySelector<HTMLInputElement>(
			`input[aria-label="quantity"]`,
		)!
		field.focus()
		field.value = `8`
		field.dispatchEvent(new Event(`input`, { bubbles: true }))
		field.blur()
		await flush()
		expect(silo.getState(item)).toEqual({ quantity: 8 })
		const rename = (name: string) => {
			const input = row.querySelector<HTMLInputElement>(
				`input[aria-label="Rename quantity"]`,
			)!
			input.focus()
			input.value = name
			input.dispatchEvent(new Event(`input`, { bubbles: true }))
			return input
		}
		const stale = rename(`stale`)
		silo.setState(item, { quantity: 9 })
		await flush()
		expect(stale.value).toBe(`stale`)
		stale.blur()
		await flush()
		expect(silo.getState(item)).toEqual({ quantity: 9 })
		expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
			`state changed`,
		)
		rename(`amount`).blur()
		await flush()
		expect(silo.getState(item)).toEqual({ amount: 9 })
		row
			.querySelector<HTMLButtonElement>(`button[aria-label^="Dispose"]`)!
			.click()
		await flush()
		expect(silo.store.atoms.get(item.key)).toBeUndefined()
		expect(host.contains(row)).toBe(false)
	} finally {
		panel.dispose()
		stop()
	}
})

it(`rejects a remote array reorder when the owner changes the array during a drag`, async () => {
	const { silo, host, page, worker } = fixture()
	const listAtom = silo.atom<string[]>({ key: `list`, default: [`a`, `b`] })
	silo.getState(listAtom)
	const panel = mountWorkerAtomIODevtools(host, page.port)
	const stop = exposeDevtoolsStore(worker.port, silo)
	try {
		await flush()
		host.querySelector<HTMLButtonElement>(`[aria-label="Expand list"]`)!.click()
		await flush()
		const transfer = new DataTransfer()
		vi.spyOn(transfer, `setDragImage`).mockReturnValue(undefined)
		const drag = (selector: string, type: string) => {
			const event = new DragEvent(type, { bubbles: true, cancelable: true })
			Object.defineProperty(event, `dataTransfer`, { value: transfer })
			host.querySelector(selector)!.dispatchEvent(event)
		}
		const handle = `[data-array-index="0"] [data-array-handle]`
		const target = `[data-array-index="1"]`
		drag(handle, `dragstart`)
		silo.setState(listAtom, [`c`, `d`])
		await flush()
		drag(target, `drop`)
		await flush()
		expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
			`state changed`,
		)
		expect(silo.getState(listAtom)).toEqual([`c`, `d`])
		drag(handle, `dragstart`)
		drag(target, `drop`)
		await flush()
		expect(silo.getState(listAtom)).toEqual([`d`, `c`])
	} finally {
		panel.dispose()
		stop()
	}
})

it(`projects retained history and the observed graph and time travels in the worker`, async () => {
	const { silo, host, page, worker } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 0 })
	const doubleSelector = silo.selector<number>({
		key: `double`,
		get: ({ get }) => 2 * get(countAtom),
	})
	const finishTransaction = silo.transaction<(input: number) => number>({
		key: `finish`,
		do: ({ set }, input) => {
			set(countAtom, input)
			return input + 1
		},
	})
	const panel = mountWorkerAtomIODevtools(host, page.port)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const tab = async (view: string) => {
		host
			.querySelector<HTMLButtonElement>(`[data-testid="view-` + view + `"]`)!
			.click()
		await flush()
	}
	try {
		await flush()
		const countTimeline = silo.timeline({ key: `count`, scope: [countAtom] })
		silo.runTransaction(finishTransaction)(4)
		await flush()
		await tab(`transactions`)
		host
			.querySelector<HTMLButtonElement>(
				`[data-testid="open-close-transaction-finish"]`,
			)!
			.click()
		await flush()
		expect(
			host.querySelector(`[data-testid="transaction-finish"]`)?.textContent,
		).toContain(`output: 5`)
		const replacementTransaction = silo.transaction<() => string>({
			// eslint-disable-next-line atom.io/naming-convention -- replace the existing transaction by key
			key: finishTransaction.key,
			do: () => `replacement without writes`,
		})
		silo.runTransaction(replacementTransaction)()
		await flush()
		expect(
			host.querySelector(`[data-testid="transaction-finish"]`)?.textContent,
		).toContain(`output: "replacement without writes"`)
		await tab(`timelines`)
		const timeline = host.querySelector<HTMLElement>(
			`[data-testid="timeline-count"]`,
		)!
		const undo = [...timeline.querySelectorAll(`button`)].find(
			(button) => button.textContent === `undo`,
		)!
		const redo = [...timeline.querySelectorAll(`button`)].find(
			(button) => button.textContent === `redo`,
		)!
		undo.click()
		await flush()
		expect(silo.getState(countAtom)).toBe(0)
		redo.click()
		await flush()
		expect(silo.getState(countAtom)).toBe(4)
		silo.undo(countTimeline)
		silo.setState(countAtom, 7)
		// The worker replaced the branch at the same cursor and length before publishing.
		expect(silo.store.timelines.get(countTimeline.key)).toMatchObject({
			at: 1,
			history: [expect.anything()],
		})
		undo.click()
		await flush()
		expect(silo.getState(countAtom)).toBe(7)
		expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
			`timeline changed`,
		)
		undo.click()
		await flush()
		expect(silo.getState(countAtom)).toBe(0)
		redo.click()
		await flush()
		expect(silo.getState(countAtom)).toBe(7)
		worker.receive({
			type: `timeline`,
			key: `missing`,
			action: `undo`,
		})
		await flush()
		expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
			`timeline changed`,
		)

		await tab(`ecology`)
		expect(silo.store.valueMap.has(doubleSelector.key)).toBe(false)
		const generate = await vi.waitFor(() => {
			const button = host.querySelector<HTMLButtonElement>(
				`button[aria-label="Generate double"]`,
			)
			expect(button).not.toBeNull()
			return button!
		})
		generate.click()
		await flush()
		expect(worker.postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				type: `store-update`,
				update: expect.objectContaining({
					ecology: expect.objectContaining({
						edges: {
							upsert: [{ dependency: `count`, selector: `double` }],
							remove: [],
						},
					}),
				}),
			}),
		)
		await tab(`selectors`)
		expect(
			host.querySelector<HTMLInputElement>(`[aria-label="double"]`)?.value,
		).toBe(`14`)
		silo.disposeTimeline(countTimeline)
		await flush()
		await tab(`timelines`)
		expect(host.querySelector(`[data-testid="timeline-count"]`)).toBeNull()
	} finally {
		panel.dispose()
		stop()
	}
})

it(`batches tab generation and only sends changed state and graph records`, async () => {
	const { silo, host, page, worker } = fixture()
	const cachedAtom = silo.atom<number>({ key: `cached`, default: 2 })
	const useLeftAtom = silo.atom<boolean>({ key: `useLeft`, default: true })
	const leftAtom = silo.atom<number>({ key: `left`, default: 3 })
	const rightAtom = silo.atom<number>({ key: `right`, default: 5 })
	const atoms = Array.from({ length: 32 }, (_, i) =>
		silo.atom<number>({ key: `atom-${i}`, default: i }),
	)
	const selectors = Array.from({ length: 24 }, (_, i) =>
		silo.selector<number>({
			key: `selector-${i}`,
			get: ({ get }) => get(get(useLeftAtom) ? leftAtom : rightAtom) + i,
		}),
	)
	for (const atom of [cachedAtom, leftAtom, rightAtom]) silo.getState(atom)
	silo.getState(useLeftAtom)
	const panel = mountWorkerAtomIODevtools(host, page.port)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const tab = async (view: string) => {
		host
			.querySelector<HTMLButtonElement>(`[data-testid="view-${view}"]`)!
			.click()
		await flush()
	}
	const update = () => {
		const frame = worker.postMessage.mock.calls.at(-1)?.[0] as RemoteMessage
		if (frame.type !== `store-update`) throw new Error(`Missing update`)
		return frame.update
	}
	try {
		await flush()
		expect(page.postMessage.mock.calls).toEqual([
			[
				{
					type: `state-requests`,
					generate: atoms.map(({ key }) => ({ key })),
					release: [],
				},
			],
		])
		expect(worker.postMessage).toHaveBeenCalledTimes(2)
		const first = worker.postMessage.mock.calls[0][0] as RemoteMessage
		if (first.type !== `store`) throw new Error(`Missing initial snapshot`)
		const graph = projectRemoteEcology(first.snapshot.ecology)
		graph.update(update().ecology!)
		expect(update().states.map(({ token }) => token.key)).toEqual(
			atoms.map(({ key }) => key),
		)
		page.postMessage.mockClear()
		worker.postMessage.mockClear()

		await tab(`selectors`)
		expect(page.postMessage).toHaveBeenCalledOnce()
		expect(page.postMessage).toHaveBeenCalledWith({
			type: `state-requests`,
			generate: selectors.map(({ key }, watch) => ({ key, watch })),
			release: [],
		})
		expect(worker.postMessage).toHaveBeenCalledOnce()
		const initialized = update().ecology!
		expect(initialized.edges?.upsert).toHaveLength(selectors.length * 2)
		graph.update(initialized)
		expect(traceEcologyRoots(graph.read(), selectors[0].key).rootKeys).toEqual(
			expect.arrayContaining([leftAtom.key, useLeftAtom.key]),
		)
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="selector-0"]`)
				?.value,
		).toBe(`3`)

		worker.postMessage.mockClear()
		silo.setState(cachedAtom, 7)
		silo.setState(cachedAtom, 8)
		await flush()
		expect(worker.postMessage).toHaveBeenCalledOnce()
		expect(update()).toMatchObject({
			states: [{ token: cachedAtom, cache: { status: `value`, value: 8 } }],
			timelines: [],
			transactions: [],
			ecology: { nodes: { upsert: [{ key: cachedAtom.key }], remove: [] } },
		})
		expect(update().ecology?.edges).toBeUndefined()
		expect(update().ecology?.families).toBeUndefined()

		worker.postMessage.mockClear()
		silo.setState(useLeftAtom, false)
		await flush()
		expect(worker.postMessage).toHaveBeenCalledOnce()
		const changed = update().ecology!
		expect(changed.edges).toEqual({
			upsert: selectors.map(({ key }) => ({
				dependency: rightAtom.key,
				selector: key,
			})),
			remove: selectors.map(({ key }) => JSON.stringify([leftAtom.key, key])),
		})
		graph.update(changed)
		expect(
			new Set(traceEcologyRoots(graph.read(), selectors[0].key).rootKeys),
		).toEqual(new Set([rightAtom.key, useLeftAtom.key]))
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="selector-0"]`)
				?.value,
		).toBe(`5`)

		page.postMessage.mockClear()
		worker.postMessage.mockClear()
		await tab(`atoms`)
		expect(page.postMessage).toHaveBeenCalledOnce()
		expect(page.postMessage).toHaveBeenCalledWith({
			type: `state-requests`,
			generate: [],
			release: expect.arrayContaining(
				selectors.map(({ key }, watch) => ({ key, watch })),
			),
		})
		expect(worker.postMessage).not.toHaveBeenCalled()
		expect(
			host.querySelector<HTMLInputElement>(`input[aria-label="cached"]`)?.value,
		).toBe(`8`)
		page.postMessage.mockClear()
		await tab(`selectors`)
		expect(page.postMessage).toHaveBeenCalledOnce()
		expect(worker.postMessage).not.toHaveBeenCalled()
	} finally {
		panel.dispose()
		stop()
	}
})

it(`watches remote selectors only while their rows are displayed`, async () => {
	const { silo, host, page, worker } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 2 })
	const doubledSelector = silo.selector<number>({
		key: `doubled`,
		get: ({ get }) => 2 * get(countAtom),
	})
	const subject = silo.store.readonlySelectors.get(doubledSelector.key)!.subject
	const panel = mountWorkerAtomIODevtools(host, page.port)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const tab = async (view: string) => {
		host
			.querySelector<HTMLButtonElement>(`[data-testid="view-${view}"]`)!
			.click()
		await flush()
	}
	const generate = (key: string, watch?: number) => {
		worker.receive({ type: `generate`, key, watch })
	}
	const release = (watch: number) => {
		worker.receive({ type: `release`, key: doubledSelector.key, watch })
	}
	const value = () =>
		host.querySelector<HTMLInputElement>(`[aria-label="doubled"]`)?.value
	try {
		generate(doubledSelector.key)
		generate(countAtom.key, 100)
		release(100)
		expect(subject.subscribers.size).toBe(0)
		await flush()
		await tab(`selectors`)
		expect(subject.subscribers.size).toBe(1)
		silo.setState(countAtom, 3)
		await flush()
		expect(value()).toBe(`6`)

		generate(doubledSelector.key, 100)
		release(101)
		await tab(`atoms`)
		expect(subject.subscribers.size).toBe(1)
		release(100)
		expect(subject.subscribers.size).toBe(0)

		silo.setState(countAtom, 4)
		await tab(`selectors`)
		expect(value()).toBe(`8`)
		host
			.querySelector<HTMLButtonElement>(`[aria-label^="Hide debugger"]`)!
			.click()
		await flush()
		expect(subject.subscribers.size).toBe(0)

		const tripleSelector = silo.selector<number>({
			key: `triple`,
			get: ({ get }) => 3 * get(countAtom),
		})
		const triple = silo.store.readonlySelectors.get(tripleSelector.key)!.subject
		document.dispatchEvent(
			new KeyboardEvent(`keydown`, {
				ctrlKey: true,
				shiftKey: true,
				code: `KeyA`,
			}),
		)
		await flush()
		expect(subject.subscribers.size).toBe(1)
		expect(triple.subscribers.size).toBe(1)
		page.postMessage.mockImplementationOnce(() => {
			throw new Error(`Failed to send release`)
		})
		await tab(`atoms`)
		expect(host.querySelector(`[role="alert"]`)?.textContent).toBe(
			`Remote devtools disconnected`,
		)
		expect(subject.subscribers.size).toBe(0)
		expect(triple.subscribers.size).toBe(0)
	} finally {
		panel.dispose()
		stop()
	}
})

it(`discards a queued watch when its row unmounts before sending`, async () => {
	const { page } = channel()
	const connection = connectRemoteStore(messagePortTransport(page.port))
	const watch = connection.worker.watchSelector(`selector`)
	try {
		watch.dispose()
		watch.generate(true)
		watch.dispose()
		await flush()
		expect(page.postMessage).not.toHaveBeenCalled()
		watch.generate(true)
		connection.close()
		await flush()
		expect(page.postMessage.mock.calls).toEqual([[{ type: `close` }]])
	} finally {
		connection.close()
	}
})

it(`keeps Ecology metadata and uncached selectors aligned with the captured graph`, () => {
	const { silo } = fixture()
	const constantSelector = silo.selector<number>({
		key: `constant`,
		get: () => 5,
	})
	silo.getState(constantSelector)
	const track = trackRemoteEcology(silo.store)
	const projected = projectRemoteEcology(track.initial)
	expect(track.update(ecologyChanges({ values: [`missing`] }))).toBeUndefined()
	expect(
		track.update(ecologyChanges({ states: [constantSelector.key] })),
	).toBeUndefined()

	deleteCachedValue(silo.store, constantSelector.key)
	const invalidated = track.update(
		ecologyChanges({ values: [constantSelector.key] }),
	)!
	expect(projected.update(invalidated)).toBe(true)
	expect(projected.read().nodes).toMatchObject([
		{
			key: constantSelector.key,
			value: { status: `unknown` },
			dependencies: `unknown`,
		},
	])

	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 3,
	})
	const family = track.update(ecologyChanges({ families: [itemsAtoms.key] }))!
	expect(family.nodes.upsert).toEqual([])
	expect(family.families?.upsert).toMatchObject([
		{ key: itemsAtoms.key, memberCount: 0 },
	])
	expect(projected.update(family)).toBe(true)

	const { work, truncated } = projected.read()
	silo.atom<number>({ key: `🔍 reserved`, default: 0 })
	const metadata = track.update(ecologyChanges({ states: [`🔍 reserved`] }))!
	expect(metadata).toEqual({
		nodes: { upsert: [], remove: [] },
		metadata: { truncated, work: { ...work, nodes: work.nodes + 1 } },
	})
	projected.update(metadata)
	expect(projected.read().work.nodes).toBe(work.nodes + 1)
})

function ecologyChanges({
	values = [],
	states = [],
	families = [],
	dependencies = [],
}: Partial<
	Record<`values` | `states` | `families` | `dependencies`, string[]>
> = {}) {
	return {
		values: new Set(values),
		states: new Set(states),
		families: new Set(families),
		dependencies: new Set(dependencies),
	}
}

it(`updates affected Ecology members and adjacency without revisiting unrelated selectors`, () => {
	const { silo } = fixture()
	const chooseAtom = silo.atom<boolean>({ key: `choose`, default: false })
	const baseAtom = silo.atom<number>({ key: `base`, default: 2 })
	const leftSelector = silo.selector<number>({
		key: `left`,
		get: ({ get }) => get(baseAtom),
	})
	const rightSelector = silo.selector<number>({
		key: `right`,
		get: ({ get }) => get(baseAtom) * 2,
	})
	const outerSelector = silo.selector<number>({
		key: `outer`,
		get: ({ get }) => get(get(chooseAtom) ? leftSelector : rightSelector),
	})
	const unrelatedSelector = silo.selector<number>({
		key: `unrelated`,
		get: ({ get }) => get(baseAtom),
	})
	silo.getState(leftSelector)
	silo.getState(outerSelector)
	silo.getState(unrelatedSelector)
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 9,
	})
	const otherAtoms = silo.atomFamily<number, string>({
		key: `other`,
		default: 4,
	})
	const existing = silo.findState(itemsAtoms, `two`)
	silo.getState(existing)
	const track = trackRemoteEcology(silo.store)
	const projection = projectRemoteEcology(track.initial)
	const related = vi.spyOn(silo.store.selectorGraph, `getRelatedKeys`)
	const freshlyCaptured = () =>
		projectRemoteEcology(captureEcologySnapshot(silo.store)).read()
	try {
		const member = silo.findState(itemsAtoms, `one`)
		silo.getState(member)
		related.mockClear()
		const added = track.update(ecologyChanges({ states: [member.key] }))!
		expect(related).not.toHaveBeenCalled()
		expect(added.nodes.upsert.map(({ key }) => key)).toEqual([member.key])
		expect(added.families?.upsert[0].memberKeys).toEqual([
			existing.key,
			member.key,
		])
		projection.update(added)
		expect(projection.read()).toEqual(freshlyCaptured())
		const firstMember = silo.findState(otherAtoms, `first`)
		silo.getState(firstMember)
		projection.update(
			track.update(ecologyChanges({ states: [firstMember.key] }))!,
		)
		expect(projection.read()).toEqual(freshlyCaptured())

		silo.setState(chooseAtom, true)
		silo.getState(outerSelector)
		related.mockClear()
		const rewired = track.update(
			ecologyChanges({
				values: [chooseAtom.key, outerSelector.key],
				dependencies: [outerSelector.key],
			}),
		)!
		expect(related).not.toHaveBeenCalledWith(unrelatedSelector.key)
		expect(rewired.edges).toEqual({
			upsert: [{ dependency: leftSelector.key, selector: outerSelector.key }],
			remove: [JSON.stringify([rightSelector.key, outerSelector.key])],
		})
		projection.update(rewired)
		expect(projection.read()).toEqual(freshlyCaptured())

		silo.disposeState(itemsAtoms, `one`)
		related.mockClear()
		const removed = track.update(ecologyChanges({ states: [member.key] }))!
		expect(related).not.toHaveBeenCalled()
		expect(removed.nodes.remove).toEqual([member.key])
		expect(removed.families?.upsert[0].memberKeys).toEqual([existing.key])
		projection.update(removed)
		expect(projection.read()).toEqual(freshlyCaptured())
		expect(
			track.update(ecologyChanges({ families: [itemsAtoms.key] })),
		).toBeUndefined()
		silo.store.families.delete(itemsAtoms.key)
		const familyRemoval = ecologyChanges({ families: [itemsAtoms.key] })
		projection.update(track.update(familyRemoval)!)
		expect(projection.read()).toEqual(freshlyCaptured())
		expect(track.update(familyRemoval)).toBeUndefined()
	} finally {
		related.mockRestore()
	}
})

it(`recaptures the bounded prefix when Ecology crosses and drops below its node limit`, () => {
	const { silo } = fixture()
	const itemsAtoms = silo.atomFamily<number, string>({
		key: `items`,
		default: 5,
	})
	const first = silo.findState(itemsAtoms, `first`)
	silo.getState(first)
	silo.selector<number>({ key: `constant`, get: () => 3 })
	const limits = { maxNodes: 2, maxFamilies: 2, maxRelations: 5 }
	const track = trackRemoteEcology(silo.store, limits)
	const projection = projectRemoteEcology(track.initial)
	const second = silo.findState(itemsAtoms, `second`)
	silo.getState(second)
	projection.update(track.update(ecologyChanges({ states: [second.key] }))!)
	expect(projection.read().truncated.nodes).toBe(true)
	expect(track.update(ecologyChanges({ states: [second.key] }))).toBeUndefined()
	expect(projection.read()).toEqual(
		projectRemoteEcology(captureEcologySnapshot(silo.store, limits)).read(),
	)

	silo.disposeState(itemsAtoms, `first`)
	projection.update(track.update(ecologyChanges({ states: [first.key] }))!)
	expect(projection.read().truncated.nodes).toBe(false)
	expect(projection.read()).toEqual(
		projectRemoteEcology(captureEcologySnapshot(silo.store, limits)).read(),
	)
})

it.each([8, 30])(
	`matches a fresh Ecology capture through seeded mutations (node limit %s)`,
	async (maxNodes) => {
		const { silo } = fixture()
		const chooseAtom = silo.atom<boolean>({ key: `choose`, default: false })
		const itemsAtoms = silo.atomFamily<number, string>({
			key: `items`,
			default: 0,
		})
		const linksSelectors = silo.selectorFamily<number, string>({
			key: `links`,
			get:
				(key) =>
				({ get }) =>
					get(itemsAtoms, get(chooseAtom) ? key : `shared`),
		})
		const limits = { maxNodes, maxFamilies: 4, maxRelations: 30 }
		const tracker = trackRemoteEcology(silo.store, limits)
		const projection = projectRemoteEcology(tracker.initial)
		const stop = observeStore(silo.store, (changes) => {
			const patch = tracker.update(changes)
			if (patch) projection.update(patch)
		})
		let seed = 71
		const random = (bound: number) => {
			seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
			return (seed >>> 8) % bound
		}
		try {
			for (let step = 0; step < 80; step++) {
				const key = String(random(8))
				switch (random(5)) {
					case 0:
						silo.getState(linksSelectors, key)
						break
					case 1:
						silo.setState(itemsAtoms, key, step)
						break
					case 2:
						silo.setState(chooseAtom, !silo.getState(chooseAtom))
						break
					case 3:
						if (seekInStore(silo.store, itemsAtoms, key))
							silo.disposeState(itemsAtoms, key)
						break
					case 4:
						if (seekInStore(silo.store, linksSelectors, key))
							silo.disposeState(linksSelectors, key)
						break
					default:
						throw new Error(`Invalid seeded operation`)
				}
				await flush()
				expect(projection.read(), `mutation ${step}`).toEqual(
					projectRemoteEcology(
						captureEcologySnapshot(silo.store, limits),
					).read(),
				)
			}
		} finally {
			stop()
		}
	},
)

it.each([1, 2])(
	`keeps the bounded Ecology graph when a selector gains %s edges`,
	(fanout) => {
		const { silo } = fixture()
		const baseAtom = silo.atom<number>({ key: `base`, default: 5 })
		const otherAtom = silo.atom<number>({ key: `other`, default: 5 })
		const firstSelector = silo.selector<number>({
			key: `first`,
			get: ({ get }) => get(baseAtom),
		})
		const secondSelector = silo.selector<number>({
			key: `second`,
			get: ({ get }) => get(baseAtom) + (fanout === 2 ? get(otherAtom) : 0),
		})
		silo.getState(firstSelector)
		const limits = { maxNodes: 10, maxFamilies: 5, maxRelations: 1 }
		const track = trackRemoteEcology(silo.store, limits)
		const projection = projectRemoteEcology(track.initial)
		expect(projection.read().truncated.relations).toBe(false)
		silo.getState(secondSelector)
		projection.update(
			track.update(
				ecologyChanges({
					values: [secondSelector.key, otherAtom.key],
					dependencies: [secondSelector.key],
				}),
			)!,
		)
		expect(projection.read().truncated.relations).toBe(true)
		expect(projection.read()).toEqual(
			projectRemoteEcology(captureEcologySnapshot(silo.store, limits)).read(),
		)
	},
)

it(`projects initial timeline entries, history clear, and newly registered histories`, async () => {
	const { silo, page, worker } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 2 })
	// eslint-disable-next-line atom.io/naming-convention -- this key is deliberately excluded by the full store protocol
	const privateAtom = silo.atom<number>({ key: `👁‍🗨 private`, default: 0 })
	silo.setState(privateAtom, 1)
	silo.transaction<() => number>({ key: `🔍 ignored`, do: () => 1 })
	silo.timeline({ key: `🔍 ignored`, scope: [] })
	const countTimeline = silo.timeline({ key: `count`, scope: [countAtom] })
	silo.setState(countAtom, 3)
	const connection = connectRemoteStore(messagePortTransport(page.port))
	const stop = exposeDevtoolsStore(worker.port, silo)
	try {
		await flush()
		expect(
			connection.store.valueMap.get(
				connection.worker.views.timelineLog(countTimeline.key).key,
			),
		).toMatchObject({
			at: 1,
			history: [expect.anything()],
		})
		expect(connection.store.atoms.has(privateAtom.key)).toBe(false)

		worker.receive({ type: `timeline`, key: countTimeline.key, action: `undo` })
		expect(silo.getState(countAtom)).toBe(3)
		expect(worker.postMessage).toHaveBeenLastCalledWith({
			type: `edit-error`,
			message: `Remote timeline changed. Try again with the current history.`,
		})

		const totalTransaction = silo.transaction<() => number>({
			key: `total`,
			do: () => 3,
		})
		silo.timeline({ key: `empty`, scope: [] })
		silo.timeline({ key: `👁‍🗨 ignored`, scope: [] })
		silo.transaction<() => number>({ key: `👁‍🗨 ignored`, do: () => 1 })
		silo.clearTimeline(countTimeline)
		silo.setState(privateAtom, 2)
		await flush()
		expect(
			connection.store.valueMap.get(
				connection.worker.views.timelineLog(countTimeline.key).key,
			),
		).toMatchObject({
			at: 0,
			history: [],
		})
		expect(
			connection.store.valueMap.get(connection.worker.views.timelineIndex.key),
		).toContainEqual({ type: `timeline`, key: `empty` })
		expect(
			connection.store.valueMap.get(
				connection.worker.views.transactionIndex.key,
			),
		).toContainEqual(totalTransaction)
		expect(connection.store.timelines.size).toBe(0)
		expect(connection.store.transactions.size).toBe(0)

		const itemsAtoms = silo.atomFamily<number, string>({
			key: `items`,
			default: 4,
		})
		await flush()
		worker.postMessage.mockClear()
		const one = silo.findState(itemsAtoms, `one`)
		const two = silo.findState(itemsAtoms, `two`)
		silo.getState(one)
		silo.getState(two)
		await flush()
		worker.postMessage.mockClear()
		const transient = silo.timeline({ key: `transient`, scope: [] })
		silo.disposeTimeline(transient)
		silo.getState(silo.findState(itemsAtoms, `temporary`))
		silo.disposeState(itemsAtoms, `temporary`)
		await flush()
		expect(worker.postMessage).not.toHaveBeenCalled()

		silo.runTransaction(totalTransaction)()
		await Promise.resolve()
		stop()
		await flush()
		expect(worker.postMessage.mock.calls).toEqual([[{ type: `close` }]])
	} finally {
		connection.close()
		stop()
	}
})

it(`keeps worker revisions and rejects invalid state and history commands`, async () => {
	const { silo, page, worker } = fixture()
	const dataAtom = silo.atom<unknown>({
		key: `data`,
		default: [true, null, `value`],
	})
	const writableSelector = silo.selector<unknown>({
		key: `writable`,
		get: ({ get }) => get(dataAtom),
		set: ({ set }, value) => {
			set(dataAtom, value)
		},
	})
	const readonlySelector = silo.selector<unknown>({
		key: `readonly`,
		get: () => 7,
	})
	const opaqueAtom = silo.atom<unknown>({
		key: `opaque`,
		default: () => () => 0,
	})
	class Quantity {
		public amount = 3
	}
	const instancesAtom = silo.atom<unknown>({
		key: `instances`,
		default: { quantity: new Quantity() },
	})
	const pendingAtom = silo.atom<Promise<number>>({
		key: `pending`,
		default: () => new Promise(() => {}),
	})
	const logTransaction = silo.transaction<() => void>({
		key: `log`,
		do: () => {},
	})
	silo.timeline({ key: `data`, scope: [dataAtom] })
	for (const token of [
		dataAtom,
		writableSelector,
		readonlySelector,
		opaqueAtom,
		instancesAtom,
		pendingAtom,
	])
		silo.getState(token)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const last = () => worker.postMessage.mock.calls.at(-1)?.[0] as RemoteMessage
	const edit = (key: string, value: unknown, revision = 0) => {
		worker.receive({ type: `edit`, key, revision, value })
	}
	try {
		const initial = last()
		expect(initial.type).toBe(`store`)
		if (initial.type !== `store`) throw new Error(`missing snapshot`)
		expect(
			initial.snapshot.states.find(({ token }) => token.key === `opaque`)
				?.editable,
		).toBe(false)
		expect(
			initial.snapshot.states.find(
				({ token }) => token.key === instancesAtom.key,
			),
		).toMatchObject({
			cache: { status: `value`, value: { quantity: { amount: 3 } } },
			editable: false,
		})
		expect(
			initial.snapshot.states.find(({ token }) => token.key === `pending`)
				?.editable,
		).toBe(false)
		worker.receive(null)
		worker.receive({ type: `generate`, key: `🔍 private` })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Remote state is unavailable`,
		})
		worker.receive({ type: `dispose`, key: `missing` })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Remote state is unavailable`,
		})
		worker.receive({ type: `dispose`, key: dataAtom.key })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Only family members can be disposed`,
		})
		for (const key of [
			readonlySelector.key,
			opaqueAtom.key,
			instancesAtom.key,
		]) {
			edit(key, 5)
			expect(last()).toMatchObject({
				type: `edit-error`,
				message: `Remote store rejected this value`,
			})
		}
		class Quantities extends Array<number> {}
		for (const value of [
			new Quantities(3, 4),
			{
				get amount() {
					return 3
				},
			},
		]) {
			silo.setState(instancesAtom, () => value)
			await flush()
			const frame = last()
			if (frame.type !== `store-update`) throw new Error(`missing update`)
			expect(
				frame.update.states.find(({ token }) => token.key === instancesAtom.key),
			).toMatchObject({
				cache: { status: `value`, value: structuredClone(value) },
				editable: false,
			})
		}
		const cyclic: unknown[] = []
		cyclic.push(cyclic)
		edit(dataAtom.key, cyclic)
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Remote store rejected this value`,
		})
		edit(writableSelector.key, 4)
		expect(silo.getState(dataAtom)).toBe(4)
		await flush()
		edit(dataAtom.key, 5)
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: expect.stringContaining(`state changed`),
		})

		silo.transaction<() => void>({ key: `🔍 private`, do: () => {} })
		silo.timeline({ key: `🔍 private`, scope: [] })
		silo.atom<number>({ key: `🔍 private`, default: 0 })
		for (let i = 0; i < 201; i++) silo.runTransaction(logTransaction)()
		await flush()
		expect(last()).toMatchObject({
			type: `store-update`,
			update: {
				transactions: [
					{ history: { start: 0, length: 0, append: expect.any(Array) } },
				],
			},
		})
		const frame = last()
		if (frame.type !== `store-update`) throw new Error(`missing update`)
		expect(frame.update.transactions[0].history.append).toHaveLength(200)
		const subject = silo.store.transactions.get(logTransaction.key)!.subject
		const stopPayload = subject.subscribe(`test:payload`, (event) => {
			event.subEvents.push(
				{
					type: `atom_creation`,
					token: dataAtom,
					timestamp: 0,
					value: () => {},
				},
				{
					type: `molecule_disposal`,
					key: `molecule`,
					timestamp: 0,
					provenance: [],
					values: [[`data`, 4]],
				},
			)
		})
		silo.runTransaction(logTransaction)()
		stopPayload()
		await flush()
		const lifecycle = last()
		if (lifecycle.type !== `store-update`) throw new Error(`missing update`)
		const retained = lifecycle.update.transactions[0].history
		expect(retained).toMatchObject({ start: 1, length: 199 })
		expect(retained.append).toHaveLength(1)
		expect(retained.append[0]).toMatchObject({
			subEvents: [{ value: expect.any(Error) }, { values: [[`data`, 4]] }],
		})
		vi.spyOn(silo, `getState`).mockImplementationOnce(() => {
			// oxlint-disable-next-line typescript/only-throw-error -- application getters may throw any value
			throw `Application could not generate state`
		})
		worker.receive({ type: `generate`, key: dataAtom.key })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Application could not generate state`,
		})
		page.postMessage({ type: `close` })
		await flush()
		expect(worker.close).toHaveBeenCalledOnce()
	} finally {
		stop()
	}
})

async function flush() {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}

it(`removes departed states from the projection and never invokes a worker getter locally`, () => {
	const { silo, worker } = fixture()
	const setupAtom = silo.atom<number>({ key: `setup`, default: 0 })
	silo.selector<number>({
		key: `computed`,
		get: ({ get }) => get(setupAtom),
		set: ({ set }, next) => {
			set(setupAtom, next)
		},
	})
	const stop = exposeDevtoolsStore(worker.port, silo)
	try {
		const message = worker.postMessage.mock.calls[0][0] as RemoteMessage
		if (message.type !== `store`) throw new Error(`missing snapshot`)
		const mirror = new Silo({
			name: `mirror`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const projection = createRemoteProjection(mirror)
		projection.apply(message.snapshot)
		expect(
			mirror.getState({ type: `writable_pure_selector`, key: `computed` }),
		).toBeUndefined()
		projection.update({
			states: [
				{
					token: { key: setupAtom.key, type: `readonly_pure_selector` },
					cache: { status: `uncached` },
					revision: 1,
					editable: false,
				},
			],
			removedStates: [`computed`],
			timelines: [],
			removedTimelines: [],
			transactions: [],
		})
		expect(mirror.store.atoms.has(`setup`)).toBe(false)
		expect(mirror.store.readonlySelectors.has(`setup`)).toBe(true)
		expect(mirror.store.writableSelectors.has(`computed`)).toBe(false)
	} finally {
		stop()
	}
})

it(`cleans up a whole-store connection when an endpoint fails to mount`, () => {
	const { silo, host, worker } = fixture()
	worker.start.mockImplementationOnce(() => {
		throw new Error(`worker port`)
	})
	expect(() => exposeDevtoolsStore(worker.port, silo)).toThrow(`worker port`)
	const next = channel()
	const stop = exposeDevtoolsStore(next.worker.port, silo)
	vi.spyOn(host, `append`).mockImplementationOnce(() => {
		throw new Error(`panel host`)
	})
	expect(() => mountWorkerAtomIODevtools(host, next.page.port)).toThrow(
		`panel host`,
	)
	expect(next.page.close).toHaveBeenCalledOnce()
	next.worker.receive({ type: `generate`, key: `unavailable` })
	stop()
})

beforeEach(() => {
	localStorage.clear()
})
afterEach(() => {
	document.body.replaceChildren()
})

it(`observes the worker, edits primitives, and handles shutdown using the shared panel`, async () => {
	const { silo, host, page, worker } = fixture()
	const countAtom = silo.atom<number>({ key: `count`, default: 2 })
	const nameAtom = silo.atom<string>({ key: `name`, default: `before` })
	const enabledAtom = silo.atom<boolean>({ key: `enabled`, default: false })
	const nullableAtom = silo.atom<WorkerDevtoolsValue>({
		key: `nullable`,
		default: null,
	})
	const readonlyAtom = silo.atom<number>({ key: `readonly`, default: 11 })
	const doubledSelector = silo.selector<number>({
		key: `doubled`,
		get: ({ get }) => 2 * get(countAtom),
	})
	localStorage.setItem(`🔍 Worker Devtools View`, JSON.stringify(`unknown`))
	const panel = mountWorkerAtomIODevtools(host, page.port)
	const stop = exposeDevtoolsStore(worker.port, silo, [
		{ token: countAtom, validateEdit: () => true },
		{ token: nameAtom, validateEdit: () => true },
		{ token: enabledAtom, validateEdit: () => true },
		{ token: nullableAtom, validateEdit: () => true },
		{ token: readonlyAtom },
		{ token: doubledSelector },
	])
	try {
		await flush()
		page.receive(null)
		expect(host.querySelector(`h1`)?.textContent).toBe(`atom.io`)
		const field = (key: string) =>
			host.querySelector<HTMLInputElement>(`input[aria-label="` + key + `"]`)!
		const type = (input: HTMLInputElement, value: string) => {
			input.focus()
			input.value = value
			input.dispatchEvent(new Event(`input`, { bubbles: true }))
		}
		const press = (el: HTMLElement, key: string) => {
			el.dispatchEvent(new KeyboardEvent(`keydown`, { key, bubbles: true }))
		}
		const count = field(`count`)
		expect(count.value).toBe(`2`)
		expect(field(`readonly`).readOnly).toBe(true)
		expect(
			host.querySelector(`[data-testid="nullable-state-editor"]`)?.textContent,
		).toContain(`null`)
		silo.setState(nullableAtom, NaN)
		await flush()
		expect(host.textContent).toContain(`Expected a synchronous JSON primitive`)
		type(count, ``)
		press(count, `Enter`)
		await flush()
		expect(silo.getState(countAtom)).toBe(2)
		type(count, `42`)
		press(count, `ArrowLeft`)
		press(count, `Escape`)
		expect(count.value).toBe(`2`)

		type(count, `17`)
		silo.setState(countAtom, 3)
		await flush()
		expect(count.value).toBe(`17`)
		press(count, `Enter`)
		await flush()
		expect(host.querySelector(`[role="alert"]`)?.textContent).toContain(
			`state changed`,
		)
		expect(count.value).toBe(`3`)
		type(count, `6`)
		count.blur()
		await flush()
		expect(silo.getState(countAtom)).toBe(6)

		const name = field(`name`)
		type(name, `after`)
		press(name, `Enter`)
		const enabled = field(`enabled`)
		enabled.click()
		await flush()
		expect(silo.getState(nameAtom)).toBe(`after`)
		expect(silo.getState(enabledAtom)).toBe(true)
		expect(enabled.checked).toBe(true)
		const atoms = host.querySelector<HTMLElement>(`[data-testid="view-atoms"]`)!
		press(atoms, `ArrowRight`)
		await flush()
		expect(field(`doubled`).value).toBe(`12`)
		expect(field(`doubled`).readOnly).toBe(true)
		atoms.click()
		await flush()
		worker.dispatchEvent(new Event(`messageerror`))
		await flush()
		expect(host.querySelector(`[role="alert"]`)?.textContent).toBe(
			`Remote devtools disconnected`,
		)
		expect(worker.close).toHaveBeenCalledOnce()
		type(field(`count`), `7`)
		field(`count`).blur()
		expect(silo.getState(countAtom)).toBe(6)
	} finally {
		panel.dispose()
		panel.dispose()
		stop()
	}
	expect(host.children.length).toBe(0)
})

it(`checks exposure and edit permissions in the store owner`, async () => {
	const { silo, page, worker } = fixture()
	const valueAtom = silo.atom<WorkerDevtoolsValue>({
		key: `value`,
		default: null,
	})
	const readonlyAtom = silo.atom<number>({ key: `readonly`, default: 10 })
	const optionsAtoms = silo.atomFamily<number, string>({
		key: `options`,
		default: 2,
	})
	const reservedAtom = silo.atom<number>({
		// eslint-disable-next-line atom.io/naming-convention -- exercise an introspection key
		key: `🔍 private`,
		default: 10,
	})
	const member = silo.findState(optionsAtoms, `member`)
	silo.getState(member)
	for (const token of [
		{ key: `missing`, type: `atom` } satisfies RegularAtomToken<number>,
		member,
		reservedAtom,
	]) {
		expect(() =>
			exposeDevtoolsStore(channel().worker.port, silo, [{ token }]),
		).toThrow(/standalone/)
	}
	expect(() =>
		exposeDevtoolsStore(channel().worker.port, silo, [
			{ token: valueAtom },
			{ token: valueAtom },
		]),
	).toThrow(/Duplicate/)

	const validateEdit = vi.fn(() => true)
	vi.spyOn(silo, `getState`).mockImplementationOnce(() => {
		throw new Error(`unreadable`)
	})
	const stop = exposeDevtoolsStore(worker.port, silo, [
		{ token: valueAtom, validateEdit },
		{ token: readonlyAtom },
	])
	expect(worker.postMessage).toHaveBeenLastCalledWith(
		expect.objectContaining({
			states: expect.arrayContaining([
				expect.objectContaining({ error: `Could not read remote state` }),
			]),
		}),
	)
	const sendEdit = (key: string, value: unknown, revision = 0) => {
		worker.receive({ type: `edit`, key, value, revision })
	}
	const expectError = (message: string) => {
		expect(worker.postMessage).toHaveBeenLastCalledWith({
			type: `edit-error`,
			message,
		})
	}
	try {
		worker.receive(null)
		worker.receive({ type: `unrelated` })
		sendEdit(`missing`, 6)
		expectError(`Remote state is readonly or unavailable`)
		sendEdit(`readonly`, 6)
		expectError(`Remote state is readonly or unavailable`)
		sendEdit(`value`, 6)
		expectError(`Remote store rejected this value`)
		silo.setState(valueAtom, 4)
		for (const value of [null, NaN, {}, `4`]) {
			sendEdit(`value`, value, 1)
			expectError(`Remote store rejected this value`)
		}
		validateEdit.mockReturnValueOnce(false)
		sendEdit(`value`, 8, 1)
		expectError(`Remote store rejected this value`)
		validateEdit.mockImplementationOnce(() => {
			// oxlint-disable-next-line typescript/only-throw-error -- an application validator may throw any value
			throw `Application declined the edit`
		})
		sendEdit(`value`, 8, 1)
		expectError(`Application declined the edit`)
		silo.setState(valueAtom, Infinity)
		sendEdit(`value`, 6, 2)
		expectError(`Remote store rejected this value`)
		await flush()
		expect(worker.postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				states: expect.arrayContaining([
					expect.objectContaining({
						error: `Expected a synchronous JSON primitive`,
					}),
				]),
			}),
		)
		silo.store.atoms.delete(valueAtom.key)
		sendEdit(`value`, 8, 2)
		expectError(`Remote state is readonly or unavailable`)
		await flush()
		expect(worker.postMessage).toHaveBeenLastCalledWith(
			expect.objectContaining({
				states: expect.arrayContaining([
					expect.objectContaining({ error: `State is no longer available` }),
				]),
			}),
		)
		page.postMessage({ type: `close` })
		await flush()
		expect(worker.close).toHaveBeenCalledOnce()
	} finally {
		stop()
	}
})

it(`releases either endpoint if startup fails or the panel is removed`, async () => {
	const { silo, host, page, worker } = fixture()
	const startupAtom = silo.atom<number>({ key: `startup`, default: 0 })
	worker.start.mockImplementationOnce(() => {
		throw new Error(`worker port`)
	})
	expect(() =>
		exposeDevtoolsStore(worker.port, silo, [{ token: startupAtom }]),
	).toThrow(`worker port`)
	expect(worker.close).toHaveBeenCalledOnce()
	page.start.mockImplementationOnce(() => {
		throw new Error(`panel port`)
	})
	expect(() => mountWorkerAtomIODevtools(host, page.port)).toThrow(`panel port`)
	expect(page.close).toHaveBeenCalledOnce()
	await flush()

	const waiting = channel()
	const waitingPanel = mountWorkerAtomIODevtools(host, waiting.page.port)
	await flush()
	expect(host.querySelector(`[role="status"]`)?.textContent).toContain(
		`Waiting for the remote store`,
	)
	waiting.page.dispatchEvent(new Event(`messageerror`))
	await flush()
	expect(host.querySelector(`[role="status"]`)).toBeNull()
	expect(host.querySelector(`[role="alert"]`)?.textContent).toBe(
		`Remote devtools disconnected`,
	)
	waitingPanel.dispose()

	const next = channel()
	const panel = mountWorkerAtomIODevtools(host, next.page.port, {
		hideByDefault: true,
	})
	const stop = exposeDevtoolsStore(next.worker.port, silo, [
		{ token: startupAtom },
	])
	silo.setState(startupAtom, 1)
	panel.dispose()
	stop()
	await flush()
	expect(next.page.close).toHaveBeenCalledOnce()
	expect(next.worker.close).toHaveBeenCalledOnce()
})
