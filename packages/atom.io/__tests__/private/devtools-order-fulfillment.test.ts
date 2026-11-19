import { deposit } from "atom.io/internal"

import {
	captureEcologySnapshot,
	traceEcologyRoots,
} from "../../../spa-devtools/src/ecology.ts"
import { createOrderFulfillmentScenario } from "../../__stories__/devtools-order-fulfillment.ts"

describe(`order fulfillment application`, () => {
	test(`every catalog SKU uses the same cart transactions, disposal and timeline`, () => {
		const model = createOrderFulfillmentScenario()
		const { app, actions, state, families } = model
		actions.add(`not-in-catalog`)
		actions.add(`tea-green`)
		expect(app.getState(state.cart)).toHaveLength(6)
		actions.add(`pantry-2`)
		expect(app.getState(model.derived.total)).toBe(4725)
		actions.quantity(`pantry-2`, 2)
		expect(app.getState(families.lineTotals, `pantry-2`)).toBe(1400)
		actions.remove(`pantry-2`)
		expect(app.getState(state.cart)).not.toContain(`pantry-2`)
		expect(app.store.atoms.has(`cartQuantityBySku("pantry-2")`)).toBe(false)
		actions.undo()
		expect(app.getState(families.quantities, `pantry-2`)).toBe(2)
		expect(app.getState(model.derived.total)).toBe(5425)
		actions.redo()
		expect(app.getState(model.derived.total)).toBe(4025)
		for (const sku of [...app.getState(state.cart)]) actions.remove(sku)
		expect(app.getState(model.derived.subtotal)).toBe(0)
		expect(app.getState(model.derived.available)).toBe(0)
		expect(model.dormantReads()).toBe(0)
		model.dispose()
	})

	test(`real app reads establish conditional roots and exact instantiated families`, () => {
		const model = createOrderFulfillmentScenario()
		const { app, derived, actions, families } = model
		const stopTotal = app.subscribe(derived.total, () => {})
		const stopAvailability = app.subscribe(derived.available, () => {})
		try {
			expect(app.getState(derived.total)).toBe(4025)
			expect(app.getState(derived.available)).toBe(4)
			const snapshot = () => captureEcologySnapshot(app.store)
			const roots = (key: string) => traceEcologyRoots(snapshot(), key).rootKeys
			const counts = new Map(
				snapshot().families.map((f) => [f.key, f.memberCount]),
			)
			expect(Object.fromEntries(counts)).toMatchObject({
				productBySku: 24,
				stockByWarehouseSku: 48,
				cartQuantityBySku: 6,
				lineTotalBySku: 6,
				availabilityBySku: 6,
				deliveryFeeByRegion: 2,
				pickupFeeByStore: 2,
				shippingQuoteByRegion: 2,
				wishlistNotesBySku: 0,
			})
			const delivery = roots(derived.total.key)
			expect(delivery).toContain(`deliveryRegion`)
			expect(delivery).toContain(`deliveryFeeByRegion("local")`)
			expect(delivery).not.toContain(`pickupStore`)
			for (let i = 0; i < 3; i++) {
				actions.fulfillment(`pickup`)
				expect(app.getState(derived.total)).toBe(3575)
				const pickup = roots(derived.total.key)
				expect(pickup).toContain(`pickupStore`)
				expect(pickup).toContain(`pickupFeeByStore("north")`)
				expect(pickup).not.toContain(`deliveryRegion`)
				actions.fulfillment(`delivery`)
				app.getState(derived.total)
				expect(roots(derived.total.key)).toEqual(delivery)
			}
			actions.warehouse(`south`)
			expect(app.getState(derived.available)).toBe(2)
			const availability = roots(derived.available.key)
			expect(availability).toContain(
				`stockByWarehouseSku(["south","tea-green"])`,
			)
			expect(availability).not.toContain(
				`stockByWarehouseSku(["north","tea-green"])`,
			)
			actions.add(`tea-oolong`)
			app.getState(derived.total)
			app.getState(derived.available)
			expect(
				snapshot().families.find((f) => f.key === families.quantities.key)
					?.memberCount,
			).toBe(7)
			actions.add(`tea-oolong`)
			expect(app.getState(model.state.cart)).toHaveLength(7)
			actions.remove(`tea-oolong`)
			app.getState(derived.total)
			app.getState(derived.available)
			expect(
				snapshot().families.find((f) => f.key === families.quantities.key)
					?.memberCount,
			).toBe(6)
			expect(
				snapshot().nodes.some((n) => n.key === `lineTotalBySku("tea-oolong")`),
			).toBe(false)
			actions.undo()
			expect(app.getState(model.state.cart)).toContain(`tea-oolong`)
			app.getState(derived.total)
			actions.redo()
			expect(app.getState(model.state.cart)).not.toContain(`tea-oolong`)
			app.getState(derived.total)
			actions.remove(`tea-oolong`)
			expect(model.dormantReads()).toBe(0)
		} finally {
			stopTotal()
			stopAvailability()
			model.dispose()
		}
	})

	test(`passive snapshots and root tracing leave caches, graphs, dormant defaults and members unchanged`, () => {
		const model = createOrderFulfillmentScenario()
		const { app } = model
		const evidence = () => ({
			values: [...app.store.valueMap],
			graph: app.store.selectorGraph.toJSON(),
			atoms: [...app.store.atoms.keys()],
			selectors: [...app.store.readonlySelectors.keys()],
		})
		const before = evidence()
		for (let i = 0; i < 10; i++) {
			const snapshot = captureEcologySnapshot(app.store)
			traceEcologyRoots(snapshot, `seasonalPromotion`)
			expect(
				snapshot.nodes.find((n) => n.key === `seasonalPromotion`)?.value.status,
			).toBe(`unknown`)
		}
		expect(evidence()).toEqual(before)
		expect(model.dormantReads()).toBe(0)
		// Deliberate application reads are different from passive inspection.
		expect(
			app.getState(deposit(app.store.atoms.get(`lazyAuditDefault("unused")`)!)),
		).toBe(0)
		expect(
			app.getState(
				deposit(app.store.readonlySelectors.get(`seasonalPromotion`)!),
			),
		).toBe(50)
		expect(model.dormantReads()).toBe(2)
		expect(app.getState(model.families.products, `new-product`)).toMatchObject({
			priceCents: 500,
		})
		model.dispose()
	})

	test(`committed transactions, undo/redo and stores remain real and isolated`, () => {
		const first = createOrderFulfillmentScenario(),
			second = createOrderFulfillmentScenario()
		first.actions.quantity(`tea-green`, 2)
		expect(first.app.getState(first.derived.subtotal)).toBe(3875)
		expect(second.app.getState(second.derived.subtotal)).toBe(3375)
		first.actions.coupon(`PANTRY10`)
		expect(first.app.getState(first.derived.total)).toBe(4137)
		first.actions.undo()
		expect(first.app.getState(first.state.coupon)).toBeNull()
		first.actions.redo()
		expect(first.app.getState(first.state.coupon)).toBe(`PANTRY10`)
		expect(first.app.inspectTimeline(first.history).length).toBeGreaterThan(0)
		first.dispose()
		second.dispose()
	})

	test(`controlled async quote settles, fails and cancels without an external service`, async () => {
		const model = createOrderFulfillmentScenario()
		const { app, families, actions, state } = model
		expect(app.getState(families.quotes, `local`)).toBeNull()
		actions.resolveQuote()
		actions.rejectQuote()
		actions.requestQuote()
		const pending = app.getState(families.quotes, `local`)
		expect(pending).toBeInstanceOf(Promise)
		actions.resolveQuote()
		await expect(pending).resolves.toBe(650)
		expect(app.getState(families.quotes, `local`)).toBe(650)
		actions.requestQuote()
		const rejected = app.getState(families.quotes, `local`)
		actions.rejectQuote()
		await expect(rejected).resolves.toEqual(
			new Error(`Carrier quote unavailable`),
		)
		expect(app.getState(families.quotes, `local`)).toEqual(
			new Error(`Carrier quote unavailable`),
		)
		actions.requestQuote()
		const superseded = app.getState(families.quotes, `local`)
		actions.requestQuote()
		expect(app.getState(families.quotes, `local`)).toBe(superseded)

		app.setState(state.region, `distant`)
		expect(app.getState(families.quotes, `distant`)).toBeNull()
		actions.requestQuote()
		const distant = app.getState(families.quotes, `distant`)
		actions.resolveQuote()
		await expect(distant).resolves.toBe(650)
		expect(app.getState(families.quotes, `local`)).toBe(superseded)

		model.dispose()
		model.dispose()
		await expect(superseded).resolves.toBeNull()
	})
})
