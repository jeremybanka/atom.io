import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	readCell,
	textTargets,
} from "../experiments/behavior-resumption/host/dom.ts"
import {
	type BehaviorScope,
	type BehaviorStats,
	createBehaviorScope,
	type StateAdapter,
} from "../experiments/behavior-resumption/host/scope.ts"

const scopes: BehaviorScope[] = []

beforeEach(() => {
	document.body.replaceChildren()
})

afterEach(() => {
	for (const scope of scopes.splice(0)) scope.dispose()
})

function fixture(owner: Document = document): HTMLButtonElement {
	owner.body.innerHTML = `<button type="button" data-resume-capture='["quantity"]'>Add</button>
		<span id="quantity"><!--start-->7<!--end--></span><strong id="cart">11</strong>
		<script type="application/json" id="resume-state-quantity">{"version":1,"value":7,"text":["quantity"]}</script>
		<script type="application/json" id="resume-state-cart">{"version":1,"value":11,"text":["cart"]}</script>`
	return owner.querySelector(`button`)!
}

function testAdapter(onUnsubscribe?: (id: string) => void) {
	const listeners = new Map<string, Set<(value: number) => void>>()
	const unsubscribes: ReturnType<typeof vi.fn>[] = []
	const adapter = {
		create: vi.fn((id: string, initial: number) => {
			let value = initial
			const writes = new Set<(value: number) => void>()
			listeners.set(id, writes)
			return {
				get: () => value,
				set(next: number) {
					value = next
					for (const write of writes) write(next)
				},
				subscribe(write: (value: number) => void) {
					writes.add(write)
					const unsubscribe = vi.fn(() => {
						writes.delete(write)
						onUnsubscribe?.(id)
					})
					unsubscribes.push(unsubscribe)
					return unsubscribe
				},
			}
		}),
		dispose: vi.fn(),
	} satisfies StateAdapter
	return { adapter, listeners, unsubscribes }
}

function testScope(adapter: StateAdapter, owner: Document = document) {
	const stats: BehaviorStats = {
		cells: 0,
		bindings: 0,
		handlerCalls: 0,
		domWrites: 0,
	}
	const scope = createBehaviorScope(owner, adapter, stats)
	scopes.push(scope)
	return { scope, stats }
}

