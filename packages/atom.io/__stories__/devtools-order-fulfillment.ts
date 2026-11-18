import type {
	Loadable,
	ReadonlyPureSelectorFamilyToken,
	ReadonlyPureSelectorToken,
	RegularAtomFamilyToken,
	RegularAtomToken,
	TimelineToken,
} from "atom.io"
import { Silo } from "atom.io"
import { seekInStore } from "atom.io/internal"

export interface CatalogProduct {
	title: string
	priceCents: number
	tags: string[]
}
export type FulfillmentMode = `delivery` | `pickup`
export type QuoteStatus = `idle` | `pending` | `ready` | `error`
export interface OrderFulfillmentScenario {
	app: Silo
	skus: readonly string[]
	families: {
		products: RegularAtomFamilyToken<CatalogProduct, string>
		stock: RegularAtomFamilyToken<number, [string, string]>
		quantities: RegularAtomFamilyToken<number, string>
		lineTotals: ReadonlyPureSelectorFamilyToken<number, string>
		availability: ReadonlyPureSelectorFamilyToken<boolean, string>
		deliveryFees: RegularAtomFamilyToken<number, string>
		pickupFees: RegularAtomFamilyToken<number, string>
		quotes: RegularAtomFamilyToken<Loadable<number | Error>, string, Error>
	}
	state: {
		mode: RegularAtomToken<FulfillmentMode>
		warehouse: RegularAtomToken<string>
		region: RegularAtomToken<string>
		pickup: RegularAtomToken<string>
		cart: RegularAtomToken<string[]>
		coupon: RegularAtomToken<string | null>
		quoteStatus: RegularAtomToken<QuoteStatus>
	}
	derived: {
		subtotal: ReadonlyPureSelectorToken<number>
		fee: ReadonlyPureSelectorToken<number>
		total: ReadonlyPureSelectorToken<number>
		available: ReadonlyPureSelectorToken<number>
	}
	history: TimelineToken<any>
	actions: {
		fulfillment(mode: FulfillmentMode): void
		warehouse(name: string): void
		quantity(sku: string, amount: number): void
		coupon(code: string | null): void
		add(sku: string): void
		remove(sku: string): void
		requestQuote(): void
		resolveQuote(): void
		rejectQuote(): void
		undo(): void
		redo(): void
	}
	dormantReads(): number
	dispose(): void
}

