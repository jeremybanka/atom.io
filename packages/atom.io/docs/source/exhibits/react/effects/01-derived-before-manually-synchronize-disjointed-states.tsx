import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { type Product, sampleProducts } from "./services.ts"
import { SearchForm } from "./views.tsx"

export default function ProductSearch({
	products = sampleProducts,
}: {
	products?: Product[]
}): ReactNode {
	const [query, setQuery] = useState(``)
	const [matches, setMatches] = useState<Product[]>([])
	useEffect(() => {
		setMatches(products.filter((product) => product.name.includes(query)))
	}, [products, query])
	return <SearchForm query={query} onChange={setQuery} results={matches} />
}
