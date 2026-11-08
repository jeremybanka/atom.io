import type { SpaElement } from "@atom.io/spa"
import { useLoadable } from "@atom.io/spa"
import { atom, type Loadable } from "atom.io"

import { title } from "./data.ts"

const ordinaryAtom = atom<Loadable<string>>({
	key: `ordinary`,
	default: () =>
		new Promise((resolve) =>
			setTimeout(() => {
				resolve(`Async value`)
			}, 100),
		),
})
const titleAtom = atom<Loadable<string>>({ key: `title`, default: title })

export function Ordinary(): SpaElement {
	const value = useLoadable(ordinaryAtom, `Loading`)
	return <output data-ordinary>{value().value}</output>
}

export function Mixed(): SpaElement {
	const value = useLoadable(ordinaryAtom, `Loading`)
	const heading = useLoadable(titleAtom, ``)
	return (
		<section>
			<h1 data-seeded>{heading().value}</h1>
			<output data-mixed>{value().value}</output>
		</section>
	)
}
