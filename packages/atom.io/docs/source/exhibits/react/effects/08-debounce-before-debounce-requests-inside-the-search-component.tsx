import type { ReactNode } from "react"
import { useEffect, useState } from "react"

import { type Product, searchProducts } from "./services.ts"
import { SearchForm } from "./views.tsx"

export function Search(): ReactNode {
	const [query, setQuery] = useState(``)
	const [results, setResults] = useState<Product[]>([])
	const [failed, setFailed] = useState(false)
	useEffect(() => {
		let current = true
		const timer = setTimeout(() => {
			setFailed(false)
			void searchProducts(query).then(
				(value) => {
					if (current) setResults(value)
				},
				() => {
					if (current) setFailed(true)
				},
			)
		}, 300)
		return () => {
			current = false
			clearTimeout(timer)
		}
	}, [query])
	return (
		<SearchForm
			query={query}
			onChange={setQuery}
			results={results}
			failed={failed}
		/>
	)
}
