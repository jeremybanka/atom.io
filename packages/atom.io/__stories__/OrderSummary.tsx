import { useLoadable, useO } from "@atom.io/react"

import { CartLine } from "./CartLine.tsx"
import { CatalogItem } from "./CatalogItem.tsx"
import type { OrderFulfillmentScenario } from "./devtools-order-fulfillment.ts"
import css from "./OrderSummary.module.css"

/** Ordinary application reads establish the dependencies that the debugger observes. */
export function OrderSummary({
	scenario,
	reset,
}: {
	scenario: OrderFulfillmentScenario
	reset(): void
}): React.JSX.Element {
	const { state, derived, actions, families } = scenario
	const mode = useO(state.mode),
		warehouse = useO(state.warehouse)
	const cart = useO(state.cart),
		region = useO(state.region)
	const total = useO(derived.total),
		subtotal = useO(derived.subtotal)
	const fee = useO(derived.fee),
		available = useO(derived.available)
	const coupon = useO(state.coupon),
		quoteStatus = useO(state.quoteStatus)
	const quote = useLoadable(families.quotes, region, 0)
	return (
		<order-summary
			className={css.class}
			role="region"
			aria-label="Order fulfillment application"
		>
			<store-intro>
				<p>THE CORNER PANTRY</p>
				<h1>A little everyday good.</h1>
				<p>Tea, coffee and things worth keeping. Pack a cart from the pantry.</p>
			</store-intro>
			<section aria-label="Fulfillment options">
				<h2>Make it yours</h2>
				<fieldset>
					<legend>Fulfillment</legend>
					<button
						type="button"
						aria-pressed={mode === `delivery`}
						onClick={() => {
							actions.fulfillment(`delivery`)
						}}
					>
						Use delivery
					</button>
					<button
						type="button"
						aria-pressed={mode === `pickup`}
						onClick={() => {
							actions.fulfillment(`pickup`)
						}}
					>
						Use pickup
					</button>
				</fieldset>
				<p>
					{mode === `delivery`
						? `Delivery to ${region} · $${(fee / 100).toFixed(2)} fee`
						: `Pickup at north store · $${(fee / 100).toFixed(2)} fee`}
				</p>
				<fieldset>
					<legend>Stock warehouse</legend>
					{[`north`, `south`].map((name) => (
						<button
							key={name}
							type="button"
							aria-pressed={warehouse === name}
							onClick={() => {
								actions.warehouse(name)
							}}
						>
							Use {name} warehouse
						</button>
					))}
				</fieldset>
				<p>
					Availability uses {warehouse} stock and the quantity in your cart.
					Unavailable lines stay in the cart so you can try another warehouse.
				</p>
			</section>
			<section aria-label="Your cart">
				<h2>
					Your cart <span>{cart.length} lines</span>
				</h2>
				<ul>
					{cart.map((sku) => (
						<CartLine key={sku} scenario={scenario} sku={sku} />
					))}
				</ul>
				{cart.length === 0 && (
					<p>Your cart is empty. Find something in the catalog below.</p>
				)}
				<dl>
					<dt>Subtotal</dt>
					<dd>${(subtotal / 100).toFixed(2)}</dd>
					<dt>{mode === `delivery` ? `Delivery` : `Pickup`}</dt>
					<dd>${(fee / 100).toFixed(2)}</dd>
					<dt>Discount {coupon === `PANTRY10` ? `· PANTRY10` : ``}</dt>
					<dd>−${((subtotal + fee - total) / 100).toFixed(2)}</dd>
					<dt>Total</dt>
					<dd aria-label="Order total">${(total / 100).toFixed(2)}</dd>
				</dl>
				<button
					type="button"
					onClick={() => {
						actions.coupon(coupon === `PANTRY10` ? null : `PANTRY10`)
					}}
				>
					{coupon === `PANTRY10` ? `Remove PANTRY10` : `Apply PANTRY10`}
				</button>
				<action-row>
					<button type="button" onClick={actions.undo}>
						Undo cart
					</button>
					<button type="button" onClick={actions.redo}>
						Redo cart
					</button>
				</action-row>
				<p role="status" data-testid="order-summary">
					{cart.length} cart lines · {available} available · $
					{(total / 100).toFixed(2)} total · {mode} · {warehouse} warehouse
				</p>
			</section>
			<section aria-label="Pantry catalog">
				<h2>
					On the shelves <span>{scenario.skus.length} products</span>
				</h2>
				<ul>
					{scenario.skus.map((sku) => (
						<CatalogItem
							key={sku}
							scenario={scenario}
							sku={sku}
							inCart={cart.includes(sku)}
							warehouse={warehouse}
						/>
					))}
				</ul>
			</section>
			<details>
				<summary>Scenario controls</summary>
				<p>
					Try a carrier response. Quotes are separate from the fulfillment fee
					above; no order is placed.
				</p>
				<p>
					Carrier quote:{` `}
					<output aria-label="Carrier quote status" data-status={quoteStatus}>
						{quoteStatus}
					</output>
					{` · `}
					{quote.error
						? `Carrier quote unavailable`
						: quote.loading
							? `waiting for carrier`
							: typeof quote.value === `number`
								? `$${(quote.value / 100).toFixed(2)}`
								: `Carrier quote unavailable`}
				</p>
				<action-row>
					<button type="button" onClick={actions.requestQuote}>
						Request quote
					</button>
					<button
						type="button"
						disabled={quoteStatus !== `pending`}
						onClick={actions.resolveQuote}
					>
						Resolve quote
					</button>
					<button
						type="button"
						disabled={quoteStatus !== `pending`}
						onClick={actions.rejectQuote}
					>
						Reject quote
					</button>
					<button type="button" onClick={reset}>
						Reset order scenario
					</button>
				</action-row>
				<p>
					Close Pantry storefront to inspect the same application. Hide the
					debugger with its × button or Ctrl+Shift+A to browse again. In ecology,
					select checkoutTotalCents and trace its observed roots. After changing
					fulfillment or warehouse, Refresh and trace again. The storefront
					establishes dependencies through real reads; passive inspection leaves
					seasonalPromotion, lazyAuditDefault and the empty wishlist untouched.
				</p>
				<p>
					Open Transactions before running actions to record outcomes. Quote
					pending/error states belong to the app; ecology reports cached types or
					unknown.
				</p>
			</details>
		</order-summary>
	)
}
