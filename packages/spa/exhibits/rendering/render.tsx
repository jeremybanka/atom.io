import { render } from "@atom.io/spa"

import Counter from "../Counter.tsx"

export function mountCounter(host: Element): () => void {
	const root = render(() => <Counter />, host)
	return root.dispose
}
