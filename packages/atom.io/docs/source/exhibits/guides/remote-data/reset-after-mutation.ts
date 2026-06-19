import { resetState } from "atom.io"

import { client } from "./client.ts"
import { rowKeysAtom } from "./load-remote-rows.ts"

export async function createRow(title: string): Promise<void> {
	await client.rows.create({ title })

	// Reload the list from the remote, which owns the new row's id and timestamp.
	resetState(rowKeysAtom)
}
