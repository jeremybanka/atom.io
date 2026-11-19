import type { RegularAtomToken } from "atom.io"
import { Silo } from "atom.io"
import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { mountWorkerAtomIODevtools } from "../src/index.ts"
import { exposeDevtoolsStore, type WorkerDevtoolsValue } from "../src/worker.ts"

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

async function flush() {
	for (let i = 0; i < 8; i++) await Promise.resolve()
}

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
	localStorage.setItem(`🔍 Worker Devtools View`, JSON.stringify(`ecology`))
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
