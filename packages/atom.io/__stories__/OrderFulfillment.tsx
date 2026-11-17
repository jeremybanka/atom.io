import "@atom.io/spa-devtools/css"

import { StoreProvider } from "@atom.io/react"
import { AtomIODevtools } from "@atom.io/spa-devtools/react"
import { useEffect, useState } from "react"

import { createOrderFulfillmentScenario } from "./devtools-order-fulfillment.ts"
import css from "./OrderFulfillment.module.css"
import { OrderSummary } from "./OrderSummary.tsx"

/** Separate stores per story/reset; no global store or debugger preference mutation. */
export function OrderFulfillment(): React.JSX.Element {
	const [scenario, setScenario] = useState(createOrderFulfillmentScenario)
	useEffect(
		() => () => {
			scenario.dispose()
		},
		[scenario],
	)
	return (
		<order-fulfillment className={css.class} data-atom-io-theme="auto">
			<StoreProvider store={scenario.app.store}>
				<OrderSummary
					scenario={scenario}
					reset={() => {
						setScenario(createOrderFulfillmentScenario())
					}}
				/>
				<AtomIODevtools />
			</StoreProvider>
		</order-fulfillment>
	)
}
