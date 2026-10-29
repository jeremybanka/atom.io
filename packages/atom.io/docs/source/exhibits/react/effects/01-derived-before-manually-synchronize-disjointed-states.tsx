import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import type { Product } from "./services.ts"
import { SearchForm } from "./views.tsx"

export function ProductSearch({ products }: { products: Product[] }): ReactNode {
	const [query, setQuery] = useState(``)
	const [matches, setMatches] = useState<Product[]>([])
	useEffect(() => {
		setMatches(products.filter((product) => product.name.includes(query)))
	}, [products, query])
	return <SearchForm query={query} onChange={setQuery} results={matches} />
}
