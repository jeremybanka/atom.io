import type { RegularAtomToken } from "atom.io"
import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountAtomIODevtools, mountWorkerAtomIODevtools } from "../src/index.ts"
import { exposeDevtoolsStore, type WorkerDevtoolsValue } from "../src/worker.ts"
import { createWorkerProjection } from "../src/worker-projection.ts"
import type { WorkerMessage } from "../src/worker-protocol.ts"

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
	const switchTo = async (id: string) => {
		const select = active()!.querySelector<HTMLSelectElement>(
			`select[data-store-picker]`,
		)!
		select.value = id
		select.dispatchEvent(new Event(`change`, { bubbles: true }))
		await flush()
	}
	try {
		await flush()
		expect(host.querySelectorAll(`debugger-panel`)).toHaveLength(3)
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="local"]`)?.value,
		).toBe(`page`)
		firstStore.setState(firstAtom, 10)
		secondStore.setState(secondAtom, 20)
		await switchTo(`second`)
		expect(
			active()?.querySelector<HTMLInputElement>(`[aria-label="second"]`)?.value,
		).toBe(`20`)
		await switchTo(`first`)
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
		worker.receive({
			type: `timeline`,
			key: `count`,
			action: `undo`,
			at: -1,
			length: -1,
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
				type: `store`,
				snapshot: expect.objectContaining({
					ecology: expect.objectContaining({
						edges: [{ dependency: `count`, selector: `double` }],
					}),
				}),
			}),
		)
		await tab(`selectors`)
		expect(
			host.querySelector<HTMLInputElement>(`[aria-label="double"]`)?.value,
		).toBe(`8`)
		silo.disposeTimeline(countTimeline)
		await flush()
		await tab(`timelines`)
		expect(host.querySelector(`[data-testid="timeline-count"]`)).toBeNull()
	} finally {
		panel.dispose()
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
		pendingAtom,
	])
		silo.getState(token)
	const stop = exposeDevtoolsStore(worker.port, silo)
	const last = () => worker.postMessage.mock.calls.at(-1)?.[0] as WorkerMessage
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
			initial.snapshot.states.find(({ token }) => token.key === `pending`)
				?.editable,
		).toBe(false)
		worker.receive(null)
		worker.receive({ type: `generate`, key: `🔍 private` })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Worker state is unavailable`,
		})
		worker.receive({ type: `dispose`, key: `missing` })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Worker state is unavailable`,
		})
		worker.receive({ type: `dispose`, key: dataAtom.key })
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Only family members can be disposed`,
		})
		for (const key of [readonlySelector.key, opaqueAtom.key]) {
			edit(key, 5)
			expect(last()).toMatchObject({
				type: `edit-error`,
				message: `Worker rejected this value`,
			})
		}
		const cyclic: unknown[] = []
		cyclic.push(cyclic)
		edit(dataAtom.key, cyclic)
		expect(last()).toMatchObject({
			type: `edit-error`,
			message: `Worker rejected this value`,
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
			type: `store`,
			snapshot: { transactions: [{ history: expect.any(Array) }] },
		})
		const snapshot = last()
		if (snapshot.type !== `store`) throw new Error(`missing snapshot`)
		expect(snapshot.snapshot.transactions[0].history).toHaveLength(200)
		const subject = silo.store.transactions.get(logTransaction.key)!.subject
		subject.next({
			type: `transaction_outcome`,
			token: { key: `unrelated`, type: `transaction` },
			id: `unrelated`,
			params: [],
			output: undefined,
			subEvents: [],
			timestamp: 0,
		})
		subject.next({
			type: `transaction_outcome`,
			token: logTransaction,
			id: `lifecycle`,
			params: [],
			output: undefined,
			timestamp: 0,
			subEvents: [
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
			],
		})
		await flush()
		const lifecycle = last()
		if (lifecycle.type !== `store`) throw new Error(`missing snapshot`)
		expect(
			lifecycle.snapshot.transactions[0].history.at(-1)?.event,
		).toMatchObject({
			id: `lifecycle`,
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
		const message = worker.postMessage.mock.calls[0][0] as WorkerMessage
		if (message.type !== `store`) throw new Error(`missing snapshot`)
		const mirror = new Silo({
			name: `mirror`,
			lifespan: `ephemeral`,
			isProduction: true,
		})
		const projection = createWorkerProjection(mirror)
		projection.apply(message.snapshot)
		expect(
			mirror.getState({ type: `writable_pure_selector`, key: `computed` }),
		).toBeUndefined()
		projection.apply({ ...message.snapshot, states: [] })
		expect(mirror.store.atoms.has(`setup`)).toBe(false)
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
		expect(host.querySelector(`h1`)?.textContent).toBe(`atom.io · Worker`)
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
			`Worker devtools disconnected`,
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
		expect(() => exposeDevtoolsStore(worker.port, silo, [{ token }])).toThrow(
			/standalone/,
		)
	}
	expect(() =>
		exposeDevtoolsStore(worker.port, silo, [
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
				expect.objectContaining({ error: `Could not read worker state` }),
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
		expectError(`Worker state is readonly or unavailable`)
		sendEdit(`readonly`, 6)
		expectError(`Worker state is readonly or unavailable`)
		sendEdit(`value`, 6)
		expectError(`Worker rejected this value`)
		silo.setState(valueAtom, 4)
		for (const value of [null, NaN, {}, `4`]) {
			sendEdit(`value`, value, 1)
			expectError(`Worker rejected this value`)
		}
		validateEdit.mockReturnValueOnce(false)
		sendEdit(`value`, 8, 1)
		expectError(`Worker rejected this value`)
		validateEdit.mockImplementationOnce(() => {
			// oxlint-disable-next-line typescript/only-throw-error -- an application validator may throw any value
			throw `Application declined the edit`
		})
		sendEdit(`value`, 8, 1)
		expectError(`Application declined the edit`)
		silo.setState(valueAtom, Infinity)
		sendEdit(`value`, 6, 2)
		expectError(`Worker rejected this value`)
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
		expectError(`Worker state is readonly or unavailable`)
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
