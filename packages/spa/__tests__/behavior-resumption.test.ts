import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
	readCapture,
	readSnapshot,
	validateId,
} from "../experiments/behavior-resumption/host/schema.ts"

beforeEach(() => {
	vi.resetModules()
	document.body.replaceChildren()
})

afterEach(() => {
	pagehide(false)
})

function pagehide(persisted: boolean): void {
	const event = new Event(`pagehide`)
	Object.defineProperty(event, `persisted`, { value: persisted })
	window.dispatchEvent(event)
}

function fixture(): HTMLButtonElement {
	document.body.innerHTML = `<button type="button" data-resume-capture='["quantity","cart"]'>Add</button>
		<span id="quantity"><!--start-->7<!--end--></span><strong id="cart">11</strong>
		<script type="application/json" id="resume-state-quantity">{"version":1,"value":7,"text":["quantity"]}</script>
		<script type="application/json" id="resume-state-cart">{"version":1,"value":11,"text":["cart"]}</script>`
	return document.querySelector(`button`)!
}

describe(`experimental behavior resumption`, () => {
	it(`retains state for persisted pagehide and disposes on final departure`, async () => {
		const button = fixture()
		const { capture } = await import(
			`../experiments/behavior-resumption/spike/runtime.ts`
		)
		const [quantity] = capture(button)
		quantity.set(8)
		pagehide(true)
		expect(capture(button)[0]).toBe(quantity)
		expect(quantity.get()).toBe(8)
		quantity.set((value) => value + 1)
		expect(document.querySelector(`#quantity`)!.textContent).toBe(`9`)
		expect(window.__resumeStats?.cells).toBe(2)
		pagehide(false)
		expect(() => capture(button)).toThrow(`disposed`)
		expect(() => quantity.get()).toThrow(`disposed`)
		expect(() => {
			quantity.set(10)
		}).toThrow(`disposed`)
		const update = vi.fn((value: number) => value + 1)
		expect(() => {
			quantity.set(update)
		}).toThrow(`disposed`)
		expect(update).not.toHaveBeenCalled()
		expect(document.querySelector(`#quantity`)!.textContent).toBe(`9`)
	})

	it(`does no state or DOM setup until capture, then preserves exact nodes`, async () => {
		const button = fixture()
		const nodes = Array.from(document.querySelector(`#quantity`)!.childNodes)
		const { capture } = await import(
			`../experiments/behavior-resumption/spike/runtime.ts`
		)
		expect(window.__resumeStats?.cells).toBe(0)
		const [quantity, cart] = capture(button)
		expect(quantity.get()).toBe(7)
		expect(cart.get()).toBe(11)
		quantity.set((value) => value + 1)
		cart.set((value) => value + 1)
		expect(document.querySelector(`#quantity`)!.textContent).toBe(`8`)
		expect(document.querySelector(`#cart`)!.textContent).toBe(`12`)
		Array.from(document.querySelector(`#quantity`)!.childNodes).forEach(
			(node, index) => {
				expect(node).toBe(nodes[index])
			},
		)
		expect(capture(button)[0]).toBe(quantity)
		expect(window.__resumeStats?.cells).toBe(2)
	})

	it.each([NaN, Infinity, -Infinity])(
		`rejects non-finite writes (%s) without state or text mutation`,
		async (value) => {
			const button = fixture()
			const { capture } = await import(
				`../experiments/behavior-resumption/spike/runtime.ts`
			)
			const [quantity] = capture(button)
			expect(() => {
				quantity.set(value)
			}).toThrow(`finite number`)
			const update = vi.fn(() => value)
			expect(() => {
				quantity.set(update)
			}).toThrow(`finite number`)
			expect(update).toHaveBeenCalledTimes(1)
			expect(quantity.get()).toBe(7)
			expect(document.querySelector(`#quantity`)!.textContent).toBe(`7`)
		},
	)

	it(`supports multiple direct text bindings and skips detached nodes`, async () => {
		const button = fixture()
		const mirror = document.createElement(`span`)
		mirror.id = `mirror`
		mirror.textContent = `7`
		document.body.append(mirror)
		document.querySelector(`#resume-state-quantity`)!.textContent =
			JSON.stringify({ version: 1, value: 7, text: [`quantity`, `mirror`] })
		const { capture } = await import(
			`../experiments/behavior-resumption/spike/runtime.ts`
		)
		const [quantity] = capture(button)
		quantity.set(-0.5)
		expect(mirror.textContent).toBe(`-0.5`)
		expect(document.querySelector(`#quantity`)!.textContent).toBe(`-0.5`)
		mirror.remove()
		quantity.set(9)
		expect(mirror.textContent).toBe(`-0.5`)
	})

	it.each([`stale`, `child`, `missing-second`])(
		`rejects %s targets before the handler mutates either value`,
		async (mode) => {
			const button = fixture()
			if (mode === `stale`)
				document.querySelector(`#quantity`)!.textContent = `8`
			if (mode === `child`)
				document.querySelector(`#quantity`)!.innerHTML = `<span>7</span>`
			if (mode === `missing-second`)
				document.querySelector(`#resume-state-cart`)!.remove()
			const { addToBag } = await import(
				`../experiments/behavior-resumption/spike/cart.ts`
			)
			expect(() => {
				addToBag(button)
			}).toThrow()
			expect(document.querySelector(`#cart`)!.textContent).toBe(`11`)
			expect(window.__resumeStats?.domWrites).toBe(0)
		},
	)
})

describe(`experimental wire boundaries`, () => {
	it(`accepts finite fractions and boundary-length references`, () => {
		expect(
			readSnapshot(JSON.stringify({ version: 1, value: -1.5, text: [`cart`] }))
				.value,
		).toBe(-1.5)
		expect(() => {
			validateId(`a`.repeat(64))
		}).not.toThrow()
		expect(() => {
			validateId(`a`.repeat(65))
		}).toThrow()
	})
	it(`limits records and captures to sixteen references`, () => {
		for (const length of [16, 17]) {
			const references = Array.from({ length }, (_, index) => `q${index}`)
			const capture = () => readCapture(JSON.stringify(references))
			const snapshot = () =>
				readSnapshot(JSON.stringify({ version: 1, value: 0, text: references }))
			if (length === 16) {
				expect(capture).not.toThrow()
				expect(snapshot).not.toThrow()
			} else {
				expect(capture).toThrow()
				expect(snapshot).toThrow()
			}
		}
	})
	it(`rejects malformed JSON`, () => {
		expect(() => readCapture(`[`)).toThrow()
		expect(() => readSnapshot(`{`)).toThrow()
	})
})
