import type { VNode } from "@atom.io/spa"
import { useGetter, useId, useLoadable, useSetter, useStore } from "@atom.io/spa"
import { resetInStore } from "atom.io/internal"

import { api, type Product } from "./api.ts"
import { productAtoms, productIds, saveStatusAtoms } from "./state.ts"

function StockCard(props: { id: number }): VNode {
	const store = useStore()
	const label = useId()
	const fallback: Product = {
		id: props.id,
		sku: ``,
		name: `Loading product…`,
		stock: 0,
		revision: 1,
	}
	const product = useLoadable(productAtoms, props.id, fallback)
	const setProduct = useSetter(productAtoms, props.id)
	const status = useGetter(saveStatusAtoms, props.id)
	const setStatus = useSetter(saveStatusAtoms, props.id)
	async function save(): Promise<void> {
		if (status().saving || product().loading || product().error) return
		setStatus({ saving: true, message: `` })
		try {
			const { id, stock, revision } = product().value
			const saved = await api.inventory.setStock.mutate({ id, stock, revision })
			setProduct(saved)
			setStatus({ saving: false, message: `Stock saved` })
		} catch (error) {
			setStatus({
				saving: false,
				message: error instanceof Error ? error.message : `Could not save stock`,
			})
		}
	}
	return (
		<article
			class="product"
			data-product={props.id}
			aria-busy={product().loading || status().saving}
		>
			<header>
				<div>
					<p class="sku">{product().value.sku}</p>
					<h3>{product().value.name}</h3>
				</div>
				<span class="source">
					{product().loading
						? `Loading…`
						: product().value.stock > 0
							? `In stock`
							: `Out of stock`}
				</span>
			</header>
			<label for={label}>Units on hand</label>
			<input
				id={label}
				type="number"
				min="0"
				step="1"
				value={product().value.stock}
				disabled={product().loading || status().saving || !!product().error}
				onInput={(event) => {
					const stock = event.currentTarget.valueAsNumber
					if (Number.isSafeInteger(stock) && stock >= 0) {
						setProduct({ ...product().value, stock })
						setStatus({ saving: false, message: `Unsaved count` })
					}
				}}
			/>
			<p class="preview" data-preview>
				{product().value.stock} units available
			</p>
			<p role="status">{product().error?.message ?? status().message}</p>
			<footer>
				<button
					disabled={status().saving || product().loading || !!product().error}
					onClick={save}
				>
					{status().saving ? `Saving…` : `Save stock`}
				</button>
				<button
					class="secondary"
					disabled={status().saving || product().loading}
					onClick={() => {
						setStatus({ saving: false, message: `` })
						resetInStore(store, productAtoms, props.id)
					}}
				>
					Reload from database
				</button>
				<output data-revision>{product().value.revision}</output>
			</footer>
		</article>
	)
}

export default function Inventory(props: { id: string }): VNode {
	return (
		<div class="product-grid" data-island={props.id}>
			{productIds.map((id) => (
				<StockCard key={id} id={id} />
			))}
		</div>
	)
}