describe(`experimental behavior host`, () => {
	it(`lazily resumes seeded state with a non-atom adapter and preserves exact nodes`, () => {
		const button = fixture()
		const target = document.getElementById(`quantity`)!
		const nodes = Array.from(target.childNodes)
		const { adapter, listeners } = testAdapter()
		const { scope, stats } = testScope(adapter)
		expect(adapter.create).not.toHaveBeenCalled()
		expect(listeners.size).toBe(0)
		expect(stats).toEqual({
			cells: 0,
			bindings: 0,
			handlerCalls: 0,
			domWrites: 0,
		})
		const snapshot = readCell(document, `quantity`)
		expect(textTargets(document, snapshot)[0]).toBe(nodes[1])
		const [quantity] = scope.capture(button)
		expect(adapter.create).toHaveBeenCalledExactlyOnceWith(`quantity`, 7)
		expect(quantity.get()).toBe(7)
		expect(stats.domWrites).toBe(0)
		quantity.set((value) => value + 2)
		expect(quantity.get()).toBe(9)
		expect(target.textContent).toBe(`9`)
		expect(target.childNodes.length).toBe(nodes.length)
		nodes.forEach((node, index) => {
			expect(target.childNodes[index]).toBe(node)
		})
		expect(scope.capture(button)[0]).toBe(quantity)
		expect(adapter.create).toHaveBeenCalledTimes(1)
		expect(listeners.get(`quantity`)!.size).toBe(1)
		expect(stats).toEqual({
			cells: 1,
			bindings: 1,
			handlerCalls: 2,
			domWrites: 1,
		})
	})

	it(`keeps quantity and cart independent while sharing repeated captures`, () => {
		const button = fixture()
		button.setAttribute(`data-resume-capture`, `["quantity","cart"]`)
		const otherButton = document.createElement(`button`)
		otherButton.setAttribute(`data-resume-capture`, `["cart","quantity"]`)
		document.body.append(otherButton)
		const { adapter, listeners } = testAdapter()
		const { scope, stats } = testScope(adapter)
		const [quantity, cart] = scope.capture(button)
		quantity.set(9)
		expect(cart.get()).toBe(11)
		expect(document.getElementById(`cart`)!.textContent).toBe(`11`)
		cart.set((value) => value + 1)
		expect(quantity.get()).toBe(9)
		expect(document.getElementById(`quantity`)!.textContent).toBe(`9`)
		expect(document.getElementById(`cart`)!.textContent).toBe(`12`)
		const recaptured = scope.capture(otherButton)
		expect(recaptured[0]).toBe(cart)
		expect(recaptured[1]).toBe(quantity)
		expect(adapter.create).toHaveBeenCalledTimes(2)
		expect(listeners.get(`quantity`)!.size).toBe(1)
		expect(listeners.get(`cart`)!.size).toBe(1)
		expect(stats).toEqual({
			cells: 2,
			bindings: 2,
			handlerCalls: 2,
			domWrites: 2,
		})
	})

	it(`isolates scope state and rejects elements owned by another document`, () => {
		const button = fixture()
		const otherDocument = document.implementation.createHTMLDocument(`other`)
		const otherButton = fixture(otherDocument)
		const firstAdapter = testAdapter()
		const secondAdapter = testAdapter()
		const first = testScope(firstAdapter.adapter)
		const second = testScope(secondAdapter.adapter, otherDocument)
		expect(() => first.scope.capture(otherButton)).toThrow(
			`wrong document owner`,
		)
		expect(() => second.scope.capture(button)).toThrow(`wrong document owner`)
		expect(firstAdapter.adapter.create).not.toHaveBeenCalled()
		expect(secondAdapter.adapter.create).not.toHaveBeenCalled()
		const [quantity] = first.scope.capture(button)
		const [otherQuantity] = second.scope.capture(otherButton)
		expect(quantity).not.toBe(otherQuantity)
		quantity.set(9)
		expect(otherQuantity.get()).toBe(7)
		expect(otherDocument.getElementById(`quantity`)!.textContent).toBe(`7`)
		otherQuantity.set(10)
		expect(quantity.get()).toBe(9)
		expect(document.getElementById(`quantity`)!.textContent).toBe(`9`)
		expect(otherDocument.getElementById(`quantity`)!.textContent).toBe(`10`)
		first.scope.dispose()
		otherQuantity.set(12)
		expect(otherQuantity.get()).toBe(12)
		expect(secondAdapter.adapter.dispose).not.toHaveBeenCalled()
	})

	it(`cleans up once and rejects captures and retained cells after disposal`, () => {
		const button = fixture()
		const { adapter, listeners, unsubscribes } = testAdapter()
		const { scope } = testScope(adapter)
		const [quantity] = scope.capture(button)
		scope.dispose()
		scope.dispose()
		expect(unsubscribes).toHaveLength(1)
		expect(unsubscribes[0]).toHaveBeenCalledTimes(1)
		expect(adapter.dispose).toHaveBeenCalledTimes(1)
		expect(listeners.get(`quantity`)!.size).toBe(0)
		expect(() => scope.capture(button)).toThrow(`disposed`)
		expect(() => quantity.get()).toThrow(`disposed`)
		expect(() => {
			quantity.set(9)
		}).toThrow(`disposed`)
		const update = vi.fn((value: number) => value + 1)
		expect(() => {
			quantity.set(update)
		}).toThrow(`disposed`)
		expect(update).not.toHaveBeenCalled()
		expect(document.getElementById(`quantity`)!.textContent).toBe(`7`)
		expect(adapter.create).toHaveBeenCalledTimes(1)
	})

	it(`attempts every cleanup after failure and suppresses late subscription writes`, () => {
		const button = fixture()
		button.setAttribute(`data-resume-capture`, `["quantity","cart"]`)
		const unsubscribeError = new Error(`unsubscribe failed`)
		const disposeError = new Error(`adapter disposal failed`)
		const cleanup = vi.fn((id: string) => {
			if (id === `quantity`) throw unsubscribeError
		})
		const { adapter, listeners, unsubscribes } = testAdapter(cleanup)
		adapter.dispose.mockImplementation(() => {
			throw disposeError
		})
		const { scope, stats } = testScope(adapter)
		const [quantity, cart] = scope.capture(button)
		const lateWrites = [...listeners.values()].flatMap((writes) => [...writes])
		const dispose = vi.fn(() => {
			scope.dispose()
		})
		expect(dispose).toThrow(AggregateError)
		const error = dispose.mock.results[0].value as AggregateError
		expect(error.errors).toEqual([unsubscribeError, disposeError])
		expect(error.message).toBe(`resume: cleanup failed`)
		expect(cleanup.mock.calls).toEqual([[`quantity`], [`cart`]])
		expect(unsubscribes).toHaveLength(2)
		for (const unsubscribe of unsubscribes)
			expect(unsubscribe).toHaveBeenCalledTimes(1)
		expect(adapter.dispose).toHaveBeenCalledTimes(1)
		expect(() => {
			scope.dispose()
		}).not.toThrow()
		for (const write of lateWrites) write(99)
		expect(document.getElementById(`quantity`)!.textContent).toBe(`7`)
		expect(document.getElementById(`cart`)!.textContent).toBe(`11`)
		expect(stats.domWrites).toBe(0)
		expect(() => scope.capture(button)).toThrow(`disposed`)
		expect(() => {
			quantity.set(9)
		}).toThrow(`disposed`)
		expect(() => cart.get()).toThrow(`disposed`)
		for (const unsubscribe of unsubscribes)
			expect(unsubscribe).toHaveBeenCalledTimes(1)
		expect(adapter.dispose).toHaveBeenCalledTimes(1)
	})

	it(`rejects a stale text target without allocating adapter state`, () => {
		const button = fixture()
		document.getElementById(`quantity`)!.textContent = `8`
		const { adapter, listeners } = testAdapter()
		const { scope, stats } = testScope(adapter)
		expect(() => scope.capture(button)).toThrow(`stale text target quantity`)
		expect(adapter.create).not.toHaveBeenCalled()
		expect(listeners.size).toBe(0)
		expect(stats).toEqual({
			cells: 0,
			bindings: 0,
			handlerCalls: 1,
			domWrites: 0,
		})
		expect(document.getElementById(`quantity`)!.textContent).toBe(`8`)
	})

	it(`does not harvest unrelated Astro producer seeds`, () => {
		const button = fixture()
		const payload = JSON.stringify({
			version: 1,
			values: [[`quantity`, [1, 99]]],
		})
		button.setAttribute(`data-resumability`, payload)
		const producer = document.createElement(`script`)
		producer.type = `application/json`
		producer.setAttribute(`data-resumability-page`, ``)
		producer.textContent = payload
		document.body.append(producer)
		const { adapter } = testAdapter()
		const { scope } = testScope(adapter)
		expect(scope.capture(button)[0].get()).toBe(7)
		expect(adapter.create).toHaveBeenCalledExactlyOnceWith(`quantity`, 7)
		document.getElementById(`resume-state-quantity`)!.remove()
		const secondAdapter = testAdapter()
		const second = testScope(secondAdapter.adapter)
		expect(() => second.scope.capture(button)).toThrow(`missing cell quantity`)
		expect(secondAdapter.adapter.create).not.toHaveBeenCalled()
		expect(button.getAttribute(`data-resumability`)).toBe(payload)
		expect(producer.textContent).toBe(payload)
	})
})
