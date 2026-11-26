/** @jsxImportSource @atom.io/spa */
import type { SpaElement } from "@atom.io/spa"
import { useGetter } from "@atom.io/spa"
import type { TransactionToken } from "atom.io"
import { isReservedIntrospectionKey } from "atom.io/internal"

import { type Tools, useExpanded } from "./store.ts"
import css from "./TransactionIndex.module.css"
import { TransactionOutcomes } from "./TransactionOutcomes.tsx"

export function TransactionIndex(props: { tools: Tools }): SpaElement {
	const getTransactionIndex = useGetter(props.tools.transactionIndex)
	const visible = () =>
		getTransactionIndex().filter(
			(token) => !isReservedIntrospectionKey(token.key),
		)
	return (
		<transaction-index class={css.class}>
			<article data-index data-testid="transaction-index">
				{visible().length === 0 ? (
					<p>(no transactions)</p>
				) : (
					visible().map((token) => (
						<TransactionLog key={token.key} tools={props.tools} token={token} />
					))
				)}
			</article>
		</transaction-index>
	)
}
function TransactionLog(props: {
	tools: Tools
	token: TransactionToken<any>
}): SpaElement {
	const getTransactionLog = props.tools.history.useTransaction(props.token.key)
	const [getOpen, toggle] = useExpanded(props.tools, [props.token.key])
	return (
		<transaction-log data-testid={`transaction-${props.token.key}`}>
			<node-heading>
				<button
					type="button"
					aria-expanded={getOpen()}
					data-testid={`open-close-transaction-${props.token.key}`}
					onClick={toggle}
				>
					{getOpen() ? `▾` : `▸`}
				</button>
				<h2 title={props.token.key}>{props.token.key}</h2>
				<small>transaction</small>
				<small data-count>({getTransactionLog().length})</small>
			</node-heading>
			{getOpen() ? (
				<TransactionOutcomes tools={props.tools} history={getTransactionLog()} />
			) : null}
		</transaction-log>
	)
}
