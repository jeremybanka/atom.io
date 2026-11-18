import { useO } from "@atom.io/react"

import css from "./CatalogItem.module.css"
import type { OrderFulfillmentScenario } from "./devtools-order-fulfillment.ts"

export function CatalogItem({
	scenario,
	sku,
	inCart,
	warehouse,
}: {
	scenario: OrderFulfillmentScenario
	sku: string
	inCart: boolean
	warehouse: string
}): React.JSX.Element {
	const product = useO(scenario.families.products, sku)
	const stock = useO(scenario.families.stock, [warehouse, sku])
	return (
		<catalog-item className={css.class} role="listitem">
			<p>{product.tags.join(` / `)}</p>
			<h3>{product.title}</h3>
			<strong>${(product.priceCents / 100).toFixed(2)}</strong>
			<p>
				{stock > 0 ? `${stock} in ${warehouse}` : `Out of stock in ${warehouse}`}
			</p>
			<button
				type="button"
				disabled={inCart || stock <= 0}
				onClick={() => {
					scenario.actions.add(sku)
				}}
				aria-label={`Add ${product.title}`}
			>
				{inCart ? `In your cart` : `Add to cart`}
			</button>
		</catalog-item>
	)
}
