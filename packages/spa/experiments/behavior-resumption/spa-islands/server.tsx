import { renderToString } from "@atom.io/spa/server"

import type { Props } from "../common.ts"
import { createApp } from "./app.tsx"

export function render(props: Props): string {
	const { store, Header, Card } = createApp(props)
	const header = renderToString(() => <Header />, {
		store,
		idPrefix: `bench-header`,
	})
	const cards = Array.from(
		{ length: props.count },
		(_, id) =>
			`<article data-island="${id}">${renderToString(() => <Card id={id} />, { store, idPrefix: `bench-card-${id}` })}</article>`,
	).join(``)
	return `<main><header>${header}</header>${props.below ? `<div class="spacer">Scroll for the collection</div>` : ``}<section id="catalog">${cards}</section></main>`
}
