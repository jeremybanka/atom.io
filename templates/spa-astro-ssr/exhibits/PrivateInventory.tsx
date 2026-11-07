import type { VNode } from "@atom.io/spa"

import Inventory from "../src/Inventory.tsx"

export default function PrivateInventory(props: { id: string }): VNode {
	return <Inventory id={props.id} />
}
PrivateInventory.isolate = true