/** A real application model. Only application reads establish observed dependencies. */
export function createOrderFulfillmentScenario(): OrderFulfillmentScenario {
	const app = new Silo({
		name: `order-fulfillment`,
		lifespan: `ephemeral`,
		isProduction: true,
	})
	let dormantReads = 0
	let pending: {
		resolve(value: number): void
		reject(error: Error): void
	} | null = null
	const skus = [
		`tea-green`,
		`coffee-decaf`,
		`mug-blue`,
		`tea-black`,
		`coffee-house`,
		`mug-red`,
		`tea-oolong`,
		...Array.from({ length: 17 }, (_, i) => `pantry-${i + 1}`),
	]
	const productBySkuAtoms = app.atomFamily<CatalogProduct, string>({
		key: `productBySku`,
		default: (sku) => ({ title: sku, priceCents: 500, tags: [`pantry`] }),
	})
	const stockByWarehouseSkuAtoms = app.atomFamily<number, [string, string]>({
		key: `stockByWarehouseSku`,
		default: 0,
	})
	const cartQuantityBySkuAtoms = app.atomFamily<number, string>({
		key: `cartQuantityBySku`,
		default: 1,
	})
	const deliveryFeeByRegionAtoms = app.atomFamily<number, string>({
		key: `deliveryFeeByRegion`,
		default: 0,
	})
	const pickupFeeByStoreAtoms = app.atomFamily<number, string>({
		key: `pickupFeeByStore`,
		default: 0,
	})
	const shippingQuoteByRegionAtoms = app.atomFamily<
		Loadable<number | Error>,
		string,
		Error
	>({
		key: `shippingQuoteByRegion`,
		default: 0,
		catch: [Error],
	})
	app.atomFamily<string, string>({ key: `wishlistNotesBySku`, default: `` })
	const fulfillmentModeAtom = app.atom<FulfillmentMode>({
		key: `fulfillmentMode`,
		default: `delivery`,
	})
	const selectedWarehouseAtom = app.atom<string>({
		key: `selectedWarehouse`,
		default: `north`,
	})
	const deliveryRegionAtom = app.atom<string>({
		key: `deliveryRegion`,
		default: `local`,
	})
	const pickupStoreAtom = app.atom<string>({
		key: `pickupStore`,
		default: `north`,
	})
	const cartSkuListAtom = app.atom<string[]>({
		key: `cartSkuList`,
		default: skus.slice(0, 6),
	})
	const couponAtom = app.atom<string | null>({ key: `coupon`, default: null })
	const quoteStatusAtom = app.atom<QuoteStatus>({
		key: `quoteStatus`,
		default: `idle`,
	})
	app.atom<{ name: string; preferences: { receipt: string } }>({
		key: `customer`,
		default: { name: `Alex`, preferences: { receipt: `email` } },
	})
	app.atom<boolean>({ key: `giftWrap`, default: false })
	// Keep a valid singleton key long enough to expose clipped editor actions.
	app.atom<string>({
		key: `descriptiveOrderFulfillmentNoteThatStaysDiscoverableInANarrowDebugger`,
		default: `Leave at reception`,
	})
	const lazyAuditDefaultAtoms = app.atomFamily<number, string>({
		key: `lazyAuditDefault`,
		default: () => {
			dormantReads++
			return 0
		},
	})
	// A deliberately unused application record, kept inside a collapsed family in live indexes.
	app.store.families.get(lazyAuditDefaultAtoms.key)!.create(`unused`)
	app.selector<number>({
		key: `seasonalPromotion`,
		get: () => {
			dormantReads++
			return 50
		},
	})
	for (const [index, sku] of skus.entries()) {
		app.setState(productBySkuAtoms, sku, {
			title: sku.replaceAll(`-`, ` `),
			priceCents: 500 + index * 25,
			tags: [`pantry`, index % 2 ? `gift` : `daily`],
		})
		app.setState(
			stockByWarehouseSkuAtoms,
			[`north`, sku],
			index % 3 === 0 ? 0 : 12,
		)
		app.setState(
			stockByWarehouseSkuAtoms,
			[`south`, sku],
			index % 3 === 0 ? 12 : 0,
		)
	}
	for (const key of [`local`, `distant`]) {
		app.setState(deliveryFeeByRegionAtoms, key, key === `local` ? 650 : 1250)
		app.setState(shippingQuoteByRegionAtoms, key, 0)
	}
	for (const key of [`north`, `south`])
		app.setState(pickupFeeByStoreAtoms, key, key === `north` ? 200 : 300)
	const lineTotalBySkuSelectors = app.selectorFamily<number, string>({
		key: `lineTotalBySku`,
		get:
			(sku) =>
			({ get }) =>
				get(productBySkuAtoms, sku).priceCents *
				get(cartQuantityBySkuAtoms, sku),
	})
	const availabilityBySkuSelectors = app.selectorFamily<boolean, string>({
		key: `availabilityBySku`,
		get:
			(sku) =>
			({ get }) =>
				get(stockByWarehouseSkuAtoms, [get(selectedWarehouseAtom), sku]) >=
				get(cartQuantityBySkuAtoms, sku),
	})
	for (const sku of skus.slice(0, 6)) {
		app.setState(cartQuantityBySkuAtoms, sku, 1)
		app.findState(lineTotalBySkuSelectors, sku)
		app.findState(availabilityBySkuSelectors, sku)
	}
	const subtotalCentsSelector = app.selector<number>({
		key: `subtotalCents`,
		get: ({ get }) =>
			get(cartSkuListAtom).reduce(
				(sum, sku) => sum + get(lineTotalBySkuSelectors, sku),
				0,
			),
	})
	const fulfillmentFeeCentsSelector = app.selector<number>({
		key: `fulfillmentFeeCents`,
		get: ({ get }) =>
			get(fulfillmentModeAtom) === `delivery`
				? get(deliveryFeeByRegionAtoms, get(deliveryRegionAtom))
				: get(pickupFeeByStoreAtoms, get(pickupStoreAtom)),
	})
	const discountCentsSelector = app.selector<number>({
		key: `discountCents`,
		get: ({ get }) =>
			get(couponAtom) === `PANTRY10`
				? Math.round(get(subtotalCentsSelector) / 10)
				: 0,
	})
	const checkoutTotalCentsSelector = app.selector<number>({
		key: `checkoutTotalCents`,
		get: ({ get }) =>
			get(subtotalCentsSelector) -
			get(discountCentsSelector) +
			get(fulfillmentFeeCentsSelector),
	})
	const availableLineCountSelector = app.selector<number>({
		key: `availableLineCount`,
		get: ({ get }) =>
			get(cartSkuListAtom).filter((sku) => get(availabilityBySkuSelectors, sku))
				.length,
	})
	const chooseFulfillmentTransaction = app.transaction<
		(next: FulfillmentMode) => void
	>({
		key: `chooseFulfillment`,
		do: ({ set }, next) => {
			set(fulfillmentModeAtom, next)
		},
	})
	const chooseWarehouseTransaction = app.transaction<(next: string) => void>({
		key: `chooseWarehouse`,
		do: ({ set }, next) => {
			set(selectedWarehouseAtom, next)
		},
	})
	const updateQuantityTransaction = app.transaction<
		(sku: string, amount: number) => void
	>({
		key: `updateQuantity`,
		do: ({ set }, sku, amount) => {
			set(cartQuantityBySkuAtoms, sku, Math.max(1, Math.floor(amount)))
		},
	})
	const applyCouponTransaction = app.transaction<(code: string | null) => void>({
		key: `applyCoupon`,
		do: ({ set }, code) => {
			set(couponAtom, code)
		},
	})
	const addCartLineTransaction = app.transaction<(sku: string) => void>({
		key: `addCartLine`,
		do: ({ get, set }, sku) => {
			if (!skus.includes(sku) || get(cartSkuListAtom).includes(sku)) return
			set(cartQuantityBySkuAtoms, sku, 1)
			set(cartSkuListAtom, [...get(cartSkuListAtom), sku])
		},
	})
	const removeCartLineTransaction = app.transaction<(sku: string) => void>({
		key: `removeCartLine`,
		do: ({ get, set, dispose }, sku) => {
			if (!get(cartSkuListAtom).includes(sku)) return
			set(
				cartSkuListAtom,
				get(cartSkuListAtom).filter((key) => key !== sku),
			)
			dispose(cartQuantityBySkuAtoms, sku)
		},
	})
	const cartHistoryTimeline = app.timeline({
		key: `cartHistory`,
		scope: [
			cartSkuListAtom,
			cartQuantityBySkuAtoms,
			fulfillmentModeAtom,
			selectedWarehouseAtom,
			couponAtom,
		],
	})
	return {
		app,
		skus,
		families: {
			products: productBySkuAtoms,
			stock: stockByWarehouseSkuAtoms,
			quantities: cartQuantityBySkuAtoms,
			lineTotals: lineTotalBySkuSelectors,
			availability: availabilityBySkuSelectors,
			deliveryFees: deliveryFeeByRegionAtoms,
			pickupFees: pickupFeeByStoreAtoms,
			quotes: shippingQuoteByRegionAtoms,
		},
		state: {
			mode: fulfillmentModeAtom,
			warehouse: selectedWarehouseAtom,
			region: deliveryRegionAtom,
			pickup: pickupStoreAtom,
			cart: cartSkuListAtom,
			coupon: couponAtom,
			quoteStatus: quoteStatusAtom,
		},
		derived: {
			subtotal: subtotalCentsSelector,
			fee: fulfillmentFeeCentsSelector,
			total: checkoutTotalCentsSelector,
			available: availableLineCountSelector,
		},
		history: cartHistoryTimeline,
		actions: {
			fulfillment: (next) => {
				app.runTransaction(chooseFulfillmentTransaction)(next)
			},
			warehouse: (next) => {
				app.runTransaction(chooseWarehouseTransaction)(next)
			},
			quantity: (sku, amount) => {
				app.runTransaction(updateQuantityTransaction)(sku, amount)
			},
			coupon: (code) => {
				app.runTransaction(applyCouponTransaction)(code)
			},
			add: (sku) => {
				app.runTransaction(addCartLineTransaction)(sku)
			},
			remove: (sku) => {
				const existed = app.getState(cartSkuListAtom).includes(sku)
				app.runTransaction(removeCartLineTransaction)(sku)
				if (existed) {
					const line = seekInStore(app.store, lineTotalBySkuSelectors, sku)
					const availability = seekInStore(
						app.store,
						availabilityBySkuSelectors,
						sku,
					)
					if (line) app.disposeState(line)
					if (availability) app.disposeState(availability)
				}
			},
			requestQuote: () => {
				pending?.resolve(0)
				const promise = new Promise<number>((resolve, reject) => {
					pending = { resolve, reject }
				})
				// Application-owned rejection handler; no unhandled rejection when the story resets.
				const response = promise.catch((error: Error) => error)
				app.setState(
					shippingQuoteByRegionAtoms,
					app.getState(deliveryRegionAtom),
					response,
				)
				app.setState(quoteStatusAtom, `pending`)
			},
			resolveQuote: () => {
				if (pending) {
					pending.resolve(650)
					pending = null
					app.setState(quoteStatusAtom, `ready`)
				}
			},
			rejectQuote: () => {
				if (pending) {
					pending.reject(new Error(`Carrier quote unavailable`))
					pending = null
					app.setState(quoteStatusAtom, `error`)
				}
			},
			undo: () => {
				app.undo(cartHistoryTimeline)
			},
			redo: () => {
				app.redo(cartHistoryTimeline)
			},
		},
		dormantReads: () => dormantReads,
		dispose: () => {
			pending?.resolve(0)
			pending = null
		},
	}
}
