import { component$, type Signal, useSignal } from "@builder.io/qwik"

import { initial, label, type Props, setupCount } from "../../common.ts"

export const Card = component$(
	(p: { id: number; work: number; title?: string; cart: Signal<number> }) => {
		setupCount()
		const id = p.id
		const cart = p.cart
		const quantity = useSignal(initial(id))
		const title = p.title ?? label(id, p.work)
		return (
			<article>
				<h2>{title}</h2>
				<p>Thoughtfully made. Ships free.</p>
				<button
					data-product={id}
					onClick$={() => {
						quantity.value++
						cart.value++
					}}
				>
					Add to bag: <span data-quantity={id}>{quantity.value}</span>
				</button>
			</article>
		)
	},
)
export const App = component$((props: Props) => {
	setupCount()
	const cart = useSignal(0)
	return (
		<main>
			<header>
				<h1>Small Things Store</h1>
				<p>Useful everyday objects, made to last.</p>
				<p>
					Bag: <strong id="cart">{cart.value}</strong>
				</p>
			</header>
			{props.below ? <div class="spacer">Scroll for the collection</div> : null}
			<section id="catalog">
				{Array.from({ length: props.count }, (_, id) => (
					<Card
						key={id}
						id={id}
						work={props.work}
						title={props.precomputed ? props.labels![id] : undefined}
						cart={cart}
					/>
				))}
			</section>
		</main>
	)
})
