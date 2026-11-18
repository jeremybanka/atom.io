import { useO } from "@atom.io/react"

import css from "./CartLine.module.css"
import type { OrderFulfillmentScenario } from "./devtools-order-fulfillment.ts"

export function CartLine({
	scenario,
	sku,
}: {
	scenario: OrderFulfillmentScenario
	sku: string
}): React.JSX.Element {
	const product = useO(scenario.families.products, sku)
	const quantity = useO(scenario.families.quantities, sku)
	const total = useO(scenario.families.lineTotals, sku)
	const available = useO(scenario.families.availability, sku)
	return (
		<cart-line className={css.class} role="listitem" aria-label={product.title}>
			<line-heading>
				<h3>{product.title}</h3>
				<strong aria-label={`${product.title} line total`}>
					${(total / 100).toFixed(2)}
				</strong>
			</line-heading>
			<p>
				${(product.priceCents / 100).toFixed(2)} each ·{` `}
				<span data-available={available}>
					{available ? `Available` : `Unavailable at this quantity`}
				</span>
			</p>
			<action-row>
				<button
					type="button"
					disabled={quantity <= 1}
					aria-label={`Decrease ${product.title}`}
					onClick={() => {
						scenario.actions.quantity(sku, quantity - 1)
					}}
				>
					−
				</button>
				<output aria-label={`${product.title} quantity`}>{quantity}</output>
				<button
					type="button"
					aria-label={`Increase ${product.title}`}
					onClick={() => {
						scenario.actions.quantity(sku, quantity + 1)
					}}
				>
					+
				</button>
				<button
					type="button"
					onClick={() => {
						scenario.actions.remove(sku)
					}}
					aria-label={`Remove ${product.title}`}
				>
					Remove
				</button>
			</action-row>
		</cart-line>
	)
}
