import type { SpaElement } from "@atom.io/spa"

import Inventory from "../src/Inventory.tsx"

export default function PrivateInventory(props: { id: string }): SpaElement {
	return <Inventory id={props.id} />
}
PrivateInventory.isolate = true
