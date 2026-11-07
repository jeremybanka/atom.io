import { capture } from "./runtime.ts"

/** Addressable behavior entry point. Never imports the component or SPA hydrator. */
export function addToBag(element: Element): void {
	const [quantity, cart] = capture(element)
	if (!quantity || !cart) throw new Error(`resume: addToBag needs two cells`)
	quantity.set((value) => value + 1)
	cart.set((value) => value + 1)
}
