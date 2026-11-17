import { useLoadable, useO } from "@atom.io/react"

import type { OrderFulfillmentScenario } from "./devtools-order-fulfillment.ts"
import css from "./OrderSummary.module.css"

/** The application summary consumes ordinary state; the debugger never primes these reads. */
export function OrderSummary({
	scenario,
}: {
	scenario: OrderFulfillmentScenario
}): React.JSX.Element {
	const { state, derived, families, actions } = scenario
	const mode = useO(state.mode)
	const warehouse = useO(state.warehouse)
	const cart = useO(state.cart)
	const region = useO(state.region)
	const total = useO(derived.total)
	const available = useO(derived.available)
	const quoteStatus = useO(state.quoteStatus)
	const quote = useLoadable(families.quotes, region, 0)
	return (
		<order-summary
			className={css.class}
			role="region"
			aria-label="Order fulfillment application"
		>
			<h2>Order fulfillment</h2>
			<p data-testid="order-summary">
				{cart.length} cart lines · {available} available · $
				{(total / 100).toFixed(2)} total · {mode} · {warehouse} warehouse
			</p>
			<action-row>
				<button
					type="button"
					onClick={() => {
						actions.fulfillment(mode === `delivery` ? `pickup` : `delivery`)
					}}
				>
					Use {mode === `delivery` ? `pickup` : `delivery`}
				</button>
				<button
					type="button"
					onClick={() => {
						actions.warehouse(warehouse === `north` ? `south` : `north`)
					}}
				>
					Use {warehouse === `north` ? `south` : `north`} warehouse
				</button>
				<button type="button" onClick={actions.addTea}>
					Add oolong tea
				</button>
				<button type="button" onClick={actions.removeTea}>
					Remove oolong tea
				</button>
				<button
					type="button"
					onClick={() => {
						actions.quantity(`tea-green`, 2)
					}}
				>
					Two green teas
				</button>
				<button
					type="button"
					onClick={() => {
						actions.coupon(`PANTRY10`)
					}}
				>
					Apply PANTRY10
				</button>
				<button type="button" onClick={actions.undo}>
					Undo cart
				</button>
				<button type="button" onClick={actions.redo}>
					Redo cart
				</button>
			</action-row>
			<p>
				Carrier quote:{` `}
				<output aria-label="Carrier quote status" data-status={quoteStatus}>
					{quoteStatus}
				</output>
				{` `}
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
			</action-row>
			<p>
				Open ecology, select checkoutTotalCents and trace its observed roots.
				After switching fulfillment or warehouse, use Refresh and trace again.
				The app summary establishes the real dependencies.
			</p>
			<p>
				Quotes have application-owned pending/error states. Passive ecology
				reports cached types or unknown, not inferred promise outcomes. Open
				Transactions before running actions to begin recording outcomes.
			</p>
			<p>
				Catalog: {scenario.skus.length} products, two warehouses, six initial
				cart lines. The seasonal promotion and lazy audit remain unconsumed; the
				wishlist family starts empty.
			</p>
		</order-summary>
	)
}
